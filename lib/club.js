// Club nights (events), restaurant reservations and guest lists: validation, public forms and admin routes.
import crypto from 'node:crypto';
import express from 'express';

export const FLOORS = { zemin: 'Zemin kat', roof: 'Roof bar', ikisi: 'Zemin kat ve roof bar' };
export const GENRES = ['Elektronik', 'Pop', 'İndie', 'Türkçe pop', 'Yabancı pop', 'House', 'Techno', 'Canlı performans'];
export const RES_STATUS = { yeni: 'Yeni', onaylandi: 'Onaylandı', iptal: 'İptal' };
export const GUEST_STATUS = { bekliyor: 'Bekliyor', onaylandi: 'Onaylandı', geldi: 'Geldi', iptal: 'İptal' };

// Today in Istanbul as YYYY-MM-DD, so "upcoming" means the same thing wherever the server runs.
export const todayIstanbul = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Turkish mobile and landline numbers in any common spelling, kept as +90XXXXXXXXXX; foreign numbers as typed.
export function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+/, '');
  if (/^(90)?0?[2-5]\d{9}$/.test(bare)) return `+90${bare.slice(-10)}`;
  if (digits.startsWith('+') && bare.length >= 8 && bare.length <= 15) return `+${bare}`;
  return null;
}
const isEmail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

// --- Events ---
export function readEventBody(body) {
  const title = clean(body?.title, 90);
  const date = body?.date;
  const time = body?.time || '22:00';
  const floor = FLOORS[body?.floor] ? body.floor : 'ikisi';
  const genres = (Array.isArray(body?.genres) ? body.genres : []).map((g) => clean(g, 30)).filter(Boolean).slice(0, 6);
  const lineup = (Array.isArray(body?.lineup) ? body.lineup : String(body?.lineup || '').split(/[,\n]/))
    .map((a) => clean(a, 60)).filter(Boolean).slice(0, 12);
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 600) : '';
  const ticketUrl = clean(body?.ticketUrl, 300);
  const capacity = body?.capacity === '' || body?.capacity == null ? null : Number(body.capacity);
  if (!title) return { error: 'Etkinlik adı boş olamaz.' };
  if (!isDate(date)) return { error: 'Geçerli bir tarih seç.' };
  if (!isTime(time)) return { error: 'Saat 22:00 biçiminde olmalı.' };
  if (ticketUrl && !/^https:\/\/[^\s]+$/.test(ticketUrl)) return { error: 'Bilet linki https:// ile başlamalı.' };
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 5000)) return { error: 'Kapasite 1 ile 5000 arasında bir sayı olmalı.' };
  return {
    value: {
      title, date, time, floor, genres, lineup, description, ticketUrl,
      guestlist: Boolean(body?.guestlist), capacity,
      published: Boolean(body?.published),
      poster: typeof body?.poster === 'string' && /^[\w-]+\.(jpg|png|webp)$/.test(body.poster) ? body.poster : null,
    },
  };
}

