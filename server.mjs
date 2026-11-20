import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { gzipSync } from 'node:zlib';

const root = new URL('./', import.meta.url);
const host = process.env.COIN_HOST || '0.0.0.0';
const port = Number(process.env.COIN_PORT || 4173);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/engine.js', ['engine.js', 'text/javascript; charset=utf-8']],
  ['/result-image.js', ['result-image.js', 'text/javascript; charset=utf-8']],
  ['/assets/icon.svg', ['assets/icon.svg', 'image/svg+xml']],
]);
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const entry = assets.get(pathname);
  if (!entry) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('页面不存在'); return; }
  try {
    let bytes = await readFile(new URL(entry[0], root));
    const headers = { 'Content-Type': entry[1], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', Vary: 'Accept-Encoding' };
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { bytes = gzipSync(bytes); headers['Content-Encoding'] = 'gzip'; }
    headers['Content-Length'] = bytes.length;
    res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(500); res.end('文件读取失败'); }
});
server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`硬币实验室已启动\n本机：http://localhost:${port}\n目录：${fileURLToPath(root)}`);
  if (host === '0.0.0.0') for (const values of Object.values(networkInterfaces())) for (const item of values || []) {
    if (item.family === 'IPv4' && !item.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) console.log(`同一局域网：http://${item.address}:${port}`);
  }
});
