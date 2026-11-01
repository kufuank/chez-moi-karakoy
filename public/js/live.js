// The live layer of the static site: refreshes the menu, dish tags and club nights from Supabase (so admin edits
// show without a rebuild), and sends the two public forms to their database functions.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { renderMenu, renderMenuNav, renderDish, renderEvents, renderPastEvents, renderArtists, todayIstanbul } from './render.js';

const BASE = document.documentElement.dataset.base || '';
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function select(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return res.json();
}

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.message || 'Bir sorun oluştu. Lütfen tekrar deneyin ya da bizi arayın: 0549 600 35 36');
    error.field = body.hint && body.hint !== 'rate' ? body.hint : null;
    throw error;
  }
  return body;
}

// Swap a block's markup only when it changed, then let the scroll animations re-measure.
function swap(el, html) {
  if (!el || el.innerHTML.trim() === html.trim()) return false;
  el.innerHTML = html;
  return true;
}
const relayout = () => window.ScrollTrigger && window.ScrollTrigger.refresh();

// ---------- Menu page and the dish tags on the home page ----------
const menuList = document.getElementById('menu-list');
const dishTags = document.querySelectorAll('[data-dish]');
if (menuList || dishTags.length) {
  Promise.all([select('chezmoi_categories', 'select=*'), select('chezmoi_items', 'select=*')])
    .then(([categories, items]) => {
      const menu = { categories, items };
      let changed = false;
      if (menuList) {
        changed = swap(menuList, renderMenu(menu)) || changed;
        swap(document.getElementById('menu-nav-list'), renderMenuNav(menu));
        document.dispatchEvent(new Event('cm:menu')); // site.js re-binds the category bar
      }
      dishTags.forEach((tag) => { changed = swap(tag, renderDish(menu, tag.dataset.dish)) || changed; });
      if (changed) relayout();
    })
    .catch(() => {}); // the menu baked into the page stays
}

// ---------- Club nights ----------
const eventList = document.getElementById('event-list');
if (eventList) {
  select('chezmoi_events', 'select=*&published=eq.true')
    .then((events) => {
      let changed = swap(eventList, renderEvents(events, BASE));
      changed = swap(document.getElementById('artists-slot'), renderArtists(events)) || changed;
      changed = swap(document.getElementById('past-slot'), renderPastEvents(events)) || changed;
      if (changed) relayout();
    })
    .catch(() => {});
}

// ---------- Forms ----------
async function submit(form, errorEl, call, onDone) {
  const button = form.querySelector('[type="submit"]');
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  errorEl.textContent = '';
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Gönderiliyor…';
  try {
    await call();
    onDone();
  } catch (err) {
    errorEl.textContent = err instanceof TypeError
      ? 'Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin ya da bizi arayın: 0549 600 35 36'
      : err.message;
    const field = err.field && form.querySelector(`[name="${err.field}"]`);
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const bookingForm = document.getElementById('booking-form');
if (bookingForm) {
  // The page was built on another day: dates come from today in Istanbul.
  const today = todayIstanbul();
  const max = new Date(Date.parse(`${today}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10);
  Object.assign(bookingForm.date, { min: today, max });
  if (!bookingForm.date.value || bookingForm.date.value < today) bookingForm.date.value = today;

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = bookingForm;
    submit(f, document.getElementById('b-error'), () => rpc('chezmoi_reserve', {
      p_name: f.name.value, p_phone: f.phone.value, p_email: f.email.value, p_date: f.date.value || null, p_time: f.time.value,
      p_people: Number(f.people.value), p_area: f.area.value, p_note: f.note.value, p_consent: f.consent.checked, p_website: f.website.value,
    }), () => {
      f.hidden = true;
      const done = document.getElementById('booking-done');
      done.hidden = false;
      done.focus();
      done.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    });
  });
}

const sheet = document.getElementById('guestlist');
if (sheet) {
  const form = document.getElementById('guestlist-form');
  const done = document.getElementById('gl-done');
  let opener = null;
  // Delegated: the event list is re-rendered after the live refresh.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-guestlist]');
    if (!btn) return;
    opener = btn;
    form.reset();
    form.hidden = false;
    done.hidden = true;
    document.getElementById('gl-error').textContent = '';
    form.eventId.value = btn.dataset.eventId;
    document.getElementById('gl-event').textContent = `${btn.dataset.eventTitle} · ${btn.dataset.eventDate}`;
    sheet.showModal();
    form.name.focus();
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) sheet.close(); });
  sheet.addEventListener('close', () => opener?.focus());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form, document.getElementById('gl-error'), () => rpc('chezmoi_guestlist_signup', {
      p_event_id: form.eventId.value, p_name: form.name.value, p_phone: form.phone.value, p_email: form.email.value,
      p_people: Number(form.people.value), p_consent: form.consent.checked, p_website: form.website.value,
    }), () => {
      form.hidden = true;
      done.hidden = false;
      done.querySelector('button').focus();
    });
  });
}
