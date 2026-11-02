// Chez Moi admin — the data layer. The panel was written against a small REST API; on the static site the same
// calls are answered here from Supabase (Auth for sign-in, row level security for who may change what).
// admin.js and admin-club.js call window.CMBackend.api(method, url, body) exactly as before.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, POSTER_BUCKET } from '../js/config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: 'chezmoi-admin' } });

class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Supabase errors in plain Turkish; a missing or expired session becomes a 401 so the panel shows the sign-in.
function fail(error, fallback = 'Bir sorun oluştu. Tekrar dene.') {
  if (!error) return;
  const msg = error.message || '';
  if (error.status === 401 || /JWT|token|not authenticated/i.test(msg)) throw new ApiError('Oturumun süresi doldu. Lütfen yeniden giriş yap.', 401);
  if (error.code === '23505') throw new ApiError('Bu kayıt zaten var.', 409);
  if (error.code === '23503') throw new ApiError('Bu kategoride hâlâ ürün var.', 409);
  if (error.code === '42501' || /row-level security/i.test(msg)) throw new ApiError('Bu işlem için yetkin yok.', 403);
  if (error.code === '23514') throw new ApiError('Girilen değerlerden biri geçerli değil.', 400);
  console.error(error);
  throw new ApiError(fallback, 500);
}
const must = ({ data, error }, fallback) => { fail(error, fallback); return data; };

// ---------- helpers mirroring the old server's rules ----------
const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const sameName = (a, b) => a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr');
function slugify(text) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  return text.replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kategori';
}
function parsePrice(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}
const randomId = (prefix) => `${prefix}${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0')}`;
const toItem = (r) => ({ id: r.id, name: r.name, description: r.description, price: Number(r.price), categoryId: r.category_id, position: r.position });
const toEvent = (r) => ({
  id: r.id, title: r.title, date: r.date, time: r.time, floor: r.floor, genres: r.genres || [], lineup: r.lineup || [],
  description: r.description, ticketUrl: r.ticket_url, guestlist: r.guestlist, capacity: r.capacity, poster: r.poster, published: r.published,
});

async function nextPosition(table) {
  const rows = must(await sb.from(table).select('position').order('position', { ascending: false }).limit(1));
  return rows.length ? rows[0].position + 1 : 0;
}

function readItem(body, categories) {
  const name = clean(body?.name, 90);
  const description = clean(body?.description, 300);
  const price = parsePrice(body?.price);
  if (!name) throw new ApiError('Ürün adı boş olamaz.');
  if (price === null) throw new ApiError('Fiyat bir sayı olmalı, örneğin 245 ya da 245,50.');
  if (!categories.some((c) => c.id === body?.categoryId)) throw new ApiError('Geçerli bir kategori seç.');
  return { name, description, price, category_id: body.categoryId };
}

function readEvent(body) {
  const title = clean(body?.title, 90);
  const time = body?.time || '22:00';
  const ticketUrl = clean(body?.ticketUrl, 300);
  const capacity = body?.capacity === '' || body?.capacity == null ? null : Number(body.capacity);
  if (!title) throw new ApiError('Etkinlik adı boş olamaz.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body?.date || '')) throw new ApiError('Geçerli bir tarih seç.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError('Saat 22:00 biçiminde olmalı.');
  if (ticketUrl && !/^https:\/\/\S+$/.test(ticketUrl)) throw new ApiError('Bilet linki https:// ile başlamalı.');
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000)) throw new ApiError('Kapasite 1 ile 5000 arasında bir sayı olmalı.');
  const lineup = (Array.isArray(body?.lineup) ? body.lineup : String(body?.lineup || '').split(/[,\n]/)).map((a) => clean(a, 60)).filter(Boolean).slice(0, 12);
  return {
    title, date: body.date, time,
    floor: ['zemin', 'roof', 'ikisi'].includes(body?.floor) ? body.floor : 'ikisi',
    genres: (body?.genres || []).map((g) => clean(g, 30)).filter(Boolean).slice(0, 6),
    lineup,
    description: typeof body?.description === 'string' ? body.description.trim().slice(0, 600) : '',
    ticket_url: ticketUrl,
    guestlist: Boolean(body?.guestlist),
    capacity,
    poster: typeof body?.poster === 'string' && body.poster ? body.poster : null,
    published: Boolean(body?.published),
  };
}

// ---------- sign-in ----------
async function isAdmin(userId) {
  const rows = must(await sb.from('chezmoi_admins').select('user_id').eq('user_id', userId));
  return rows.length > 0;
}

