// JSON documents (menu, events) and uploaded files kept on disk and, when GITHUB_TOKEN is set, mirrored to a
// branch of the repo that the host does not deploy from. On start the server loads each document from that
// branch, so a redeploy or a sleeping host never loses an edit, and a save never triggers a redeploy.
import fs from 'node:fs/promises';
import path from 'node:path';

// Read lazily: the server loads .env after the modules are imported.
const config = {
  get token() { return process.env.GITHUB_TOKEN; },
  get repo() { return process.env.GITHUB_REPO; },
  get branch() { return process.env.GITHUB_MENU_BRANCH || 'menu-data'; },
};
export const githubOn = () => Boolean(config.token && config.repo);

async function github(method, url, body) {
  const res = await fetch(`https://api.github.com/repos/${config.repo}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let branchReady = null;
function ensureBranch() {
  branchReady ??= (async () => {
    const branch = await github('GET', `/branches/${encodeURIComponent(config.branch)}`);
    if (branch.status === 200) return;
    if (branch.status !== 404) throw new Error(`GitHub: ${config.branch} dalına ulaşılamadı (${branch.status})`);
    const main = await github('GET', '/git/ref/heads/main');
    if (main.status !== 200) throw new Error(`GitHub: main dalı okunamadı (${main.status})`);
    const created = await github('POST', '/git/refs', { ref: `refs/heads/${config.branch}`, sha: main.data.object.sha });
    if (created.status !== 201) throw new Error(`GitHub: ${config.branch} dalı açılamadı (${created.status})`);
    console.log(`GitHub: ${config.branch} dalı oluşturuldu.`);
  })().catch((err) => { branchReady = null; throw err; });
  return branchReady;
}

const shas = new Map(); // repo path -> blob sha on the branch

async function getFile(repoPath) {
  const res = await github('GET', `/contents/${repoPath}?ref=${encodeURIComponent(config.branch)}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`GitHub: ${repoPath} okunamadı (${res.status})`);
  shas.set(repoPath, res.data.sha);
  if (res.data.content) return Buffer.from(res.data.content, 'base64');
  // files over 1 MB come without inline content
  const blob = await github('GET', `/git/blobs/${res.data.sha}`);
  return Buffer.from(blob.data.content, 'base64');
}

async function putFile(repoPath, buffer, message) {
  await ensureBranch();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await github('PUT', `/contents/${repoPath}`, {
      message,
      content: buffer.toString('base64'),
      branch: config.branch,
      ...(shas.get(repoPath) ? { sha: shas.get(repoPath) } : {}),
    });
    if (res.status === 200 || res.status === 201) {
      shas.set(repoPath, res.data.content.sha);
      return;
    }
    if (res.status === 409 || res.status === 422) {
      await getFile(repoPath); // refresh the sha, then try once more
      continue;
    }
    throw new Error(`GitHub kaydı başarısız (${res.status}): ${res.data?.message || ''}`);
  }
  throw new Error('GitHub kaydı başarısız: dosya o sırada başka yerde değişti.');
}

export class PersistError extends Error {
  constructor() {
    super('Değişiklik kalıcı olarak kaydedilemedi (GitHub). Birkaç saniye sonra tekrar dene.');
    this.status = 503;
  }
}

// One JSON document: a local file plus its mirror at the same relative path on the branch.
export function jsonDoc(root, relPath, fallback) {
  const file = path.join(root, relPath);
  const repoPath = relPath.replace(/\\/g, '/');
  let loaded = !githubOn();
  let queue = Promise.resolve();

  return {
    async load() {
      if (!githubOn()) return;
      for (let attempt = 1; attempt <= 3 && !loaded; attempt++) {
        try {
          await ensureBranch();
          const buf = await getFile(repoPath);
          if (buf) {
            JSON.parse(buf.toString('utf8')); // refuse a broken file
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, buf);
          }
          loaded = true;
          console.log(`GitHub: ${repoPath} ${buf ? 'yüklendi' : 'henüz yok, paketteki kullanılacak'}.`);
        } catch (err) {
          console.error(`${err.message} (deneme ${attempt}/3)`);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      if (!loaded) console.error(`GitHub: ${repoPath} yüklenemedi; bu belge için kayıt kapalı.`);
    },
    async read() {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback);
        throw err;
      }
    },
    // Serialised; with GitHub on, a save only counts once the commit lands, else the file is put back.
    save(value, message) {
      const next = queue.then(async () => {
        const previous = await fs.readFile(file, 'utf8').catch(() => null);
        const text = JSON.stringify(value, null, 2) + '\n';
        await fs.mkdir(path.dirname(file), { recursive: true });
        if (previous) await fs.writeFile(file.replace(/\.json$/, '.backup.json'), previous);
        await fs.writeFile(`${file}.tmp`, text);
        await fs.rename(`${file}.tmp`, file);
        if (!githubOn()) return;
        try {
          if (!loaded) throw new Error(`GitHub: ${repoPath} başlangıçta yüklenemediği için kayıt kapalı`);
          await putFile(repoPath, Buffer.from(text), message);
        } catch (err) {
          if (previous) await fs.writeFile(file, previous);
          console.error(err);
          throw new PersistError();
        }
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}

// Uploaded files (event posters): saved locally and mirrored; a missing local copy is fetched back on demand.
export function fileStore(root, relDir) {
  const dir = path.join(root, relDir);
  const repoDir = relDir.replace(/\\/g, '/');
  return {
    async put(name, buffer, message) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, name), buffer);
      if (!githubOn()) return;
      try {
        await putFile(`${repoDir}/${name}`, buffer, message);
      } catch (err) {
        await fs.rm(path.join(dir, name), { force: true });
        console.error(err);
        throw new PersistError();
      }
    },
    async get(name) {
      try {
        return await fs.readFile(path.join(dir, name));
      } catch (err) {
        if (err.code !== 'ENOENT' || !githubOn()) return null;
        const buf = await getFile(`${repoDir}/${name}`).catch(() => null);
        if (buf) {
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, name), buf);
        }
        return buf;
      }
    },
  };
}
