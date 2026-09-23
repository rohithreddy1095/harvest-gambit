import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { Chess } from 'chess.js';
const ROOT = path.resolve('.'), OUT = process.argv[2];
const srv = http.createServer((q, s) => { const f = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end(); return; } s.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(0);
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=1280,720`] });
const p = await b.newPage(); const [VW, VH] = (process.argv[3] || '1280x720').split('x').map(Number); await p.setViewport({ width: VW, height: VH, isMobile: VW < 600, hasTouch: VW < 600 });
p.on('console', m => { if (['error', 'warn'].includes(m.type()) && !/404|probe/.test(m.text())) console.log('[page]', m.text().slice(0, 300)); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(`http://localhost:${srv.address().port}/play/index.html`);
await p.waitForFunction('window.__play', { timeout: 600000 });
await p.mouse.click(VW / 2, 80);                                     // skip the intro
await new Promise(r => setTimeout(r, 3000));
await p.screenshot({ path: `${OUT}/play-0.png` });
const pz = JSON.parse(fs.readFileSync('puzzles/selected.json', 'utf8'))[0];
const c = new Chess(pz.fen);
const waitIdle = () => p.waitForFunction('!window.__play.state().busy', { timeout: 120000, polling: 250 });
// a wrong move first: any legal white move not in the tree
const wrong = c.moves({ verbose: true }).find(m => !pz.tree[m.san]);
await p.evaluate(sq => window.__play.onSquare(sq), wrong.from); await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: `${OUT}/play-1-selected.png` });
await p.evaluate(sq => window.__play.onSquare(sq), wrong.to); await new Promise(r => setTimeout(r, 1200));
console.log('wrong move', wrong.san, 'msg:', await p.$eval('#msg', e => e.textContent));
await waitIdle(); console.log('after wrong, state', JSON.stringify(await p.evaluate(() => window.__play.state())));
for (let i = 0; i < pz.line.length; i += 2) {
  const mv = c.move(pz.line[i]);
  await p.evaluate(sq => window.__play.onSquare(sq), mv.from); await new Promise(r => setTimeout(r, 400));
  await p.evaluate(sq => window.__play.onSquare(sq), mv.to);
  await new Promise(r => setTimeout(r, 800)); await waitIdle();
  if (pz.line[i + 1]) c.move(pz.line[i + 1]);
  console.log(`played ${mv.san}:`, await p.$eval('#msg', e => e.textContent));
}
await new Promise(r => setTimeout(r, 2500));
await p.screenshot({ path: `${OUT}/play-2-solved.png` });
console.log('share:', await p.$eval('#share', e => e.textContent), 'state', JSON.stringify(await p.evaluate(() => window.__play.state())));
await b.close(); srv.close();