async function session() {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new ApiError('Giriş yapılmadı.', 401);
  if (!(await isAdmin(data.session.user.id))) throw new ApiError('Bu hesap Chez Moi yöneticisi değil.', 403);
  return { ok: true, email: data.session.user.email };
}

async function login({ email, password }) {
  const { data, error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
  if (error) throw new ApiError(/invalid/i.test(error.message) ? 'E-posta ya da şifre yanlış.' : error.message, 401);
  if (!(await isAdmin(data.user.id))) {
    await sb.auth.signOut();
    throw new ApiError('Bu hesap Chez Moi yöneticisi olarak tanımlı değil.', 403);
  }
  return { ok: true };
}

// ---------- routes ----------
const routes = [
  ['POST', /^\/api\/login$/, (b) => login(b)],
  ['POST', /^\/api\/logout$/, async () => { await sb.auth.signOut(); return { ok: true }; }],
  ['GET', /^\/api\/session$/, () => session()],

  ['GET', /^\/api\/menu$/, async () => {
    const [categories, items] = await Promise.all([
      sb.from('chezmoi_categories').select('*').order('position'),
      sb.from('chezmoi_items').select('*').order('position'),
    ]);
    return { categories: must(categories).map(({ id, name }) => ({ id, name })), items: must(items).map(toItem) };
  }],

  ['POST', /^\/api\/categories$/, async (b) => {
    const name = clean(b?.name, 60);
    if (!name) throw new ApiError('Kategori adı boş olamaz.');
    const cats = must(await sb.from('chezmoi_categories').select('id,name'));
    if (cats.some((c) => sameName(c.name, name))) throw new ApiError(`“${name}” adında bir kategori zaten var.`, 409);
    let id = slugify(name);
    while (cats.some((c) => c.id === id)) id += '-2';
    const row = must(await sb.from('chezmoi_categories').insert({ id, name, position: await nextPosition('chezmoi_categories') }).select().single());
    return { id: row.id, name: row.name };
  }],
  ['PUT', /^\/api\/categories\/order$/, async (b) => {
    const ids = b?.ids;
    const cats = must(await sb.from('chezmoi_categories').select('id,name'));
    if (!Array.isArray(ids) || ids.length !== cats.length || !ids.every((id) => cats.some((c) => c.id === id))) {
      throw new ApiError('Sıralama kaydedilemedi. Sayfayı yenileyip tekrar dene.');
    }
    await Promise.all(ids.map((id, position) => sb.from('chezmoi_categories').update({ position }).eq('id', id).then((r) => fail(r.error))));
    return ids.map((id) => cats.find((c) => c.id === id));
  }],
  ['PUT', /^\/api\/categories\/([^/]+)$/, async (b, [id]) => {
    const name = clean(b?.name, 60);
    if (!name) throw new ApiError('Kategori adı boş olamaz.');
    const cats = must(await sb.from('chezmoi_categories').select('id,name'));
    if (cats.some((c) => c.id !== id && sameName(c.name, name))) throw new ApiError(`“${name}” adında bir kategori zaten var.`, 409);
    const rows = must(await sb.from('chezmoi_categories').update({ name }).eq('id', id).select());
    if (!rows.length) throw new ApiError('Bu kategori artık yok. Sayfayı yenile.', 404);
    return { id, name };
  }],
  ['DELETE', /^\/api\/categories\/([^/]+)$/, async (_b, [id]) => {
    const { count } = await sb.from('chezmoi_items').select('id', { count: 'exact', head: true }).eq('category_id', id);
    const cat = must(await sb.from('chezmoi_categories').select('name').eq('id', id))[0];
    if (!cat) throw new ApiError('Bu kategori artık yok. Sayfayı yenile.', 404);
    if (count) throw new ApiError(`“${cat.name}” kategorisinde ${count} ürün var. Önce ürünleri silin ya da başka kategoriye taşıyın.`, 409);
    must(await sb.from('chezmoi_categories').delete().eq('id', id));
    return { ok: true };
  }],

  ['POST', /^\/api\/items$/, async (b) => {
    const cats = must(await sb.from('chezmoi_categories').select('id'));
    const value = readItem(b, cats);
    // "Geri al" after a delete sends the old id and position back, so the item returns where it was.
    const restore = b?.restore;
    const canRestore = restore && /^i[0-9a-z]{3,16}$/.test(restore.id) && Number.isInteger(restore.index);
    const row = must(await sb.from('chezmoi_items').insert({
      id: canRestore ? restore.id : randomId('i'),
      ...value,
      position: canRestore ? restore.index : await nextPosition('chezmoi_items'),
    }).select().single());
    return toItem(row);
  }],
  ['PUT', /^\/api\/items\/([^/]+)$/, async (b, [id]) => {
    const cats = must(await sb.from('chezmoi_categories').select('id'));
    const value = readItem(b, cats);
    const before = must(await sb.from('chezmoi_items').select('category_id').eq('id', id))[0];
    if (!before) throw new ApiError('Bu ürün artık yok. Sayfayı yenile.', 404);
    // moved to another category: goes to the end of it
    if (before.category_id !== value.category_id) value.position = await nextPosition('chezmoi_items');
    return toItem(must(await sb.from('chezmoi_items').update(value).eq('id', id).select().single()));
  }],
  ['DELETE', /^\/api\/items\/([^/]+)$/, async (_b, [id]) => {
    const rows = must(await sb.from('chezmoi_items').delete().eq('id', id).select());
    if (!rows.length) throw new ApiError('Bu ürün artık yok. Sayfayı yenile.', 404);
    return { ok: true, item: toItem(rows[0]), index: rows[0].position };
  }],

  ['GET', /^\/api\/admin\/events$/, async () =>
    must(await sb.from('chezmoi_events').select('*').order('date', { ascending: false }).order('time', { ascending: false })).map(toEvent)],
  ['POST', /^\/api\/admin\/events$/, async (b) => toEvent(must(await sb.from('chezmoi_events').insert(readEvent(b)).select().single()))],
  ['PUT', /^\/api\/admin\/events\/([^/]+)$/, async (b, [id]) => {
    const rows = must(await sb.from('chezmoi_events').update(readEvent(b)).eq('id', id).select());
    if (!rows.length) throw new ApiError('Bu etkinlik artık yok. Sayfayı yenile.', 404);
    return toEvent(rows[0]);
  }],
  ['DELETE', /^\/api\/admin\/events\/([^/]+)$/, async (_b, [id]) => {
    const rows = must(await sb.from('chezmoi_events').delete().eq('id', id).select('id'));
    if (!rows.length) throw new ApiError('Bu etkinlik artık yok. Sayfayı yenile.', 404);
    return { ok: true };
  }],
];

const STATUS = { reservations: ['yeni', 'onaylandi', 'iptal'], guestlist: ['bekliyor', 'onaylandi', 'geldi', 'iptal'] };
for (const table of Object.keys(STATUS)) {
  const t = `chezmoi_${table}`;
  routes.push(
    ['GET', new RegExp(`^/api/admin/${table}(?:\\?event=(.+))?$`), async (_b, [event]) => {
      let q = sb.from(t).select('*').order('created_at', { ascending: false });
      if (event) q = q.eq('event_id', decodeURIComponent(event));
      return must(await q);
    }],
    ['PATCH', new RegExp(`^/api/admin/${table}/([^/]+)$`), async (b, [id]) => {
      if (!STATUS[table].includes(b?.status)) throw new ApiError('Geçersiz durum.');
      const rows = must(await sb.from(t).update({ status: b.status }).eq('id', id).select());
      if (!rows.length) throw new ApiError('Kayıt bulunamadı. Sayfayı yenile.', 404);
      return rows[0];
    }],
    ['DELETE', new RegExp(`^/api/admin/${table}/([^/]+)$`), async (_b, [id]) => {
      const rows = must(await sb.from(t).delete().eq('id', id).select('id'));
      if (!rows.length) throw new ApiError('Kayıt bulunamadı. Sayfayı yenile.', 404);
      return { ok: true };
    }],
  );
}

async function api(method, url, body) {
  for (const [m, pattern, handler] of routes) {
    const match = m === method && url.match(pattern);
    if (match) return handler(body, match.slice(1));
  }
  throw new ApiError(`Bilinmeyen istek: ${method} ${url}`, 404);
}

// Posters go straight to the public storage bucket; the policy lets only admins write there.
async function uploadPoster(file) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  if (!ext) throw new ApiError('JPG, PNG ya da WEBP bir görsel seçin (en fazla 3 MB).');
  if (file.size > 3 * 1024 * 1024) throw new ApiError('Afiş en fazla 3 MB olabilir.');
  const name = `poster-${Date.now().toString(36)}-${randomId('').slice(0, 6)}.${ext}`;
  fail((await sb.storage.from(POSTER_BUCKET).upload(name, file, { contentType: file.type, cacheControl: '31536000' })).error, 'Afiş yüklenemedi.');
  return { name };
}
const posterUrl = (name) => sb.storage.from(POSTER_BUCKET).getPublicUrl(name).data.publicUrl;

window.CMBackend = { api, uploadPoster, posterUrl };
