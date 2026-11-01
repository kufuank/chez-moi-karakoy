import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MENU_FILE = path.join(ROOT, 'data', 'menu.json');
const BACKUP_FILE = path.join(ROOT, 'data', 'menu.backup.json');
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

// --- Menu storage ---
// The menu lives in data/menu.json. When GITHUB_TOKEN is set (on Render), every save is also committed to
// a branch of the repo that the host does not deploy from (GITHUB_MENU_BRANCH), and the server loads the
// menu from that branch when it starts. The host's disk can then be wiped by a redeploy without losing edits,
// and a save never triggers a redeploy.
const GITHUB = {
  token: process.env.GITHUB_TOKEN,
  repo: process.env.GITHUB_REPO,
  branch: process.env.GITHUB_MENU_BRANCH || 'menu-data',
  path: 'data/menu.json',
  sha: null,
};
const githubOn = Boolean(GITHUB.token && GITHUB.repo);

async function github(method, url, body) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB.repo}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// On start: make sure the branch exists, then take the menu from it.
async function loadMenuFromGithub() {
  const branch = await github('GET', `/branches/${encodeURIComponent(GITHUB.branch)}`);
  if (branch.status === 404) {
    const main = await github('GET', '/git/ref/heads/main');
    if (main.status !== 200) throw new Error(`GitHub: main dalı okunamadı (${main.status})`);
    const created = await github('POST', '/git/refs', { ref: `refs/heads/${GITHUB.branch}`, sha: main.data.object.sha });
    if (created.status !== 201) throw new Error(`GitHub: ${GITHUB.branch} dalı açılamadı (${created.status})`);
    console.log(`GitHub: ${GITHUB.branch} dalı oluşturuldu.`);
  } else if (branch.status !== 200) {
    throw new Error(`GitHub: ${GITHUB.branch} dalına ulaşılamadı (${branch.status})`);
  }
  const file = await github('GET', `/contents/${GITHUB.path}?ref=${encodeURIComponent(GITHUB.branch)}`);
  if (file.status !== 200) throw new Error(`GitHub: menü dosyası okunamadı (${file.status})`);
  GITHUB.sha = file.data.sha;
  const text = Buffer.from(file.data.content, 'base64').toString('utf8');
  JSON.parse(text); // refuse to start from a broken file
  await fs.writeFile(MENU_FILE, text);
  console.log(`GitHub: menü ${GITHUB.repo}@${GITHUB.branch} dalından yüklendi.`);
}

async function pushMenuToGithub(text, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await github('PUT', `/contents/${GITHUB.path}`, {
      message,
      content: Buffer.from(text).toString('base64'),
      sha: GITHUB.sha,
      branch: GITHUB.branch,
    });
    if (res.status === 200 || res.status === 201) {
      GITHUB.sha = res.data.content.sha;
      return;
    }
    // Someone else changed the file (or our sha is stale): take the current sha and try once more.
    if (res.status === 409 || res.status === 422) {
      const current = await github('GET', `/contents/${GITHUB.path}?ref=${encodeURIComponent(GITHUB.branch)}`);
      if (current.status === 200) { GITHUB.sha = current.data.sha; continue; }
    }
    throw new Error(`GitHub kaydı başarısız (${res.status}): ${res.data?.message || ''}`);
  }
  throw new Error('GitHub kaydı başarısız: dosya o sırada başka yerde değişti.');
}

let writing = Promise.resolve();

async function readMenu() {
  return JSON.parse(await fs.readFile(MENU_FILE, 'utf8'));
}

// Serialises writes and swaps the file in atomically, keeping the previous version as a backup.
// With GitHub on, the save only counts once the commit lands; otherwise the file is put back.
function saveMenu(menu, message = 'Menü güncellendi') {
  const next = writing.then(async () => {
    const previous = await fs.readFile(MENU_FILE, 'utf8').catch(() => null);
    const text = JSON.stringify(menu, null, 2) + '\n';
    const tmp = `${MENU_FILE}.tmp`;
    if (previous) await fs.writeFile(BACKUP_FILE, previous);
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, MENU_FILE);
    if (!githubOn) return;
    try {
      if (!GITHUB.sha) throw new Error('GitHub: menü başlangıçta yüklenemediği için kayıt kapalı');
      await pushMenuToGithub(text, message);
    } catch (err) {
      if (previous) await fs.writeFile(MENU_FILE, previous);
      console.error(err);
      const error = new Error('Değişiklik kalıcı olarak kaydedilemedi (GitHub). Birkaç saniye sonra tekrar dene.');
      error.status = 503;
      throw error;
    }
  });
  writing = next.catch(() => {});
  return next;
}

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

