// Chez Moi — menu admin: categories and items, edited in place and saved to /api.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const state = { categories: [], items: [], query: '' };
  const drafts = new Map(); // item id -> unsaved field values, kept across re-renders

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const showPrice = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
  const fold = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  const countIn = (catId) => state.items.filter((i) => i.categoryId === catId).length;
  const catName = (id) => state.categories.find((c) => c.id === id)?.name ?? '';

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/login') {
      showLogin('Oturumun süresi doldu. Lütfen yeniden giriş yap.');
      throw new Error(data.error || 'Oturum kapandı');
    }
    if (!res.ok) throw new Error(data.error || 'Bir sorun oluştu. Tekrar dene.');
    return data;
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(text, action) {
    const el = $('#toast');
    const btn = $('#toast-action');
    $('#toast-text').textContent = text;
    btn.hidden = !action;
    btn.onclick = action ? () => { el.hidden = true; action(); } : null;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3500);
  }

  // ---------- confirm ----------
  function confirmAction(title, text, okLabel = 'Sil') {
    const dlg = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  // ---------- login ----------
  function showLogin(message = '') {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message;
    $('#password').value = '';
    $('#password').focus();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#password');
    const err = $('#login-error');
    if (!input.value) { err.textContent = 'Şifreyi gir.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    const btn = e.submitter || $('#login-form button');
    btn.disabled = true;
    try {
      await api('POST', '/api/login', { password: input.value });
      input.removeAttribute('aria-invalid');
      await start();
    } catch (error) {
      err.textContent = error.message;
      input.setAttribute('aria-invalid', 'true');
      input.select();
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    if (drafts.size && !window.confirm('Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?')) return;
    drafts.clear();
    await api('POST', '/api/logout').catch(() => {});
    showLogin('Çıkış yaptın.');
  });

  async function start() {
    const menu = await api('GET', '/api/menu');
    state.categories = menu.categories;
    state.items = menu.items;
    $('#login').hidden = true;
    $('#app').hidden = false;
    render();
    document.dispatchEvent(new Event('cm:start')); // the other tabs (admin-club.js) load now
  }

  // Shared with admin-club.js
  window.CMAdmin = { api, toast, confirmAction, esc };

  // ---------- render ----------
  const icons = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  };

  function render() {
    renderCategories();
    renderItems();
  }

  function renderCategories() {
    const list = $('#cat-list');
    $('#cat-total').textContent = `${state.categories.length} kategori`;
    list.innerHTML = state.categories
      .map((c, i) => {
        const n = countIn(c.id);
        return `
        <li class="cat-row" data-cat="${c.id}">
          <button class="cat-jump" type="button" data-act="jump"><span>${esc(c.name)}</span><span class="cat-count">${n}</span></button>
          <span class="cat-tools">
            <button class="icon-btn" type="button" data-act="rename" aria-label="${esc(c.name)} adını değiştir">${icons.edit}</button>
            <button class="icon-btn" type="button" data-act="up" aria-label="${esc(c.name)} yukarı taşı" ${i === 0 ? 'disabled' : ''}>${icons.up}</button>
            <button class="icon-btn" type="button" data-act="down" aria-label="${esc(c.name)} aşağı taşı" ${i === state.categories.length - 1 ? 'disabled' : ''}>${icons.down}</button>
            <button class="icon-btn icon-btn--danger" type="button" data-act="delete" aria-label="${esc(c.name)} kategorisini sil">${icons.trash}</button>
          </span>
        </li>`;
      })
      .join('');
  }

  function itemRow(item) {
    const d = drafts.get(item.id) || {};
    const v = {
      name: d.name ?? item.name,
      description: d.description ?? item.description,
      price: d.price ?? showPrice(item.price),
      categoryId: d.categoryId ?? item.categoryId,
    };
    const options = state.categories
      .map((c) => `<option value="${c.id}"${c.id === v.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`)
      .join('');
    return `
      <form class="item-row${drafts.has(item.id) ? ' is-dirty' : ''}" data-item="${item.id}" novalidate>
        <label class="c-name"><span class="sr-only">Ürün adı</span><input name="name" value="${esc(v.name)}" maxlength="90" required aria-describedby="err-${item.id}"></label>
        <label class="c-desc"><span class="sr-only">Açıklama</span><textarea name="description" maxlength="300" placeholder="Açıklama yok">${esc(v.description)}</textarea></label>
        <label class="price"><span class="sr-only">Fiyat, Türk lirası</span><input name="price" value="${esc(v.price)}" inputmode="decimal" required aria-describedby="err-${item.id}"></label>
        <label class="c-cat"><span class="sr-only">Kategori</span><select name="categoryId">${options}</select></label>
        <div class="row-actions">
          <button class="btn save-btn" type="submit" ${drafts.has(item.id) ? '' : 'disabled'}>Kaydet</button>
          <button class="icon-btn icon-btn--danger" type="button" data-act="delete-item" aria-label="${esc(item.name)} ürününü sil">${icons.trash}</button>
        </div>
        <p class="row-error" id="err-${item.id}" role="alert" hidden></p>
      </form>`;
  }

  function renderItems() {
    const q = fold(state.query.trim());
    const match = (i) => !q || fold(`${i.name} ${i.description}`).includes(q);
    let shown = 0;
    $('#groups').innerHTML = state.categories
      .map((c) => {
        const items = state.items.filter((i) => i.categoryId === c.id);
        const visible = items.filter(match);
        shown += visible.length;
        if (q && !visible.length) return '';
        return `
        <section class="group" id="g-${c.id}" aria-labelledby="gh-${c.id}">
          <div class="group-head">
            <h3 id="gh-${c.id}">${esc(c.name)} <span class="muted">· ${items.length}</span></h3>
            <button class="btn" type="button" data-act="add-to" data-cat="${c.id}">Bu kategoriye ekle</button>
          </div>
          ${
            visible.length
              ? `<div class="row-head" aria-hidden="true"><span>Ad</span><span>Açıklama</span><span>Fiyat</span><span>Kategori</span><span></span></div>${visible.map(itemRow).join('')}`
              : '<p class="group-empty">Bu kategoride henüz ürün yok.</p>'
          }
        </section>`;
      })
      .join('');
    $('#item-total').textContent = `· ${state.items.length}`;
    $('#no-results').hidden = !(q && !shown);
  }

  // ---------- categories ----------
  $('#cat-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#cat-new');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      const cat = await api('POST', '/api/categories', { name });
      state.categories.push(cat);
      input.value = '';
      render();
      toast(`“${cat.name}” kategorisi eklendi.`);
    } catch (err) {
      toast(err.message);
    }
  });

  $('#cat-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('[data-cat]');
    const id = row.dataset.cat;
    const index = state.categories.findIndex((c) => c.id === id);
    const cat = state.categories[index];
    const act = btn.dataset.act;

    if (act === 'jump') {
      $(`#g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (act === 'rename') {
      const jump = row.querySelector('.cat-jump');
      const input = document.createElement('input');
      input.value = cat.name;
      input.maxLength = 60;
      input.setAttribute('aria-label', 'Kategori adı');
      jump.replaceWith(input);
      row.querySelector('.cat-tools').hidden = true;
      input.focus();
      input.select();
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (save && name && name !== cat.name) {
          try {
            const updated = await api('PUT', `/api/categories/${id}`, { name });
            cat.name = updated.name;
            toast('Kategori adı kaydedildi.');
          } catch (err) {
            toast(err.message);
          }
        }
        render();
        $(`[data-cat="${id}"] [data-act="rename"]`)?.focus();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        if (ev.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      return;
    }
    if (act === 'up' || act === 'down') {
      const to = act === 'up' ? index - 1 : index + 1;
      if (to < 0 || to >= state.categories.length) return;
      const order = state.categories.slice();
      [order[index], order[to]] = [order[to], order[index]];
      try {
        state.categories = await api('PUT', '/api/categories/order', { ids: order.map((c) => c.id) });
        render();
        ($(`[data-cat="${id}"] [data-act="${act}"]:not(:disabled)`) || $(`[data-cat="${id}"] .cat-jump`))?.focus();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (act === 'delete') {
      const n = countIn(id);
      if (n) {
        toast(`“${cat.name}” kategorisinde ${n} ürün var. Önce ürünleri silin ya da başka kategoriye taşıyın.`);
        return;
      }
      const ok = await confirmAction('Kategori silinsin mi?', `“${cat.name}” kategorisi kalıcı olarak silinecek.`, 'Kategoriyi sil');
      if (!ok) return;
      try {
        await api('DELETE', `/api/categories/${id}`);
        state.categories = state.categories.filter((c) => c.id !== id);
        render();
        toast(`“${cat.name}” kategorisi silindi.`);
      } catch (err) {
        toast(err.message);
      }
    }
  });

  // ---------- items: edit in place ----------
  const groups = $('#groups');

  function readRow(form) {
    const f = new FormData(form);
    return { name: f.get('name'), description: f.get('description'), price: f.get('price'), categoryId: f.get('categoryId') };
  }

  groups.addEventListener('input', (e) => {
    const form = e.target.closest('.item-row');
    if (!form) return;
    const id = form.dataset.item;
    const item = state.items.find((i) => i.id === id);
    const v = readRow(form);
    const dirty =
      v.name !== item.name || v.description !== item.description || v.price !== showPrice(item.price) || v.categoryId !== item.categoryId;
    if (dirty) drafts.set(id, v);
    else drafts.delete(id);
    form.classList.toggle('is-dirty', dirty);
    form.querySelector('.save-btn').disabled = !dirty;
  });

  // Validate on blur, so a bad price or an empty name is named before Kaydet is pressed
  groups.addEventListener('focusout', (e) => {
    const input = e.target;
    const form = input.closest('.item-row');
    if (!form || !['name', 'price'].includes(input.name)) return;
    const errEl = form.querySelector('.row-error');
    const value = input.value.trim();
    const bad = input.name === 'name' ? !value : !value || Number.isNaN(Number(value.replace(',', '.')));
    input.toggleAttribute('aria-invalid', bad);
    if (bad) {
      errEl.textContent = input.name === 'name' ? 'Ürün adı boş olamaz.' : 'Fiyatı sayı olarak yaz, örneğin 245 ya da 245,50.';
      errEl.hidden = false;
    } else if (!form.querySelector('[aria-invalid]')) {
      errEl.hidden = true;
    }
  });

  groups.addEventListener('keydown', (e) => {
    const form = e.target.closest('.item-row');
    if (!form) return;
    if (e.key === 'Escape' && drafts.has(form.dataset.item)) {
      drafts.delete(form.dataset.item);
      const item = state.items.find((i) => i.id === form.dataset.item);
      form.outerHTML = itemRow(item);
      toast('Değişiklik geri alındı.');
    }
    if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  groups.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target.closest('.item-row');
    if (!form) return;
    const id = form.dataset.item;
    if (!drafts.has(id)) return;
    const errEl = form.querySelector('.row-error');
    const btn = form.querySelector('.save-btn');
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor';
    try {
      const updated = await api('PUT', `/api/items/${id}`, readRow(form));
      const before = state.items.find((i) => i.id === id);
      const moved = before.categoryId !== updated.categoryId;
      drafts.delete(id);
      if (moved) {
        state.items = state.items.filter((i) => i.id !== id);
        const last = state.items.findLastIndex((i) => i.categoryId === updated.categoryId);
        state.items.splice(last === -1 ? state.items.length : last + 1, 0, updated);
        render();
        toast(`“${updated.name}” ${catName(updated.categoryId)} kategorisine taşındı.`);
        flash(id);
      } else {
        Object.assign(before, updated);
        form.outerHTML = itemRow(updated);
        renderCategories();
        flash(id);
        toast('Kaydedildi.');
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Kaydet';
    }
  });

  function flash(id) {
    const row = $(`.item-row[data-item="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.add('is-saved');
    setTimeout(() => row.classList.remove('is-saved'), 1400);
  }

  groups.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add-to') { openNew(btn.dataset.cat); return; }
    if (btn.dataset.act !== 'delete-item') return;
    const form = btn.closest('.item-row');
    const id = form.dataset.item;
    const item = state.items.find((i) => i.id === id);
    try {
      const res = await api('DELETE', `/api/items/${id}`);
      state.items = state.items.filter((i) => i.id !== id);
      drafts.delete(id);
      render();
      toast(`“${item.name}” silindi.`, async () => {
        try {
          const back = await api('POST', '/api/items', { ...item, restore: { id: item.id, index: res.index } });
          state.items.splice(Math.min(res.index, state.items.length), 0, back);
          render();
          flash(back.id);
          toast(`“${back.name}” geri geldi.`);
        } catch (err) {
          toast(err.message);
        }
      });
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- search ----------
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderItems(); });

  // ---------- new item ----------
  const dlg = $('#item-dialog');
  const itemForm = $('#item-form');
  function openNew(categoryId) {
    itemForm.reset();
    itemForm.categoryId.innerHTML = state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (categoryId) itemForm.categoryId.value = categoryId;
    $('[data-error]', itemForm).textContent = '';
    itemForm.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    dlg.showModal();
    itemForm.name.focus();
  }
  $('#new-item').addEventListener('click', () => {
    if (!state.categories.length) { toast('Önce bir kategori ekle.'); $('#cat-new').focus(); return; }
    openNew(state.categories[0].id);
  });
  $('[data-close]', itemForm).addEventListener('click', () => dlg.close());
  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-error]', itemForm);
    const name = itemForm.name.value.trim();
    const price = itemForm.price.value.trim();
    itemForm.name.toggleAttribute('aria-invalid', !name);
    if (!name) { err.textContent = 'Ürün adını yaz.'; itemForm.name.focus(); return; }
    if (!price || Number.isNaN(Number(price.replace(',', '.')))) {
      itemForm.price.setAttribute('aria-invalid', 'true');
      err.textContent = 'Fiyatı sayı olarak yaz, örneğin 245 ya da 245,50.';
      itemForm.price.focus();
      return;
    }
    itemForm.price.removeAttribute('aria-invalid');
    try {
      const item = await api('POST', '/api/items', {
        name, price, categoryId: itemForm.categoryId.value, description: itemForm.description.value,
      });
      const last = state.items.findLastIndex((i) => i.categoryId === item.categoryId);
      state.items.splice(last === -1 ? state.items.length : last + 1, 0, item);
      dlg.close();
      state.query = '';
      $('#search').value = '';
      render();
      flash(item.id);
      toast(`“${item.name}” ${catName(item.categoryId)} kategorisine eklendi.`);
    } catch (error) {
      err.textContent = error.message;
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (drafts.size) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- boot ----------
  fetch('/api/session', { credentials: 'same-origin' })
    .then((r) => (r.ok ? start() : showLogin()))
    .catch(() => showLogin('Sunucuya ulaşılamadı. Sayfayı yenile.'));
})();
