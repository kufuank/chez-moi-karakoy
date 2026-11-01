import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonDoc, fileStore, githubOn } from './lib/github-store.js';
import { records, supabaseOn } from './lib/records.js';
import { clubRoutes, upcoming, past, todayIstanbul, FLOORS } from './lib/club.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_HOURS = 12;

// --- Admin password: from the environment, else from .env, else generated once into .env ---
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const ON_HOST = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');
if (!process.env.ADMIN_PASSWORD && ON_HOST) {
  console.error('ADMIN_PASSWORD ortam değişkeni tanımlı değil. Barındırma panelinden ekleyin.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  const generated = crypto.randomBytes(9).toString('base64url');
  const prior = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  writeFileSync(ENV_FILE, `${prior}${prior && !prior.endsWith('\n') ? '\n' : ''}ADMIN_PASSWORD=${generated}\n`);
  process.env.ADMIN_PASSWORD = generated;
  console.log('Yönetim paneli şifresi oluşturuldu ve .env dosyasına yazıldı.');
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- Storage: menu and events as JSON documents (mirrored to GitHub), personal data in Supabase ---
const menuDoc = jsonDoc(ROOT, "data/menu.json");
const eventsDoc = jsonDoc(ROOT, "data/events.json", { events: [] });
const posters = fileStore(ROOT, "data/uploads");
const db = records(ROOT);
const readMenu = () => menuDoc.read();
const saveMenu = (menu, message = "Menü güncellendi") => menuDoc.save(menu, message);

function slugify(text) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  return text
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'kategori';
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function parsePrice(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

// --- Sessions: signed cookies, so a restart or a sleeping host does not sign anyone out.
// The key comes from the password, so changing ADMIN_PASSWORD ends every session.
const SESSION_KEY = crypto.createHash('sha256').update(`chez-moi-session:${ADMIN_PASSWORD}`).digest();
const revoked = new Set(); // signed-out tokens, until they expire
const attempts = new Map();

function signSession(expires) {
  const payload = `${expires}.${crypto.randomBytes(12).toString('base64url')}`;
  const mac = crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verifySession(token) {
  if (!token || revoked.has(token)) return false;
  const [expires, nonce, mac] = token.split('.');
  if (!expires || !nonce || !mac) return false;
  const expected = crypto.createHmac('sha256', SESSION_KEY).update(`${expires}.${nonce}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(expires) > Date.now();
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function requireAdmin(req, res, next) {
  if (!verifySession(readCookie(req, 'cm_admin'))) {
    return res.status(401).json({ error: 'Oturumun süresi doldu. Lütfen yeniden giriş yap.' });
  }
  next();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// --- App ---
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind the host's proxy: real client IP for the login limit, https for Secure cookies
app.use(express.json({ limit: '64kb' }));

app.get('/api/menu', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await readMenu());
  } catch (err) {
    next(err);
  }
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, until: 0 };
  if (record.until > now) {
    const minutes = Math.ceil((record.until - now) / 60000);
    return res.status(429).json({ error: `Çok fazla deneme yapıldı. ${minutes} dakika sonra tekrar dene.` });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    record.count += 1;
    if (record.count >= 5) Object.assign(record, { count: 0, until: now + 10 * 60000 });
    attempts.set(ip, record);
    return res.status(401).json({ error: 'Şifre yanlış. Tekrar dene.' });
  }
  attempts.delete(ip);
  const token = signSession(now + SESSION_HOURS * 3600000);
  res.set(
    'Set-Cookie',
    `cm_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, 'cm_admin');
  if (token) revoked.add(token);
  res.set('Set-Cookie', 'cm_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/session', requireAdmin, (_req, res) => res.json({ ok: true }));

clubRoutes({ app, eventsDoc, posters, db, requireAdmin });

// Categories
app.post('/api/categories', requireAdmin, async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'Kategori adı boş olamaz.' });
    const menu = await readMenu();
    if (menu.categories.some((c) => c.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
      return res.status(409).json({ error: `“${name}” adında bir kategori zaten var.` });
    }
    let id = slugify(name);
    while (menu.categories.some((c) => c.id === id)) id += '-2';
    const category = { id, name };
    menu.categories.push(category);
    await saveMenu(menu, `Kategori eklendi: ${name}`);
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

app.put('/api/categories/order', requireAdmin, async (req, res, next) => {
  try {
    const ids = req.body?.ids;
    const menu = await readMenu();
    const known = new Set(menu.categories.map((c) => c.id));
    if (!Array.isArray(ids) || ids.length !== known.size || !ids.every((id) => known.has(id))) {
      return res.status(400).json({ error: 'Sıralama kaydedilemedi. Sayfayı yenileyip tekrar dene.' });
    }
    menu.categories = ids.map((id) => menu.categories.find((c) => c.id === id));
    await saveMenu(menu, 'Kategoriler yeniden sıralandı');
    res.json(menu.categories);
  } catch (err) {
    next(err);
  }
});

app.put('/api/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'Kategori adı boş olamaz.' });
    const menu = await readMenu();
    const category = menu.categories.find((c) => c.id === req.params.id);
    if (!category) return res.status(404).json({ error: 'Bu kategori artık yok. Sayfayı yenile.' });
    if (menu.categories.some((c) => c.id !== category.id && c.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
      return res.status(409).json({ error: `“${name}” adında bir kategori zaten var.` });
    }
    category.name = name;
    await saveMenu(menu, `Kategori adı değişti: ${name}`);
    res.json(category);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const menu = await readMenu();
    const category = menu.categories.find((c) => c.id === req.params.id);
    if (!category) return res.status(404).json({ error: 'Bu kategori artık yok. Sayfayı yenile.' });
    const count = menu.items.filter((i) => i.categoryId === category.id).length;
    if (count > 0) {
      return res.status(409).json({
        error: `“${category.name}” kategorisinde ${count} ürün var. Önce ürünleri silin ya da başka kategoriye taşıyın.`,
      });
    }
    menu.categories = menu.categories.filter((c) => c.id !== category.id);
    await saveMenu(menu, `Kategori silindi: ${category.name}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Items
function readItemBody(body, menu) {
  const name = cleanText(body?.name, 90);
  const description = cleanText(body?.description, 300);
  const price = parsePrice(body?.price);
  const categoryId = body?.categoryId;
  if (!name) return { error: 'Ürün adı boş olamaz.' };
  if (price === null) return { error: 'Fiyat bir sayı olmalı, örneğin 245 ya da 245,50.' };
  if (!menu.categories.some((c) => c.id === categoryId)) return { error: 'Geçerli bir kategori seç.' };
  return { value: { name, description, price, categoryId } };
}

app.post('/api/items', requireAdmin, async (req, res, next) => {
  try {
    const menu = await readMenu();
    const { error, value } = readItemBody(req.body, menu);
    if (error) return res.status(400).json({ error });
    // "Geri al" after a delete sends the old id and position back, so the item returns where it was.
    const restore = req.body?.restore;
    const canRestore =
      restore && /^i[0-9a-z]{3,16}$/.test(restore.id) && Number.isInteger(restore.index) && !menu.items.some((i) => i.id === restore.id);
    const item = { id: canRestore ? restore.id : `i${crypto.randomBytes(4).toString('hex')}`, ...value };
    if (canRestore) {
      menu.items.splice(Math.min(Math.max(restore.index, 0), menu.items.length), 0, item);
    } else {
      // Insert after the last item of the same category so the file stays grouped.
      const lastIndex = menu.items.findLastIndex((i) => i.categoryId === item.categoryId);
      menu.items.splice(lastIndex === -1 ? menu.items.length : lastIndex + 1, 0, item);
    }
    await saveMenu(menu, `Ürün eklendi: ${item.name}`);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

app.put('/api/items/:id', requireAdmin, async (req, res, next) => {
  try {
    const menu = await readMenu();
    const index = menu.items.findIndex((i) => i.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Bu ürün artık yok. Sayfayı yenile.' });
    const { error, value } = readItemBody(req.body, menu);
    if (error) return res.status(400).json({ error });
    const previous = menu.items[index];
    const item = { ...previous, ...value };
    if (previous.categoryId !== item.categoryId) {
      menu.items.splice(index, 1);
      const lastIndex = menu.items.findLastIndex((i) => i.categoryId === item.categoryId);
      menu.items.splice(lastIndex === -1 ? menu.items.length : lastIndex + 1, 0, item);
    } else {
      menu.items[index] = item;
    }
    await saveMenu(menu, `Ürün güncellendi: ${item.name}`);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/items/:id', requireAdmin, async (req, res, next) => {
  try {
    const menu = await readMenu();
    const index = menu.items.findIndex((i) => i.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Bu ürün artık yok. Sayfayı yenile.' });
    const [item] = menu.items.splice(index, 1);
    await saveMenu(menu, `Ürün silindi: ${item.name}`);
    res.json({ ok: true, item, index });
  } catch (err) {
    next(err);
  }
});

// --- Public page: the menu is rendered into the HTML on every request, so edits show at once ---
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const priceFormat = (digits) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatPrice = (n) => `₺${priceFormat(Number.isInteger(n) ? 0 : 2).format(n)}`;

const menuGroups = (menu) =>
  menu.categories.map((c) => ({ ...c, items: menu.items.filter((i) => i.categoryId === c.id) })).filter((c) => c.items.length);

// The full menu page: a jump list of categories, then one section per category.
function renderMenuNav(menu) {
  return menuGroups(menu)
    .map((c) => `<li><a href="#k-${c.id}">${escapeHtml(c.name)}</a></li>`)
    .join('');
}

function renderMenu(menu) {
  const groups = menuGroups(menu);
  if (!groups.length) return '<p class="menu-empty">Menü güncelleniyor. Lütfen bizi arayın: 0549 600 35 36</p>';
  return groups
    .map(
      (c) => `
      <section class="cat" id="k-${c.id}" aria-labelledby="kh-${c.id}">
        <h2 class="cat-title" id="kh-${c.id}" data-reveal>${escapeHtml(c.name)}</h2>
        <ul class="items">${c.items
          .map(
            (i) => `
          <li class="item" data-reveal>
            <span class="item-name">${escapeHtml(i.name)}</span>
            <span class="item-price">${formatPrice(i.price)}</span>${
              i.description ? `\n            <span class="item-desc">${escapeHtml(i.description)}</span>` : ''
            }
          </li>`
          )
          .join('')}
        </ul>
      </section>`
    )
    .join('');
}

// A dish label for the collage plates: name and live price from the menu, or nothing if the item was removed.
function renderDish(menu, id) {
  const item = menu.items.find((i) => i.id === id);
  return item ? `<span class="tag-name">${escapeHtml(item.name)}</span><span class="tag-price">${formatPrice(item.price)}</span>` : '';
}

function renderJsonLd(menu) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: 'Chez Moi Karaköy',
    image: '/img/facade-after.jpg',
    telephone: '+90 549 600 35 36',
    email: 'chezmoikarakoy@gmail.com',
    servesCuisine: ['Fransız', 'İtalyan', 'Osmanlı', 'Meyhane'],
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Kemankeş Karamustafa Paşa Mah. Mumhane Cad. No:36',
      addressLocality: 'Beyoğlu',
      addressRegion: 'İstanbul',
      addressCountry: 'TR',
    },
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '12:00', closes: '05:00' },
    ],
    sameAs: ['https://www.instagram.com/chezmoikarakoy/'],
    hasMenu: {
      '@type': 'Menu',
      hasMenuSection: menu.categories.map((c) => ({
        '@type': 'MenuSection',
        name: c.name,
        hasMenuItem: menu.items
          .filter((i) => i.categoryId === c.id)
          .map((i) => ({
            '@type': 'MenuItem',
            name: i.name,
            ...(i.description ? { description: i.description } : {}),
            offers: { '@type': 'Offer', price: i.price, priceCurrency: 'TRY' },
          })),
      })),
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// --- Pages ---------------------------------------------------------------------------------------------
// views/<view>.html goes into views/layout.html (views/gate.html is a page of its own).
// Placeholders: {{MENU}}, {{MENU_NAV}}, {{DISH:<item id>}}, {{EVENTS}}, {{PAST_EVENTS}}, {{ARTISTS}},
// {{TODAY}}, {{MAX_DATE}}.
const trDate = (iso, opts) => new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
const FALLBACK_POSTERS = ['night-crowd', 'night-party', 'night-bar', 'night-toast'];

function renderEvents(events) {
  const list = upcoming(events);
  if (!list.length) {
    return `<div class="events-empty" data-reveal>
        <p class="head">Yeni geceler yakında açıklanacak.</p>
        <p>Programı ilk duyan olmak için Instagram'da <a href="https://www.instagram.com/chezmoikarakoy/" rel="noopener" target="_blank">@chezmoikarakoy</a> hesabını takip edin.</p>
      </div>`;
  }
  return list
    .map((e, i) => {
      const poster = e.poster
        ? `<img src="/uploads/${escapeHtml(e.poster)}" alt="${escapeHtml(e.title)} afişi" loading="lazy">`
        : `<img src="/img/torn/${FALLBACK_POSTERS[i % FALLBACK_POSTERS.length]}.png" alt="" loading="lazy">`;
      const meta = [FLOORS[e.floor], e.genres.join(', ')].filter(Boolean).join(' · ');
      const longDate = trDate(e.date, { day: 'numeric', month: 'long', weekday: 'long' });
      const action = e.ticketUrl
        ? `<a class="button" href="${escapeHtml(e.ticketUrl)}" target="_blank" rel="noopener">Bilet al</a>`
        : e.guestlist
          ? `<button class="button" type="button" data-guestlist data-event-id="${e.id}" data-event-title="${escapeHtml(e.title)}" data-event-date="${escapeHtml(longDate)}">Ön kayıt ol</button>`
          : '<p class="event-door">Giriş kapıda.</p>';
      return `
      <article class="event" data-reveal>
        <figure class="event-poster${e.poster ? ' event-poster--own' : ''}">${poster}<span class="tape tape--top"></span></figure>
        <div class="event-body">
          <h3 class="event-title">${escapeHtml(e.title)}</h3>
          <p class="event-date"><span class="event-day">${trDate(e.date, { day: 'numeric' })}</span><span>${trDate(e.date, { month: 'long' })} · ${trDate(e.date, { weekday: 'long' })} · ${escapeHtml(e.time)}</span></p>
          ${meta ? `<p class="event-meta">${escapeHtml(meta)}</p>` : ''}
          ${e.lineup.length ? `<p class="event-lineup">${e.lineup.map(escapeHtml).join(' <i class="dot"></i> ')}</p>` : ''}
          ${e.description ? `<p class="event-desc">${escapeHtml(e.description)}</p>` : ''}
          <div class="event-action">${action}</div>
        </div>
      </article>`;
    })
    .join('');
}

function renderPastEvents(events) {
  const list = past(events).slice(0, 8);
  if (!list.length) return '';
  return `<section class="past" aria-labelledby="past-title">
      <h2 class="head" id="past-title" data-reveal>Geçmiş geceler</h2>
      <ul class="past-list">${list
        .map((e) => `<li data-reveal><span class="past-date">${trDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span><span class="past-title">${escapeHtml(e.title)}</span><span class="past-lineup">${e.lineup.map(escapeHtml).join(', ')}</span></li>`)
        .join('')}</ul>
    </section>`;
}

function renderArtists(events) {
  const names = [...new Set(events.filter((e) => e.published).flatMap((e) => e.lineup))];
  if (!names.length) return '';
  return `<section class="artists" aria-labelledby="artists-title">
      <h2 class="display" id="artists-title" data-reveal>Bu sahnede çalanlar</h2>
      <p class="artists-list" data-reveal>${names.map((n) => `<span>${escapeHtml(n)}</span>`).join(' <i class="dot"></i> ')}</p>
    </section>`;
}

const RESTAURANT_NAV = [
  ['hakkimizda', '/hakkimizda', 'Hakkımızda'],
  ['menu', '/menu', 'Menü'],
  ['galeri', '/galeri', 'Galeri'],
  ['iletisim', '/iletisim', 'İletişim'],
  ['kulup', '/kulup', 'Kulüp'],
];
const CLUB_NAV = [
  ['', '/kulup#etkinlikler', 'Etkinlikler'],
  ['', '/kulup#geceler', 'Geceler'],
  ['', '/kulup#bilgi', 'Bilgi'],
  ['restoran', '/restoran', 'Restoran'],
];

const PAGES = {
  '/restoran': { view: 'home', nav: '', title: 'Chez Moi Karaköy · Restoran, kafe ve meyhane', description: "Chez Moi, Karaköy Mumhane Caddesi'nde 1870'ten kalma bir binanın beş katında kafe, restoran, bistro, bar ve teras meyhane. Her gün 12:00 – 05:00." },
  '/hakkimizda': { view: 'hakkimizda', nav: 'hakkimizda', title: 'Hakkımızda · Chez Moi Karaköy', description: "Fransızca'da “benim evim”: 1870'ten kalma bir binada, 2016'dan beri Karaköy'de." },
  '/menu': { view: 'menu', nav: 'menu', title: 'Menü · Chez Moi Karaköy', description: 'Fransız, İtalyan ve Osmanlı mutfağından tabaklar; kahvaltı, makarnalar, pizzalar ve tatlılar. Güncel fiyatlarla Chez Moi menüsü.' },
  '/galeri': { view: 'galeri', nav: 'galeri', title: 'Galeri · Chez Moi Karaköy', description: "Chez Moi'nin salonlarından ve mutfağından kareler." },
  '/iletisim': { view: 'iletisim', nav: 'iletisim', title: 'İletişim · Chez Moi Karaköy', description: 'Mumhane Caddesi No:36, Karaköy. Her gün 12:00 – 05:00. Rezervasyon: 0549 600 35 36.' },
  '/rezervasyon': { view: 'rezervasyon', nav: '', title: 'Rezervasyon · Chez Moi Karaköy', description: 'Chez Moi Karaköy için masa ayırtın. Talebinizi alıp sizi arayarak onaylıyoruz.' },
  '/gizlilik': { view: 'gizlilik', nav: '', title: 'Kişisel verilerin korunması · Chez Moi Karaköy', description: 'Rezervasyon ve ön kayıt formlarında paylaştığınız bilgilerin nasıl kullanıldığı.' },
  '/kulup': { view: 'kulup', nav: '', club: true, title: 'Kulüp · Chez Moi Karaköy geceleri', description: "Akşam saatlerinde Chez Moi'nin zemin katı ve roof barı kulübe dönüşüyor: yerli ve yabancı DJ'ler, elektronik, pop ve indie geceleri." },
};

async function renderPage(page) {
  const [layout, body, menu, eventsData] = await Promise.all([
    fs.readFile(path.join(ROOT, 'views', 'layout.html'), 'utf8'),
    fs.readFile(path.join(ROOT, 'views', `${page.view}.html`), 'utf8'),
    readMenu(),
    eventsDoc.read(),
  ]);
  const events = eventsData.events;
  const navItems = page.club ? CLUB_NAV : RESTAURANT_NAV;
  const nav = navItems.map(([key, href, label]) => `<li><a href="${href}"${key && key === page.nav ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const cta = page.club
    ? '<a class="button button--small" href="/kulup#etkinlikler">Ön kayıt</a>'
    : '<a class="button button--small" href="/rezervasyon">Rezervasyon</a>';
  const today = todayIstanbul();
  const maxDate = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10);
  const filled = body
    .replace('{{MENU}}', () => renderMenu(menu))
    .replace('{{MENU_NAV}}', () => renderMenuNav(menu))
    .replace('{{EVENTS}}', () => renderEvents(events))
    .replace('{{PAST_EVENTS}}', () => renderPastEvents(events))
    .replace('{{ARTISTS}}', () => renderArtists(events))
    .replaceAll('{{TODAY}}', today)
    .replaceAll('{{MAX_DATE}}', maxDate)
    .replace(/\{\{DISH:(\w+)\}\}/g, (_m, id) => renderDish(menu, id));
  return layout
    .replace(/\{\{TITLE\}\}/g, escapeHtml(page.title))
    .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(page.description))
    .replace('{{PAGE}}', page.view)
    .replace('{{THEME}}', page.club ? 'club' : 'restaurant')
    .replace('{{HOME}}', page.club ? '/kulup' : '/restoran')
    .replace('{{NAV}}', nav)
    .replace('{{CTA}}', cta)
    .replace('{{JSONLD}}', () => (page.view === 'home' || page.view === 'menu' ? renderJsonLd(menu) : ''))
    .replace('{{BODY}}', () => filled);
}

for (const [route, page] of Object.entries(PAGES)) {
  app.get([route, `${route}/`], async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(await renderPage(page));
    } catch (err) {
      next(err);
    }
  });
}

// The door: restaurant or club
app.get(['/', '/index.html'], (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'views', 'gate.html'));
});

app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin', 'index.html')));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Sunucuda bir sorun oluştu, değişiklik kaydedilmedi. Tekrar dene.' });
});

