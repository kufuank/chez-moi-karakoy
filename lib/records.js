// Personal data (reservations, guest-list sign-ups) lives in Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY
// are set: rows can be deleted for good, and nothing personal ends up in git history. Without them (local
// development) the rows go to data/private/<table>.json, which is git-ignored.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Read lazily: the server loads .env after the modules are imported.
const env = () => ({ url: process.env.SUPABASE_URL?.replace(/\/$/, ''), key: process.env.SUPABASE_SERVICE_KEY });
export const supabaseOn = () => Boolean(env().url && env().key);

async function rest(method, pathAndQuery, body) {
  const { url, key } = env();
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Supabase ${method} ${pathAndQuery}: ${res.status} ${text}`);
    const error = new Error('Kayıt şu an alınamadı. Lütfen biraz sonra tekrar deneyin ya da bizi arayın.');
    error.status = 503;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

const eqQuery = (eq = {}) =>
  Object.entries(eq).map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`).join('&');

export function records(root) {
  const dir = path.join(root, 'data', 'private');
  const file = (table) => path.join(dir, `${table}.json`);
  const queues = new Map();
  const readLocal = async (table) => JSON.parse(await fs.readFile(file(table), 'utf8').catch(() => '[]'));
  const writeLocal = (table, mutate) => {
    const next = (queues.get(table) || Promise.resolve()).then(async () => {
      const rows = await readLocal(table);
      const result = mutate(rows);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(table), JSON.stringify(rows, null, 2));
      return result;
    });
    queues.set(table, next.catch(() => {}));
    return next;
  };
  const matches = (row, eq = {}) => Object.entries(eq).every(([k, v]) => String(row[k]) === String(v));

  return {
    async insert(table, row) {
      if (supabaseOn()) return (await rest('POST', table, row))[0];
      const full = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
      return writeLocal(table, (rows) => { rows.push(full); return full; });
    },
    async list(table, { eq } = {}) {
      if (supabaseOn()) return rest('GET', `${table}?select=*&order=created_at.desc${eq ? `&${eqQuery(eq)}` : ''}`);
      return (await readLocal(table)).filter((r) => matches(r, eq)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async update(table, id, patch) {
      if (supabaseOn()) return (await rest('PATCH', `${table}?id=eq.${encodeURIComponent(id)}`, patch))[0] || null;
      return writeLocal(table, (rows) => {
        const row = rows.find((r) => r.id === id);
        if (row) Object.assign(row, patch);
        return row || null;
      });
    },
    // Delete every row whose date column is before the given YYYY-MM-DD (the 90-day promise on /gizlilik).
    async purgeBefore(table, column, date) {
      if (supabaseOn()) return ((await rest('DELETE', `${table}?${encodeURIComponent(column)}=lt.${date}`)) || []).length;
      return writeLocal(table, (rows) => {
        const keep = rows.filter((r) => !(r[column] && r[column] < date));
        const removed = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return removed;
      });
    },
    async remove(table, id) {
      if (supabaseOn()) return (await rest('DELETE', `${table}?id=eq.${encodeURIComponent(id)}`)).length > 0;
      return writeLocal(table, (rows) => {
        const i = rows.findIndex((r) => r.id === id);
        if (i !== -1) rows.splice(i, 1);
        return i !== -1;
      });
    },
  };
}
