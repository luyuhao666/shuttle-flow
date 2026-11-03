import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
const port = Number(process.env.PORT || 3000);
const lan = process.argv.includes('--lan');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/game.js': ['game.js', 'text/javascript; charset=utf-8'], '/core.js': ['core.js', 'text/javascript; charset=utf-8'] };
files['/sounds.js'] = ['sounds.js', 'text/javascript; charset=utf-8'];
files['/appearance.js'] = ['appearance.js', 'text/javascript; charset=utf-8'];
files['/guidance.js'] = ['guidance.js', 'text/javascript; charset=utf-8'];
files['/touch-input.js'] = ['touch-input.js', 'text/javascript; charset=utf-8'];
files['/tutorial.js'] = ['tutorial.js', 'text/javascript; charset=utf-8'];
files['/i18n.js'] = ['i18n.js', 'text/javascript; charset=utf-8'];
files['/lan-core.js'] = ['lan-core.js', 'text/javascript; charset=utf-8'];
files['/lan-client.js'] = ['lan-client.js', 'text/javascript; charset=utf-8'];
files['/target-challenge.js'] = ['target-challenge.js', 'text/javascript; charset=utf-8'];
files['/assets/characters/anime-athlete-v1/game-renderer.js'] = ['assets/characters/anime-athlete-v1/game-renderer.js', 'text/javascript; charset=utf-8'];
files['/assets/characters/pixel-athlete-v2/game-renderer.js'] = ['assets/characters/pixel-athlete-v2/game-renderer.js', 'text/javascript; charset=utf-8'];
files['/assets/images/cover-jump-smash-v2.png'] = ['assets/images/cover-jump-smash-v2.png', 'image/png'];
files['/assets/images/venue-daylight.svg'] = ['assets/images/venue-daylight.svg', 'image/svg+xml'];
files['/assets/images/cover-daylight-smash.png'] = ['assets/images/cover-daylight-smash.png', 'image/png'];
http.createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { const body = await readFile(new URL(file[0], import.meta.url)); res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(500); res.end('Unable to read game file'); }
}).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Shuttle Flow: http://localhost:${port}`);
  if (lan) for (const address of new Set(Object.values(networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')).map(n => n.address))) console.log(`Phone on the same Wi-Fi: http://${address}:${port}`);
});
