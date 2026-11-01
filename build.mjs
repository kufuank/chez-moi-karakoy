// Builds the static site into dist/ for GitHub Pages.
//   node build.mjs            -> site at the domain root (custom domain or local preview)
//   BASE=/chez-moi-karakoy node build.mjs   -> site under a project path (https://<user>.github.io/<repo>/)
// The menu and club nights are read from Supabase and written into the pages (for search engines and visitors
// without JavaScript); public/js/live.js refreshes them in the browser, so admin edits show without a rebuild.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL, SUPABASE_KEY } from './public/js/config.js';
import { renderMenu, renderMenuNav, renderDish, renderEvents, renderPastEvents, renderArtists, esc, todayIstanbul } from './public/js/render.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const BASE = (process.env.BASE || '').replace(/\/$/, '');

// --- Data -------------------------------------------------------------------------------------------------
async function select(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadData() {
  try {
    const [categories, items, events] = await Promise.all([
      select('chezmoi_categories', 'select=*'),
      select('chezmoi_items', 'select=*'),
      select('chezmoi_events', 'select=*&published=eq.true'),
    ]);
    console.log(`Supabase: ${categories.length} kategori, ${items.length} ürün, ${events.length} etkinlik`);
    return { menu: { categories, items }, events };
  } catch (err) {
    // Offline build: fall back to the menu snapshot in the repo; the browser will still load live data.
    console.warn(`Supabase okunamadı (${err.message}); data/menu.json kullanılıyor.`);
    const m = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'menu.json'), 'utf8'));
    return {
      menu: {
        categories: m.categories.map((c, i) => ({ ...c, position: i })),
        items: m.items.map((it, i) => ({ id: it.id, category_id: it.categoryId, name: it.name, description: it.description, price: it.price, position: i })),
      },
      events: [],
    };
  }
}

function jsonLd(menu) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: 'Chez Moi Karaköy',
    image: `${BASE}/img/facade-after.jpg`,
    telephone: '+90 549 600 35 36',
    email: 'chezmoikarakoy@gmail.com',
    servesCuisine: ['Fransız', 'İtalyan', 'Osmanlı', 'Meyhane'],
    address: { '@type': 'PostalAddress', streetAddress: 'Kemankeş Karamustafa Paşa Mah. Mumhane Cad. No:36', addressLocality: 'Beyoğlu', addressRegion: 'İstanbul', addressCountry: 'TR' },
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '12:00', closes: '05:00' }],
    sameAs: ['https://www.instagram.com/chezmoikarakoy/'],
    hasMenu: {
      '@type': 'Menu',
      hasMenuSection: [...menu.categories].sort((a, b) => a.position - b.position).map((c) => ({
        '@type': 'MenuSection',
        name: c.name,
        hasMenuItem: menu.items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position).map((i) => ({
          '@type': 'MenuItem', name: i.name, ...(i.description ? { description: i.description } : {}),
          offers: { '@type': 'Offer', price: Number(i.price), priceCurrency: 'TRY' },
        })),
      })),
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// --- Pages -------------------------------------------------------------------------------------------------
const RESTAURANT_NAV = [
  ['hakkimizda', '/hakkimizda/', 'Hakkımızda'],
  ['menu', '/menu/', 'Menü'],
  ['galeri', '/galeri/', 'Galeri'],
  ['iletisim', '/iletisim/', 'İletişim'],
  ['kulup', '/kulup/', 'Kulüp'],
];
const CLUB_NAV = [
  ['', '/kulup/#etkinlikler', 'Etkinlikler'],
  ['', '/kulup/#geceler', 'Geceler'],
  ['', '/kulup/#bilgi', 'Bilgi'],
  ['restoran', '/restoran/', 'Restoran'],
];

const PAGES = [
  { out: 'restoran', view: 'home', nav: '', title: 'Chez Moi Karaköy · Restoran, kafe ve meyhane', description: "Chez Moi, Karaköy Mumhane Caddesi'nde 1870'ten kalma bir binanın beş katında kafe, restoran, bistro, bar ve teras meyhane. Her gün 12:00 – 05:00." },
  { out: 'hakkimizda', view: 'hakkimizda', nav: 'hakkimizda', title: 'Hakkımızda · Chez Moi Karaköy', description: "Fransızca'da “benim evim”: 1870'ten kalma bir binada, 2016'dan beri Karaköy'de." },
  { out: 'menu', view: 'menu', nav: 'menu', title: 'Menü · Chez Moi Karaköy', description: 'Fransız, İtalyan ve Osmanlı mutfağından tabaklar; kahvaltı, makarnalar, pizzalar ve tatlılar. Güncel fiyatlarla Chez Moi menüsü.' },
  { out: 'galeri', view: 'galeri', nav: 'galeri', title: 'Galeri · Chez Moi Karaköy', description: "Chez Moi'nin salonlarından ve mutfağından kareler." },
  { out: 'iletisim', view: 'iletisim', nav: 'iletisim', title: 'İletişim · Chez Moi Karaköy', description: 'Mumhane Caddesi No:36, Karaköy. Her gün 12:00 – 05:00. Rezervasyon: 0549 600 35 36.' },
  { out: 'rezervasyon', view: 'rezervasyon', nav: '', title: 'Rezervasyon · Chez Moi Karaköy', description: 'Chez Moi Karaköy için masa ayırtın. Talebinizi alıp sizi arayarak onaylıyoruz.' },
  { out: 'gizlilik', view: 'gizlilik', nav: '', title: 'Kişisel verilerin korunması · Chez Moi Karaköy', description: 'Rezervasyon ve ön kayıt formlarında paylaştığınız bilgilerin nasıl kullanıldığı.' },
  { out: 'kulup', view: 'kulup', nav: '', club: true, title: 'Kulüp · Chez Moi Karaköy geceleri', description: "Akşam saatlerinde Chez Moi'nin zemin katı ve roof barı kulübe dönüşüyor: yerli ve yabancı DJ'ler, elektronik, pop ve indie geceleri." },
];