// Load the saved documents from GitHub before taking requests.
await Promise.all([menuDoc.load(), eventsDoc.load()]);
if (ON_HOST && !githubOn()) console.warn("GITHUB_TOKEN/GITHUB_REPO tanımlı değil: paneldeki değişiklikler yeniden yayında kaybolur.");
// Personal data is kept for 90 days after the visit, then deleted (as /gizlilik says). Checked at start and daily.
async function purgeOldRecords() {
  const cutoff = new Date(Date.parse(`${todayIstanbul()}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
  try {
    const a = await db.purgeBefore('reservations', 'date', cutoff);
    const b = await db.purgeBefore('guestlist', 'event_date', cutoff);
    if (a || b) console.log(`Eski kayıtlar silindi: ${a} rezervasyon, ${b} ön kayıt (${cutoff} öncesi).`);
  } catch (err) {
    console.error('Eski kayıtlar silinemedi:', err.message);
  }
}
purgeOldRecords();
setInterval(purgeOldRecords, 24 * 3600000).unref();
if (ON_HOST && !supabaseOn()) console.warn("SUPABASE_URL/SUPABASE_SERVICE_KEY tanımlı değil: rezervasyon ve ön kayıtlar geçici diske yazılıyor.");

app.listen(PORT, () => {
  console.log(`Chez Moi: http://localhost:${PORT}  ·  Yönetim: http://localhost:${PORT}/admin`);
});
