// Chez Moi — admin tabs beyond the menu: club events, restaurant reservations and guest lists.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const { api, toast, confirmAction, esc } = window.CMAdmin;
  const GENRES = ['Elektronik', 'Pop', 'İndie', 'Türkçe pop', 'Yabancı pop', 'House', 'Techno', 'Canlı performans'];
  const FLOORS = { zemin: 'Zemin kat', roof: 'Roof bar', ikisi: 'Zemin kat ve roof bar' };
  const AREAS = { restoran: 'Restoran', teras: 'Teras meyhane', farketmez: 'Fark etmez' };
  const RES_STATUS = { yeni: 'Yeni', onaylandi: 'Onaylandı', iptal: 'İptal' };
  const GUEST_STATUS = { bekliyor: 'Bekliyor', onaylandi: 'Onaylandı', geldi: 'Geldi', iptal: 'İptal' };
  const state = { events: [], reservations: [], guests: [], loaded: {} };

  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
  const trDate = (iso, opts = { day: 'numeric', month: 'long', weekday: 'short' }) =>
    new Intl.DateTimeFormat('tr-TR', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
  const prettyPhone = (p) => (p?.startsWith('+90') && p.length === 13 ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9, 11)} ${p.slice(11)}` : p || '');
  const statusSelect = (statuses, value, label) =>
    `<select class="status status--${value}" data-act="status" aria-label="${esc(label)}">${Object.entries(statuses)
      .map(([k, v]) => `<option value="${k}"${k === value ? ' selected' : ''}>${v}</option>`)
      .join('')}</select>`;

  // ---------- tabs (the address bar remembers the open one) ----------
  const tabs = [...document.querySelectorAll('[data-tab]')];
  function showTab(name) {
    if (!tabs.some((t) => t.dataset.tab === name)) name = 'menu';
    tabs.forEach((t) => (t.dataset.tab === name ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (name === 'etkinlikler' && !state.loaded.events) loadEvents();
    if (name === 'rezervasyonlar') loadReservations();
    if (name === 'onkayit') loadGuestPanel();
  }
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  // ---------- events ----------
  async function loadEvents() {
    state.events = await api('GET', '/api/admin/events');
    state.loaded.events = true;
    renderEvents();
  }

  function renderEvents() {
    const t = today();
    $('#ev-total').textContent = `· ${state.events.length}`;
    $('#event-list').innerHTML = state.events.length
      ? state.events
          .map((e) => {
            const isPast = e.date < t;
            const entry = e.ticketUrl ? 'Bilet linki' : e.guestlist ? `Ön kayıt${e.capacity ? ` · ${e.capacity} kişi` : ''}` : 'Kapıda giriş';
            return `
        <article class="ev-card${isPast ? ' is-past' : ''}" data-event="${e.id}">
          <div class="ev-thumb">${e.poster ? `<img src="/uploads/${esc(e.poster)}" alt="">` : '<span>Afiş yok</span>'}</div>
          <div class="ev-info">
            <p class="ev-date">${esc(trDate(e.date))} · ${esc(e.time)}${isPast ? ' · <span class="pill">Geçti</span>' : ''}${e.published ? '' : ' · <span class="pill pill--draft">Taslak</span>'}</p>
            <h3>${esc(e.title)}</h3>
            <p class="muted">${esc([FLOORS[e.floor], e.genres.join(', ')].filter(Boolean).join(' · '))}</p>
            ${e.lineup.length ? `<p>${esc(e.lineup.join(', '))}</p>` : ''}
            <p class="muted">${esc(entry)}</p>
          </div>
          <div class="ev-actions">
            <button class="btn" type="button" data-act="edit">Düzenle</button>
            ${!e.ticketUrl && e.guestlist ? '<button class="btn" type="button" data-act="guests">Ön kayıtlar</button>' : ''}
          </div>
        </article>`;
          })
          .join('')
      : '<p class="empty">Henüz etkinlik yok. “Yeni etkinlik” ile ilk geceyi ekleyin; sitede kulüp sayfasında görünür.</p>';
  }

  const dlg = $('#event-dialog');
  const form = $('#event-form');
  let editing = null;
  let poster = null;
  $('#genre-boxes').innerHTML = GENRES.map((g) => `<label class="check-row"><input type="checkbox" name="genres" value="${esc(g)}"> <span>${esc(g)}</span></label>`).join('');

  function setPoster(name) {
    poster = name;
    $('#poster-preview').innerHTML = name ? `<img src="/uploads/${esc(name)}" alt="Seçili afiş">` : 'Afiş yok';
    $('#poster-remove').hidden = !name;
  }

  function openEvent(event) {
    editing = event || null;
    form.reset();
    $('#event-dialog-title').textContent = event ? 'Etkinliği düzenle' : 'Yeni etkinlik';
    $('#event-error').textContent = '';
    $('#event-delete').hidden = !event;
    const e = event || { title: '', date: today(), time: '22:00', floor: 'ikisi', genres: [], lineup: [], description: '', ticketUrl: '', guestlist: true, capacity: null, published: true, poster: null };
    form.title.value = e.title;
    form.date.value = e.date;
    form.time.value = e.time;
    form.floor.value = e.floor;
    form.querySelectorAll('[name="genres"]').forEach((box) => { box.checked = e.genres.includes(box.value); });
    form.lineup.value = e.lineup.join('\n');
    form.description.value = e.description;
    form.ticketUrl.value = e.ticketUrl;
    form.guestlist.checked = e.guestlist;
    form.capacity.value = e.capacity ?? '';
    form.published.checked = e.published;
    setPoster(e.poster);
    $('#poster-file').value = '';
    dlg.showModal();
    form.title.focus();
  }

  $('#new-event').addEventListener('click', () => openEvent(null));
  $('[data-close]', form).addEventListener('click', () => dlg.close());
  $('#poster-remove').addEventListener('click', () => setPoster(null));
  $('#poster-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { $('#event-error').textContent = 'Afiş en fazla 3 MB olabilir.'; e.target.value = ''; return; }
    $('#poster-preview').textContent = 'Yükleniyor…';
    try {
      const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Afiş yüklenemedi.');
      setPoster(body.name);
    } catch (err) {
      setPoster(poster);
      $('#event-error').textContent = err.message;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#event-error');
    const payload = {
      title: form.title.value,
      date: form.date.value,
      time: form.time.value,
      floor: form.floor.value,
      genres: [...form.querySelectorAll('[name="genres"]:checked')].map((b) => b.value),
      lineup: form.lineup.value,
      description: form.description.value,
      ticketUrl: form.ticketUrl.value.trim(),
      guestlist: form.guestlist.checked,
      capacity: form.capacity.value,
      published: form.published.checked,
      poster,
    };
    if (!payload.title.trim()) { err.textContent = 'Etkinlik adını yazın.'; form.title.focus(); return; }
    if (!payload.date) { err.textContent = 'Bir tarih seçin.'; form.date.focus(); return; }
    try {
      if (editing) await api('PUT', `/api/admin/events/${editing.id}`, payload);
      else await api('POST', '/api/admin/events', payload);
      dlg.close();
      await loadEvents();
      toast(editing ? 'Etkinlik güncellendi.' : 'Etkinlik eklendi; kulüp sayfasında görünüyor.');
    } catch (error) {
      err.textContent = error.message;
    }
  });

  $('#event-delete').addEventListener('click', async () => {
    if (!editing) return;
    dlg.close();
    const ok = await confirmAction('Etkinlik silinsin mi?', `“${editing.title}” sitedeki programdan kalkacak. Ön kayıtlar silinmez, Ön kayıtlar sekmesinde kalır.`, 'Etkinliği sil');
    if (!ok) return;
    try {
      await api('DELETE', `/api/admin/events/${editing.id}`);
      await loadEvents();
      toast('Etkinlik silindi.');
    } catch (error) {
      toast(error.message);
    }
  });

  $('#event-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const event = state.events.find((x) => x.id === btn.closest('[data-event]').dataset.event);
    if (btn.dataset.act === 'edit') openEvent(event);
    if (btn.dataset.act === 'guests') { $('#gl-event').value = event.id; location.hash = 'onkayit'; }
  });

  // ---------- CSV (opens in Excel with Turkish characters intact) ----------
  function downloadCsv(name, header, rows) {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const text = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- reservations ----------
  async function loadReservations() {
    try {
      state.reservations = await api('GET', '/api/admin/reservations');
      renderReservations();
    } catch (err) {
      toast(err.message);
    }
  }

  function visibleReservations() {
    const t = today();
    const f = $('#res-filter').value;
    const rows = state.reservations.filter((r) => (f === 'upcoming' ? r.date >= t : f === 'past' ? r.date < t : f === 'new' ? r.status === 'yeni' : true));
    return rows.sort((a, b) => (f === 'past' ? -1 : 1) * (a.date + a.time).localeCompare(b.date + b.time));
  }

  function renderReservations() {
    const rows = visibleReservations();
    const fresh = state.reservations.filter((r) => r.status === 'yeni' && r.date >= today()).length;
    const badge = $('#res-badge');
    badge.hidden = !fresh;
    badge.textContent = fresh;
    $('#res-total').textContent = `· ${rows.length}`;
    $('#res-empty').hidden = rows.length > 0;
    $('#res-table').innerHTML = rows.length
      ? `<thead><tr><th>Tarih</th><th>Kişi</th><th>Ad</th><th>Telefon</th><th>Alan</th><th>Not</th><th>Durum</th><th><span class="sr-only">Sil</span></th></tr></thead>
        <tbody>${rows
          .map((r) => `<tr data-row="${r.id}" class="is-${r.status}">
            <td><strong>${esc(trDate(r.date))}</strong><br>${esc(r.time)}</td>
            <td>${r.people}</td>
            <td>${esc(r.name)}${r.email ? `<br><a href="mailto:${esc(r.email)}" class="muted">${esc(r.email)}</a>` : ''}</td>
            <td><a href="tel:${esc(r.phone)}">${esc(prettyPhone(r.phone))}</a></td>
            <td>${esc(AREAS[r.area] || r.area)}</td>
            <td class="note">${esc(r.note || '')}</td>
            <td>${statusSelect(RES_STATUS, r.status, `${r.name} rezervasyon durumu`)}</td>
            <td><button class="icon-btn icon-btn--danger" type="button" data-act="delete" aria-label="${esc(r.name)} rezervasyonunu sil"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button></td>
          </tr>`)
          .join('')}</tbody>`
      : '';
  }

  $('#res-filter').addEventListener('change', renderReservations);
  $('#res-refresh').addEventListener('click', loadReservations);
  $('#res-csv').addEventListener('click', () =>
    downloadCsv(`rezervasyonlar-${today()}.csv`, ['Tarih', 'Saat', 'Kişi', 'Ad', 'Telefon', 'E-posta', 'Alan', 'Not', 'Durum', 'Alındı'],
      visibleReservations().map((r) => [r.date, r.time, r.people, r.name, prettyPhone(r.phone), r.email, AREAS[r.area], r.note, RES_STATUS[r.status], r.created_at])));

  // ---------- guest lists ----------
  async function loadGuestPanel() {
    if (!state.loaded.events) await loadEvents().catch(() => {});
    const select = $('#gl-event');
    const current = select.value;
    const listed = state.events.filter((e) => e.guestlist && !e.ticketUrl);
    select.innerHTML = listed.length
      ? listed.map((e) => `<option value="${e.id}">${esc(trDate(e.date, { day: 'numeric', month: 'short' }))} · ${esc(e.title)}</option>`).join('')
      : '<option value="">Ön kayıtlı etkinlik yok</option>';
    const upcomingFirst = listed.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];
    select.value = listed.some((e) => e.id === current) ? current : upcomingFirst?.id || listed[0]?.id || '';
    await loadGuests();
  }

  async function loadGuests() {
    const id = $('#gl-event').value;
    state.guests = id ? await api('GET', `/api/admin/guestlist?event=${encodeURIComponent(id)}`).catch((err) => { toast(err.message); return []; }) : [];
    renderGuests();
  }

  function renderGuests() {
    const event = state.events.find((e) => e.id === $('#gl-event').value);
    const active = state.guests.filter((g) => g.status !== 'iptal');
    const people = active.reduce((s, g) => s + g.people, 0);
    $('#gl-total').textContent = event ? `· ${people} kişi${event.capacity ? ` / ${event.capacity}` : ''}` : '';
    $('#gl-empty').hidden = state.guests.length > 0;
    $('#gl-table').innerHTML = state.guests.length
      ? `<thead><tr><th>Ad</th><th>Kişi</th><th>Telefon</th><th>E-posta</th><th>Kayıt</th><th>Durum</th><th><span class="sr-only">Sil</span></th></tr></thead>
        <tbody>${state.guests
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
          .map((g) => `<tr data-row="${g.id}" class="is-${g.status}">
            <td><strong>${esc(g.name)}</strong></td>
            <td>${g.people}</td>
            <td><a href="tel:${esc(g.phone)}">${esc(prettyPhone(g.phone))}</a></td>
            <td>${g.email ? `<a href="mailto:${esc(g.email)}">${esc(g.email)}</a>` : ''}</td>
            <td class="muted">${esc(new Date(g.created_at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }))}</td>
            <td>${statusSelect(GUEST_STATUS, g.status, `${g.name} ön kayıt durumu`)}</td>
            <td><button class="icon-btn icon-btn--danger" type="button" data-act="delete" aria-label="${esc(g.name)} kaydını sil"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button></td>
          </tr>`)
          .join('')}</tbody>`
      : '';
  }

  $('#gl-event').addEventListener('change', loadGuests);
  $('#gl-refresh').addEventListener('click', loadGuests);
  $('#gl-csv').addEventListener('click', () => {
    const event = state.events.find((e) => e.id === $('#gl-event').value);
    downloadCsv(`on-kayit-${event?.date || today()}.csv`, ['Ad', 'Kişi', 'Telefon', 'E-posta', 'Durum', 'Kayıt'],
      state.guests.map((g) => [g.name, g.people, prettyPhone(g.phone), g.email, GUEST_STATUS[g.status], g.created_at]));
  });

  // Status changes and deletions, for both tables
  function wireTable(tableSel, table, listKey, rerender, statuses) {
    const el = $(tableSel);
    el.addEventListener('change', async (e) => {
      if (e.target.dataset.act !== 'status') return;
      const id = e.target.closest('[data-row]').dataset.row;
      const row = state[listKey].find((r) => r.id === id);
      const previous = row.status;
      try {
        const updated = await api('PATCH', `/api/admin/${table}/${id}`, { status: e.target.value });
        Object.assign(row, updated);
        rerender();
        toast(`Durum: ${statuses[updated.status]}`);
      } catch (err) {
        e.target.value = previous;
        toast(err.message);
      }
    });
    el.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-act="delete"]')) return;
      const id = e.target.closest('[data-row]').dataset.row;
      const row = state[listKey].find((r) => r.id === id);
      const ok = await confirmAction('Kayıt silinsin mi?', `${row.name} adına olan kayıt kalıcı olarak silinecek. Bu geri alınamaz.`, 'Kaydı sil');
      if (!ok) return;
      try {
        await api('DELETE', `/api/admin/${table}/${id}`);
        state[listKey] = state[listKey].filter((r) => r.id !== id);
        rerender();
        toast('Kayıt silindi.');
      } catch (err) {
        toast(err.message);
      }
    });
  }
  wireTable('#res-table', 'reservations', 'reservations', renderReservations, RES_STATUS);
  wireTable('#gl-table', 'guestlist', 'guests', renderGuests, GUEST_STATUS);

  document.addEventListener('cm:start', () => {
    showTab(location.hash.slice(1) || 'menu');
    loadReservations(); // for the "new" badge on the tab
  });
})();