// Root-relative URLs in attributes get the base path; protocol-relative (//) and absolute ones are left alone.
const withBase = (html) => (BASE ? html.replace(/(\s(?:href|src|action|content|poster)=")\/(?!\/)/g, `$1${BASE}/`) : html);

async function renderPage(page, layout, data) {
  const body = await fs.readFile(path.join(ROOT, 'views', `${page.view}.html`), 'utf8');
  const { menu, events } = data;
  const nav = (page.club ? CLUB_NAV : RESTAURANT_NAV)
    .map(([key, href, label]) => `<li><a href="${href}"${key && key === page.nav ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const cta = page.club
    ? '<a class="button button--small" href="/kulup/#etkinlikler">Ön kayıt</a>'
    : '<a class="button button--small" href="/rezervasyon/">Rezervasyon</a>';
  const today = todayIstanbul();
  const maxDate = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10);
  const filled = body
    .replace('{{MENU}}', () => renderMenu(menu))
    .replace('{{MENU_NAV}}', () => renderMenuNav(menu))
    .replace('{{EVENTS}}', () => renderEvents(events, BASE))
    .replace('{{PAST_EVENTS}}', () => renderPastEvents(events))
    .replace('{{ARTISTS}}', () => renderArtists(events))
    .replaceAll('{{TODAY}}', today)
    .replaceAll('{{MAX_DATE}}', maxDate)
    .replace(/\{\{DISH:(\w+)\}\}/g, (_m, id) => renderDish(menu, id));
  const html = layout
    .replace('{{BASE}}', BASE)
    .replace(/\{\{TITLE\}\}/g, esc(page.title))
    .replace(/\{\{DESCRIPTION\}\}/g, esc(page.description))
    .replace('{{PAGE}}', page.view)
    .replace('{{THEME}}', page.club ? 'club' : 'restaurant')
    .replace('{{HOME}}', page.club ? '/kulup/' : '/restoran/')
    .replace('{{NAV}}', nav)
    .replace('{{CTA}}', cta)
    .replace('{{JSONLD}}', () => (page.view === 'home' || page.view === 'menu' ? jsonLd(menu) : ''))
    .replace('{{BODY}}', () => filled);
  return withBase(html);
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else if (entry.name.endsWith('.html')) await fs.writeFile(dest, withBase((await fs.readFile(src, 'utf8')).replace('{{BASE}}', BASE)));
    else await fs.copyFile(src, dest);
  }
}

const started = Date.now();
await fs.rm(DIST, { recursive: true, force: true });
await copyDir(path.join(ROOT, 'public'), DIST);

const [layout, gate, data] = await Promise.all([
  fs.readFile(path.join(ROOT, 'views', 'layout.html'), 'utf8'),
  fs.readFile(path.join(ROOT, 'views', 'gate.html'), 'utf8'),
  loadData(),
]);
for (const page of PAGES) {
  await fs.mkdir(path.join(DIST, page.out), { recursive: true });
  await fs.writeFile(path.join(DIST, page.out, 'index.html'), await renderPage(page, layout, data));
}
await fs.writeFile(path.join(DIST, 'index.html'), withBase(gate.replace('{{BASE}}', BASE)));
// GitHub Pages serves 404.html for unknown addresses: send people to the door.
await fs.writeFile(path.join(DIST, '404.html'), withBase(gate.replace('{{BASE}}', BASE).replace('<title>Chez Moi Karaköy · Restoran ve kulüp</title>', '<title>Sayfa bulunamadı · Chez Moi Karaköy</title>')));
await fs.writeFile(path.join(DIST, '.nojekyll'), '');
console.log(`dist/ hazır (${PAGES.length + 1} sayfa, BASE="${BASE || '/'}") ${Date.now() - started} ms`);
