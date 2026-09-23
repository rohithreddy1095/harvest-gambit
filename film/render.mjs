// Render the film offline, one deterministic frame at a time.
//   node film/render.mjs --stills 0,22,36,59            -> film/out/still-<t>.png
//   node film/render.mjs --video [--fps 30] [--from 0 --to 66] [--w 1920 --h 1080]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'film/out');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const W = +arg('w', 1920), H = +arg('h', 1080), FPS = +arg('fps', 30);
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: 'new', protocolTimeout: 900000,
  args: [`--use-angle=${arg('angle', 'gl')}`, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${W},${H}`, '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) console.error('[page]', m.text().slice(0, 400)); });
page.on('pageerror', e => console.error('[page error]', e.message));

const t0 = Date.now();
await page.goto(`http://localhost:${port}/film/index.html?record=1${arg('q', '')}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__ready === true', { timeout: 900000, polling: 500 });
console.log(`world built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (arg('stats')) {
  console.log(JSON.stringify(await page.evaluate(() => window.__stats), null, 1));
} else if (arg('stills')) {
  for (const t of String(arg('stills')).split(',').map(Number)) {
    const s = Date.now();
    await page.evaluate(t => window.__frame(t), t);
    const file = path.join(OUT, `still-${String(t).padStart(5, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(`t=${t}s -> ${path.relative(ROOT, file)} (${Date.now() - s} ms)`);
  }
} else if (arg('video')) {
  // Rendered in segments so an interrupted run resumes where it stopped: finished segments are kept.
  const from = +arg('from', 0), to = +arg('to', 66), segLen = +arg('seg', 6);
  const dir = path.join(OUT, arg('segdir', 'seg')); fs.mkdirSync(dir, { recursive: true });
  const start = Date.now(); let done = 0;
  const total = Math.round((to - from) * FPS);
  for (let s0 = from, si = 0; s0 < to - 1e-6; s0 += segLen, si++) {
    const s1 = Math.min(to, s0 + segLen), file = path.join(dir, `seg-${String(si).padStart(3, '0')}.mp4`);
    const n = Math.round((s1 - s0) * FPS);
    if (fs.existsSync(file)) { done += n; console.log(`segment ${si} already rendered`); continue; }
    const tmp = file.replace('.mp4', '.part.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let i = 0; i < n; i++) {
      await page.evaluate(t => window.__frame(t), s0 + i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      done++;
      if (done % 30 === 0) { const el = (Date.now() - start) / 1000; console.log(`frame ${done}/${total}  t=${(s0 + i / FPS).toFixed(2)}s  eta ${Math.round(el / done * (total - done) / 60)}m`); }
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    fs.renameSync(tmp, file);
    console.log(`segment ${si} done (${s0}-${s1}s)`);
  }
  const list = fs.readdirSync(dir).filter(f => /^seg-\d+\.mp4$/.test(f)).sort().map(f => `file '${path.join(dir, f)}'`).join('\n');
  fs.writeFileSync(path.join(dir, 'list.txt'), list + '\n');
  const out = path.join(OUT, arg('out', 'film-silent.mp4'));
  await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', out], { stdio: 'inherit' }).on('close', c => c ? rej(new Error('concat failed')) : res()));
  console.log(`wrote ${path.relative(ROOT, out)}`);
}
await browser.close(); server.close();
