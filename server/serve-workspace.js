import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 4000;
const ROOT = path.resolve(process.cwd(), 'workspace');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  res.end(fs.readFileSync(filePath));
}).listen(PORT, () => {
  console.log(`\n✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   CryptoTrack → http://localhost:${PORT}/cryptotrack/index.html`);
  console.log(`   ZenHR       → http://localhost:${PORT}/zenhr/index.html`);
  console.log(`   LaunchFast  → http://localhost:${PORT}/launchfast/index.html`);
  console.log(`\n   Ctrl+C para parar\n`);
});