// Pages: views/<page>.html is placed into views/layout.html. Placeholders: {{MENU}}, {{MENU_NAV}}, {{DISH:<item id>}}.
const PAGES = {
  '/': { view: 'home', nav: '', title: 'Chez Moi Karaköy · Kafe, restoran, bar ve meyhane', description: "Chez Moi, Karaköy Mumhane Caddesi'nde 1870'ten kalma bir binanın beş katında kafe, restoran, bistro, bar ve teras meyhane. Her gün 12:00 – 05:00." },
  '/hakkimizda': { view: 'hakkimizda', nav: 'hakkimizda', title: 'Hakkımızda · Chez Moi Karaköy', description: "Fransızca'da “benim evim”: 1870'ten kalma bir binada, 2016'dan beri Karaköy'de." },
  '/menu': { view: 'menu', nav: 'menu', title: 'Menü · Chez Moi Karaköy', description: 'Fransız, İtalyan ve Osmanlı mutfağından tabaklar; kahvaltı, makarnalar, pizzalar ve tatlılar. Güncel fiyatlarla Chez Moi menüsü.' },
  '/galeri': { view: 'galeri', nav: 'galeri', title: 'Galeri · Chez Moi Karaköy', description: "Chez Moi'nin salonlarından ve mutfağından kareler." },
  '/iletisim': { view: 'iletisim', nav: 'iletisim', title: 'İletişim · Chez Moi Karaköy', description: 'Mumhane Caddesi No:36, Karaköy. Her gün 12:00 – 05:00. Rezervasyon: 0549 600 35 36.' },
};
const NAV = [
  ['hakkimizda', '/hakkimizda', 'Hakkımızda'],
  ['menu', '/menu', 'Menü'],
  ['galeri', '/galeri', 'Galeri'],
  ['iletisim', '/iletisim', 'İletişim'],
];

for (const [route, page] of Object.entries(PAGES)) {
  app.get(route === '/' ? ['/', '/index.html'] : [route, `${route}/`], async (_req, res, next) => {
    try {
      const [layout, body, menu] = await Promise.all([
        fs.readFile(path.join(ROOT, 'views', 'layout.html'), 'utf8'),
        fs.readFile(path.join(ROOT, 'views', `${page.view}.html`), 'utf8'),
        readMenu(),
      ]);
      const nav = NAV.map(
        ([key, href, label]) => `<li><a href="${href}"${key === page.nav ? ' aria-current="page"' : ''}>${label}</a></li>`
      ).join('');
      const filled = body
        .replace('{{MENU}}', () => renderMenu(menu))
        .replace('{{MENU_NAV}}', () => renderMenuNav(menu))
        .replace(/\{\{DISH:(\w+)\}\}/g, (_m, id) => renderDish(menu, id));
      const html = layout
        .replace(/\{\{TITLE\}\}/g, escapeHtml(page.title))
        .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(page.description))
        .replace('{{PAGE}}', page.view)
        .replace('{{NAV}}', nav)
        .replace('{{JSONLD}}', () => (page.view === 'home' || page.view === 'menu' ? renderJsonLd(menu) : ''))
        .replace('{{BODY}}', () => filled);
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  });
}

app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin', 'index.html')));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Sunucuda bir sorun oluştu, değişiklik kaydedilmedi. Tekrar dene.' });
});

// Load the saved menu from GitHub before taking requests (a few tries; the host may start before the network).
if (githubOn) {
  for (let attempt = 1; attempt <= 3 && !GITHUB.sha; attempt++) {
    try {
      await loadMenuFromGithub();
    } catch (err) {
      console.error(`${err.message} (deneme ${attempt}/3)`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (!GITHUB.sha) console.error('GitHub: menü yüklenemedi. Site paketteki menüyle açılıyor; panelde kayıt kapalı.');
} else if (ON_HOST) {
  console.warn('GITHUB_TOKEN/GITHUB_REPO tanımlı değil: paneldeki değişiklikler yeniden yayında kaybolur.');
}

app.listen(PORT, () => {
  console.log(`Chez Moi: http://localhost:${PORT}  ·  Yönetim: http://localhost:${PORT}/admin`);
});