export const upcoming = (events) =>
  events.filter((e) => e.published && e.date >= todayIstanbul()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
export const past = (events) =>
  events.filter((e) => e.published && e.date < todayIstanbul()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

// --- Spam: a hidden field people never fill, and a per-address limit ---
function limiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin ya da bizi arayın.' });
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

function personFields(body) {
  const name = clean(body?.name, 80);
  const phone = normalisePhone(body?.phone);
  const email = clean(body?.email, 120).toLowerCase();
  if (body?.website) return { spam: true };
  if (name.length < 2) return { error: 'Adınızı ve soyadınızı yazın.', field: 'name' };
  if (!phone) return { error: 'Telefon numaranızı 05XX XXX XX XX biçiminde yazın.', field: 'phone' };
  if (!isEmail(email)) return { error: 'E-posta adresi geçerli görünmüyor.', field: 'email' };
  if (body?.consent !== true) return { error: 'Devam etmek için bilgilerinizin kullanımına onay verin.', field: 'consent' };
  return { value: { name, phone, email: email || null } };
}

export function clubRoutes({ app, eventsDoc, posters, db, requireAdmin }) {
  const publicLimit = limiter(6, 10 * 60000);

  // Restaurant reservation request
  app.post('/api/reservations', publicLimit, async (req, res, next) => {
    try {
      const person = personFields(req.body);
      if (person.spam) return res.status(201).json({ ok: true });
      if (person.error) return res.status(400).json({ error: person.error, field: person.field });
      const { date, time } = req.body;
      const people = Number(req.body?.people);
      const today = todayIstanbul();
      if (!isDate(date) || date < today || date > addDays(today, 90)) return res.status(400).json({ error: 'Bugünden itibaren 90 gün içinde bir tarih seçin.', field: 'date' });
      if (!isTime(time)) return res.status(400).json({ error: 'Bir saat seçin.', field: 'time' });
      if (!Number.isInteger(people) || people < 1 || people > 30) return res.status(400).json({ error: 'Kişi sayısı 1 ile 30 arasında olmalı. Daha kalabalık gruplar için bizi arayın.', field: 'people' });
      const area = ['restoran', 'teras', 'farketmez'].includes(req.body?.area) ? req.body.area : 'farketmez';
      const row = await db.insert('reservations', {
        ...person.value, date, time, people, area, note: clean(req.body?.note, 400) || null, status: 'yeni',
      });
      res.status(201).json({ ok: true, id: row.id });
    } catch (err) {
      next(err);
    }
  });

  // Guest-list sign-up for an event without a ticket link
  app.post('/api/events/:id/guestlist', publicLimit, async (req, res, next) => {
    try {
      const { events } = await eventsDoc.read();
      const event = events.find((e) => e.id === req.params.id && e.published);
      if (!event || event.date < todayIstanbul()) return res.status(404).json({ error: 'Bu etkinlik artık kayda açık değil.' });
      if (!event.guestlist || event.ticketUrl) return res.status(400).json({ error: 'Bu etkinlik için ön kayıt yok; bilet linkini kullanın.' });
      const person = personFields(req.body);
      if (person.spam) return res.status(201).json({ ok: true });
      if (person.error) return res.status(400).json({ error: person.error, field: person.field });
      const people = Number(req.body?.people);
      if (!Number.isInteger(people) || people < 1 || people > 6) return res.status(400).json({ error: 'Kişi sayısı 1 ile 6 arasında olmalı.', field: 'people' });
      const existing = (await db.list('guestlist', { eq: { event_id: event.id } })).filter((g) => g.status !== 'iptal');
      if (existing.some((g) => g.phone === person.value.phone)) return res.status(409).json({ error: 'Bu telefon numarasıyla bu gece için zaten kaydınız var.', field: 'phone' });
      const taken = existing.reduce((sum, g) => sum + g.people, 0);
      if (event.capacity && taken + people > event.capacity) {
        const left = Math.max(0, event.capacity - taken);
        return res.status(409).json({ error: left ? `Listede ${left} kişilik yer kaldı.` : 'Ön kayıt listesi doldu.', field: 'people' });
      }
      const row = await db.insert('guestlist', {
        ...person.value, people, event_id: event.id, event_title: event.title, event_date: event.date, status: 'bekliyor',
      });
      res.status(201).json({ ok: true, id: row.id });
    } catch (err) {
      next(err);
    }
  });

  // Posters
  app.get('/uploads/:name', async (req, res, next) => {
    try {
      if (!/^[\w-]+\.(jpg|png|webp)$/.test(req.params.name)) return res.sendStatus(404);
      const buf = await posters.get(req.params.name);
      if (!buf) return res.sendStatus(404);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.type(req.params.name.split('.').pop()).send(buf);
    } catch (err) {
      next(err);
    }
  });

  const imageBody = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' });
  app.post('/api/uploads', requireAdmin, imageBody, async (req, res, next) => {
    try {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.headers['content-type']];
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'JPG, PNG ya da WEBP bir görsel seçin (en fazla 3 MB).' });
      const name = `poster-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
      await posters.put(name, req.body, `Afiş yüklendi: ${name}`);
      res.status(201).json({ name, url: `/uploads/${name}` });
    } catch (err) {
      next(err);
    }
  });

  // Events (admin)
  app.get('/api/admin/events', requireAdmin, async (_req, res, next) => {
    try {
      res.json((await eventsDoc.read()).events.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)));
    } catch (err) {
      next(err);
    }
  });
  app.post('/api/admin/events', requireAdmin, async (req, res, next) => {
    try {
      const { error, value } = readEventBody(req.body);
      if (error) return res.status(400).json({ error });
      const doc = await eventsDoc.read();
      const event = { id: `e${crypto.randomBytes(4).toString('hex')}`, ...value };
      doc.events.push(event);
      await eventsDoc.save(doc, `Etkinlik eklendi: ${event.title} (${event.date})`);
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  });
  app.put('/api/admin/events/:id', requireAdmin, async (req, res, next) => {
    try {
      const { error, value } = readEventBody(req.body);
      if (error) return res.status(400).json({ error });
      const doc = await eventsDoc.read();
      const index = doc.events.findIndex((e) => e.id === req.params.id);
      if (index === -1) return res.status(404).json({ error: 'Bu etkinlik artık yok. Sayfayı yenile.' });
      doc.events[index] = { ...doc.events[index], ...value };
      await eventsDoc.save(doc, `Etkinlik güncellendi: ${value.title} (${value.date})`);
      res.json(doc.events[index]);
    } catch (err) {
      next(err);
    }
  });
  app.delete('/api/admin/events/:id', requireAdmin, async (req, res, next) => {
    try {
      const doc = await eventsDoc.read();
      const event = doc.events.find((e) => e.id === req.params.id);
      if (!event) return res.status(404).json({ error: 'Bu etkinlik artık yok. Sayfayı yenile.' });
      doc.events = doc.events.filter((e) => e.id !== event.id);
      await eventsDoc.save(doc, `Etkinlik silindi: ${event.title} (${event.date})`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Reservations and guest lists (admin)
  const tables = { reservations: RES_STATUS, guestlist: GUEST_STATUS };
  for (const [table, statuses] of Object.entries(tables)) {
    app.get(`/api/admin/${table}`, requireAdmin, async (req, res, next) => {
      try {
        const eq = table === 'guestlist' && req.query.event ? { event_id: String(req.query.event) } : undefined;
        res.set('Cache-Control', 'no-store');
        res.json(await db.list(table, { eq }));
      } catch (err) {
        next(err);
      }
    });
    app.patch(`/api/admin/${table}/:id`, requireAdmin, async (req, res, next) => {
      try {
        if (!statuses[req.body?.status]) return res.status(400).json({ error: 'Geçersiz durum.' });
        const row = await db.update(table, req.params.id, { status: req.body.status });
        if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı. Sayfayı yenile.' });
        res.json(row);
      } catch (err) {
        next(err);
      }
    });
    app.delete(`/api/admin/${table}/:id`, requireAdmin, async (req, res, next) => {
      try {
        if (!(await db.remove(table, req.params.id))) return res.status(404).json({ error: 'Kayıt bulunamadı. Sayfayı yenile.' });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    });
  }
}
