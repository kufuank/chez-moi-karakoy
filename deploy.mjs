// Publishes the site: builds dist/ for https://kufuank.github.io/chez-moi-karakoy/ and force-pushes it to the
// gh-pages branch, which GitHub Pages serves.   npm run deploy
// Only code and design changes need this; menu, events and bookings are live from Supabase.
// For a custom domain: BASE= npm run deploy   (and add the domain under repo → Settings → Pages)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REMOTE = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
const BASE = process.env.BASE ?? '/chez-moi-karakoy';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, BASE } });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chezmoi-pages-'));
fs.cpSync(path.join(ROOT, 'dist'), tmp, { recursive: true });
const source = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
run('git', ['init', '-q', '-b', 'gh-pages'], tmp);
run('git', ['add', '-A'], tmp);
run('git', ['-c', 'core.autocrlf=false', 'commit', '-q', '-m', `Yayın: main@${source}`], tmp);
run('git', ['push', '-q', '-f', REMOTE, 'gh-pages'], tmp);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Yayınlandı (main@${source}). GitHub Pages birkaç dakika içinde günceller.`);
