// Local preview of dist/, the way GitHub Pages serves it: /path/ -> /path/index.html, unknown -> 404.html.
//   npm run dev   (builds, then serves on http://localhost:3000)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

http.createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) { res.writeHead(301, { Location: `${req.url.replace(/\/?$/, '/')}` }).end(); return; }
  } catch {
    file = path.join(DIST, '404.html');
    res.statusCode = 404;
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.end(await fs.readFile(file));
}).listen(PORT, () => console.log(`dist/ önizleme: http://localhost:${PORT}`));
