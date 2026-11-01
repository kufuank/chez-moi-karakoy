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
if (!process.env.ADMIN_PASSWORD) {
  const generated = crypto.randomBytes(9).toString('base64url');
  const prior = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  writeFileSync(ENV_FILE, `${prior}${prior && !prior.endsWith('\n') ? '\n' : ''}ADMIN_PASSWORD=${generated}\n`);
  process.env.ADMIN_PASSWORD = generated;
  console.log('Yönetim paneli şifresi oluşturuldu ve .env dosyasına yazıldı.');
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- Menu storage ---
let writing = Promise.resolve();

async function readMenu() {
  return JSON.parse(await fs.readFile(MENU_FILE, 'utf8'));
}

// Serialises writes and swaps the file in atomically, keeping the previous version as a backup.
function saveMenu(menu) {
  writing = writing.then(async () => {
    const tmp = `${MENU_FILE}.tmp`;
    await fs.copyFile(MENU_FILE, BACKUP_FILE).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(menu, null, 2) + '\n');
    await fs.rename(tmp, MENU_FILE);
  });
  return writing;
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

// --- Sessions (in memory; a restart signs everyone out) ---
const sessions = new Map();
const attempts = new Map();

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function requireAdmin(req, res, next) {
  const token = readCookie(req, 'cm_admin');
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) {
    if (token) sessions.delete(token);
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
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, now + SESSION_HOURS * 3600000);
  res.set(
    'Set-Cookie',
    `cm_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, 'cm_admin');
  if (token) sessions.delete(token);
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
    await saveMenu(menu);
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
    await saveMenu(menu);
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
    await saveMenu(menu);
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
    await saveMenu(menu);
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
    await saveMenu(menu);
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
    await saveMenu(menu);
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
    await saveMenu(menu);
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
  console.error(err);
  res.status(500).json({ error: 'Sunucuda bir sorun oluştu, değişiklik kaydedilmedi. Tekrar dene.' });
});

app.listen(PORT, () => {
  console.log(`Chez Moi: http://localhost:${PORT}  ·  Yönetim: http://localhost:${PORT}/admin`);
});
