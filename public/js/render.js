// HTML for the live parts of the site (menu, dish tags, club nights). Shared by the build (Node) and the browser,
// so the page that ships and the page after the live refresh look the same.
import { SUPABASE_URL, POSTER_BUCKET } from './config.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const priceFormat = (digits) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const formatPrice = (n) => `₺${priceFormat(Number.isInteger(Number(n)) ? 0 : 2).format(Number(n))}`;

export const todayIstanbul = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const trDate = (iso, opts) => new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
export const posterUrl = (name) => `${SUPABASE_URL}/storage/v1/object/public/${POSTER_BUCKET}/${encodeURIComponent(name)}`;

export const FLOORS = { zemin: 'Zemin kat', roof: 'Roof bar', ikisi: 'Zemin kat ve roof bar' };

// --- Menu ---
export function menuGroups({ categories, items }) {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return [...categories]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ ...c, items: sorted.filter((i) => i.category_id === c.id) }))
    .filter((c) => c.items.length);
}

export function renderMenuNav(menu) {
  return menuGroups(menu).map((c) => `<li><a href="#k-${esc(c.id)}">${esc(c.name)}</a></li>`).join('');
}

export function renderMenu(menu) {
  const groups = menuGroups(menu);
  if (!groups.length) return '<p class="menu-empty">Menü güncelleniyor. Lütfen bizi arayın: 0549 600 35 36</p>';
  return groups
    .map(
      (c) => `
      <section class="cat" id="k-${esc(c.id)}" aria-labelledby="kh-${esc(c.id)}">
        <h2 class="cat-title" id="kh-${esc(c.id)}" data-reveal>${esc(c.name)}</h2>
        <ul class="items">${c.items
          .map(
            (i) => `
          <li class="item" data-reveal>
            <span class="item-name">${esc(i.name)}</span>
            <span class="item-price">${formatPrice(i.price)}</span>${i.description ? `\n            <span class="item-desc">${esc(i.description)}</span>` : ''}
          </li>`
          )
          .join('')}
        </ul>
      </section>`
    )
    .join('');
}

// A dish label for the collage plates: name and price, or nothing if the item is gone.
export function renderDish(menu, id) {
  const item = menu.items.find((i) => i.id === id);
  return item ? `<span class="tag-name">${esc(item.name)}</span><span class="tag-price">${formatPrice(item.price)}</span>` : '';
}

// --- Club nights ---
const FALLBACK_POSTERS = ['night-crowd', 'night-party', 'night-bar', 'night-toast'];
export const upcoming = (events) =>
  events.filter((e) => e.published && e.date >= todayIstanbul()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
export const past = (events) =>
  events.filter((e) => e.published && e.date < todayIstanbul()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

export function renderEvents(events, base = '') {
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
        ? `<img src="${esc(posterUrl(e.poster))}" alt="${esc(e.title)} afişi" loading="lazy">`
        : `<img src="${base}/img/torn/${FALLBACK_POSTERS[i % FALLBACK_POSTERS.length]}.png" alt="" loading="lazy">`;
      const meta = [FLOORS[e.floor], (e.genres || []).join(', ')].filter(Boolean).join(' · ');
      const longDate = trDate(e.date, { day: 'numeric', month: 'long', weekday: 'long' });
      const action = e.ticket_url
        ? `<a class="button" href="${esc(e.ticket_url)}" target="_blank" rel="noopener">Bilet al</a>`
        : e.guestlist
          ? `<button class="button" type="button" data-guestlist data-event-id="${esc(e.id)}" data-event-title="${esc(e.title)}" data-event-date="${esc(longDate)}">Ön kayıt ol</button>`
          : '<p class="event-door">Giriş kapıda.</p>';
      const lineup = e.lineup || [];
      return `
      <article class="event" data-reveal>
        <figure class="event-poster${e.poster ? ' event-poster--own' : ''}">${poster}<span class="tape tape--top"></span></figure>
        <div class="event-body">
          <h3 class="event-title">${esc(e.title)}</h3>
          <p class="event-date"><span class="event-day">${trDate(e.date, { day: 'numeric' })}</span><span>${trDate(e.date, { month: 'long' })} · ${trDate(e.date, { weekday: 'long' })} · ${esc(e.time)}</span></p>
          ${meta ? `<p class="event-meta">${esc(meta)}</p>` : ''}
          ${lineup.length ? `<p class="event-lineup">${lineup.map(esc).join(' <i class="dot"></i> ')}</p>` : ''}
          ${e.description ? `<p class="event-desc">${esc(e.description)}</p>` : ''}
          <div class="event-action">${action}</div>
        </div>
      </article>`;
    })
    .join('');
}

export function renderPastEvents(events) {
  const list = past(events).slice(0, 8);
  if (!list.length) return '';
  return `<section class="past" aria-labelledby="past-title">
      <h2 class="head" id="past-title" data-reveal>Geçmiş geceler</h2>
      <ul class="past-list">${list
        .map((e) => `<li data-reveal><span class="past-date">${trDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span><span class="past-title">${esc(e.title)}</span><span class="past-lineup">${(e.lineup || []).map(esc).join(', ')}</span></li>`)
        .join('')}</ul>
    </section>`;
}

export function renderArtists(events) {
  const names = [...new Set(events.filter((e) => e.published).flatMap((e) => e.lineup || []))];
  if (!names.length) return '';
  return `<section class="artists" aria-labelledby="artists-title">
      <h2 class="display" id="artists-title" data-reveal>Bu sahnede çalanlar</h2>
      <p class="artists-list" data-reveal>${names.map((n) => `<span>${esc(n)}</span>`).join(' <i class="dot"></i> ')}</p>
    </section>`;
}
