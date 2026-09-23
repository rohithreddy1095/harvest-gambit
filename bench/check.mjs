#!/usr/bin/env node
// Check one submission against a task: automated gates, measurements, and material for the judges.
//   node bench/check.mjs --submission <dir> --task bench/tasks/<id> --out <dir>
//        [--trusted]            build on this machine instead of inside the benchmark container
//        [--image harvest-bench] [--video] [--reference <dir>]... [--angle gl]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { Chess } from 'chess.js';
import { checkPuzzle, forcing } from './lib/mate.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const argList = k => argv.flatMap((a, i) => a === `--${k}` ? [argv[i + 1]] : []);
if (!arg('submission') || !arg('task') || !arg('out')) { console.error('usage: check.mjs --submission <dir> --task <taskdir> --out <dir> [--trusted] [--video] [--reference <dir>]'); process.exit(2); }
const SUB = path.resolve(arg('submission')), TASKDIR = path.resolve(arg('task')), OUT = path.resolve(arg('out'));
const BUILD = path.join(OUT, 'build'), FRAMES = path.join(OUT, 'frames');
const task = JSON.parse(fs.readFileSync(path.join(TASKDIR, 'task.json'), 'utf8'));
const TRUSTED = !!arg('trusted'), IMAGE = arg('image', 'harvest-bench'), CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true });

const R = { task: task.id, submission: SUB, started: new Date().toISOString(), trusted: TRUSTED, gates: {}, metrics: {}, puzzles: [], network: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 2));
function gate(name, pass, detail = {}) { R.gates[name] = { pass, ...detail }; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail.why ? `  (${detail.why})` : ''}`); save(); }
const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });

// ---------------------------------------------------------------- the submission as committed
const isGit = fs.existsSync(path.join(SUB, '.git'));
fs.mkdirSync(BUILD, { recursive: true });
if (isGit) {
  const tar = run('bash', ['-c', `git -C "${SUB}" archive HEAD | tar -x -C "${BUILD}"`]);
  if (tar.status !== 0) { gate('manifest', false, { why: 'no commit to check: ' + tar.stderr.trim().slice(0, 200) }); process.exit(1); }
  R.commit = run('git', ['-C', SUB, 'rev-parse', 'HEAD']).stdout.trim();
} else run('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.git', `${SUB}/`, `${BUILD}/`]);
const tracked = isGit ? run('git', ['-C', SUB, 'ls-files']).stdout.split('\n').filter(Boolean)
  : run('bash', ['-c', `cd "${BUILD}" && find . -type f -not -path "./node_modules/*" | sed 's|^./||'`]).stdout.split('\n').filter(Boolean);

let M;
try { M = JSON.parse(fs.readFileSync(path.join(BUILD, 'bench.json'), 'utf8')); } catch (e) { gate('manifest', false, { why: `bench.json: ${e.message}` }); process.exit(1); }
const missing = ['build', 'film', 'play', 'puzzles', 'sound', 'soundFile'].filter(k => typeof M[k] !== 'string');
gate('manifest', !missing.length, missing.length ? { why: `missing ${missing.join(', ')}` } : {});
if (missing.length) process.exit(1);

// ---------------------------------------------------------------- build and sound, inside the container unless trusted
function sh(label, cmd, minutes) {
  const full = `mkdir -p "$HOME" && ${fs.existsSync(path.join(BUILD, 'package.json')) && label === 'build' ? 'npm install --no-audit --no-fund && ' : ''}${cmd}`;
  const [c, a] = TRUSTED ? ['bash', ['-lc', full]]
    : ['docker', ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp/home', '-v', `${BUILD}:/work`, '-w', '/work', IMAGE, 'bash', '-lc', full]];
  const t0 = Date.now(), r = run(c, a, { cwd: BUILD, timeout: minutes * 60000 });
  fs.writeFileSync(path.join(OUT, `${label}.log`), `$ ${full}\n${r.stdout || ''}${r.stderr || ''}`);
  return { ok: r.status === 0, seconds: Math.round((Date.now() - t0) / 1000), why: r.error?.code === 'ETIMEDOUT' ? `timed out after ${minutes} min` : r.status ? `exit ${r.status}, see ${label}.log` : undefined };
}
const b = sh('build', M.build, 20);
gate('build', b.ok, b); if (!b.ok) { save(); process.exit(1); }
const sd = sh('sound', M.sound, 20);
const soundPath = path.join(BUILD, M.soundFile);

// ---------------------------------------------------------------- no downloaded media in the repo
const MEDIA = /\.(png|jpe?g|gif|webp|avif|bmp|tga|tiff?|svg|hdr|exr|ktx2?|basis|dds|glb|gltf|obj|fbx|dae|stl|ply|usdz?|3ds|blend|wav|mp3|ogg|flac|m4a|aac|opus|mp4|webm|mov|mkv|avi)$/i;
const mediaFiles = tracked.filter(f => MEDIA.test(f) && !f.startsWith('docs/'));
const embedded = [];
for (const f of tracked.filter(f => /\.(m?js|ts|html|css|json)$/i.test(f))) {
  const text = fs.readFileSync(path.join(BUILD, f), 'utf8');
  const m = text.match(/data:(image|audio|video|model|font)\/[\w.+-]+;base64,[A-Za-z0-9+/=]{2000,}/);
  if (m) embedded.push(`${f}: ${m[1]} data URI`);
}
gate('noMediaFiles', !mediaFiles.length && !embedded.length, mediaFiles.length || embedded.length ? { why: [...mediaFiles, ...embedded].slice(0, 8).join('; ') } : {});

// ---------------------------------------------------------------- puzzles, re-verified
let puzzles = [];
try { puzzles = JSON.parse(fs.readFileSync(path.join(BUILD, M.puzzles), 'utf8')); } catch (e) { gate('puzzles', false, { why: `${M.puzzles}: ${e.message}` }); }
if (Array.isArray(puzzles)) {
  const rules = { mateIn: task.puzzles.mateIn, side: task.puzzles.side, maxPieces: task.puzzles.maxPieces };
  R.puzzles = puzzles.map((p, i) => ({ i, fen: p.fen, solution: p.solution, ...checkPuzzle(p, rules) }));
  const bad = R.puzzles.filter(p => !p.ok);
  const enough = puzzles.length >= task.puzzles.count;
  gate('puzzles', enough && !bad.length, { why: !enough ? `${puzzles.length} puzzles, need ${task.puzzles.count}` : bad.map(p => `#${p.i + 1}: ${p.problems.join(', ')}`).join('; ') || undefined });
}

// ---------------------------------------------------------------- serve the build, watch every request
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const f = path.join(BUILD, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!file.startsWith(BUILD) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const CDN = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|esm\.sh)$/, FONTS = /^fonts\.(googleapis|gstatic)\.com$/;
function audit(req, where) {
  const u = new URL(req.url()), type = req.resourceType();
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.pathname === '/favicon.ico') return;
  const media = MEDIA.test(u.pathname) || ['image', 'media'].includes(type);
  const local = u.hostname === 'localhost';
  const ok = !media && (local || CDN.test(u.hostname) || FONTS.test(u.hostname));
  if (!ok) R.network.push({ where, url: req.url().slice(0, 200), type });
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 1800000,
  args: [`--use-angle=${arg('angle', 'gl')}`, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
async function open(rel, viewport, where, ready, timeoutMin = 10) {
  const page = await browser.newPage(); await page.setViewport(viewport);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 300))); page.on('request', r => audit(r, where));
  const t0 = Date.now();
  try { await page.goto(base + rel, { waitUntil: 'load', timeout: 180000 }); await page.waitForFunction(ready, { timeout: timeoutMin * 60000, polling: 500 }); }
  catch (e) { return { page, errors: [...errors, e.message.slice(0, 200)], failed: true }; }
  return { page, errors, seconds: Math.round((Date.now() - t0) / 1000) };
}
const imgStats = f => { const o = run('magick', [f, '-colorspace', 'Gray', '-format', '%[fx:standard_deviation]', 'info:']).stdout; return +o; };
const imgDiff = (a, c) => { const o = run('magick', ['compare', '-metric', 'RMSE', a, c, 'null:']); const m = (o.stderr || '').match(/\(([\d.e-]+)\)/); return m ? +m[1] : 1; };

// ---------------------------------------------------------------- play page: phone, then desktop with a full play-through
const PLAY_READY = 'window.__play && typeof window.__play.move === "function" && typeof window.__play.state === "function"';
{
  const ph = await open(M.play, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 'play-phone', PLAY_READY);
  if (!ph.failed) { await sleep(8); await ph.page.screenshot({ path: path.join(OUT, 'play-phone.png') }); }
  const phoneOk = !ph.failed && !ph.errors.length && imgStats(path.join(OUT, 'play-phone.png')) > 0.02;
  gate('playPhone', phoneOk, { why: ph.errors.join(' | ') || (phoneOk ? undefined : 'blank screen'), seconds: ph.seconds });
  await ph.page.close();
}
const desk = await open(M.play, { width: 1280, height: 720 }, 'play-desktop', PLAY_READY);
if (!desk.failed) { await sleep(8); await desk.page.screenshot({ path: path.join(OUT, 'play-desktop.png') }); }
gate('playDesktop', !desk.failed && !desk.errors.length && imgStats(path.join(OUT, 'play-desktop.png')) > 0.02, { why: desk.errors.join(' | ') || undefined, seconds: desk.seconds });
R.metrics.playReadySeconds = desk.seconds;
if (!desk.failed) {
  const P = desk.page, state = () => P.evaluate(() => window.__play.state()), norm = f => (f || '').split(' ').slice(0, 4).join(' ');
  const mv = (f, t) => P.evaluate((f, t) => window.__play.move(f, t), f, t);
  const results = [];
  for (const [i, pz] of puzzles.entries()) {
    const r = { i, loaded: false, wrongRejected: false, illegalRejected: false, solved: false, moves: [] };
    try {
      await P.evaluate(i => window.__play.load(i), i); await sleep(1);
      const s0 = await state(); r.loaded = norm(s0.fen) === norm(pz.fen);
      const c = new Chess(pz.fen), good = new Set(forcing(new Chess(pz.fen), task.puzzles.mateIn));
      const wrong = c.moves({ verbose: true }).find(m => !good.has(m.san));
      if (wrong) { const w = await mv(wrong.from, wrong.to); const s1 = await state(); r.wrongRejected = w.legal === true && w.accepted === false && !s1.solved && norm(s1.fen) === norm(pz.fen); }
      const own = c.moves({ verbose: true })[0], legalTo = new Set(c.moves({ square: own.from, verbose: true }).map(m => m.to));
      const bad = 'abcdefgh'.split('').flatMap(f => '12345678'.split('').map(n => f + n)).find(s => s !== own.from && !legalTo.has(s));
      const il = await mv(own.from, bad); r.illegalRejected = il.legal === false && norm((await state()).fen) === norm(pz.fen);
      let pos = new Chess(pz.fen);
      for (let left = task.puzzles.mateIn; left > 0; left--) {
        const want = forcing(pos, left), sol = pz.solution?.[2 * (task.puzzles.mateIn - left)];
        const san = want.includes(sol) ? sol : want[0];
        if (!san) break;
        const m = pos.move(san), res = await mv(m.from, m.to);
        r.moves.push({ san, ...res });
        if (!res.accepted) break;
        if (res.solved) { r.solved = pos.isCheckmate(); break; }
        pos = new Chess((await state()).fen);
      }
      if (i === 0) { await sleep(3); await P.screenshot({ path: path.join(OUT, 'play-solved.png') }); }
    } catch (e) { r.error = e.message.slice(0, 200); }
    results.push(r);
  }
  R.playThrough = results;
  const bad = results.filter(r => !(r.loaded && r.wrongRejected && r.illegalRejected && r.solved));
  gate('playThrough', results.length > 0 && !bad.length, { why: bad.map(r => `#${r.i + 1}: ${['loaded', 'wrongRejected', 'illegalRejected', 'solved'].filter(k => !r[k]).join(', ') || r.error}`).join('; ') || undefined });
  await P.close();
}

// ---------------------------------------------------------------- film: duration, stills every 2 s, repeatability
const film = await open(`${M.film}?record`, { width: 1280, height: 720 }, 'film', 'window.__ready === true && typeof window.__frame === "function"', 20);
let duration = 0;
if (!film.failed) {
  const F = film.page;
  duration = await F.evaluate(() => window.__duration);
  R.metrics.filmDuration = duration; R.metrics.filmReadySeconds = film.seconds;
  R.metrics.stats = await F.evaluate(() => window.__stats || null);
  const { minSeconds, maxSeconds } = task.film;
  const frame = async (t, file) => { const t0 = Date.now(); await F.evaluate(t => window.__frame(t), t); await F.screenshot({ path: file, type: 'jpeg', quality: 90 }); return Date.now() - t0; };
  const times = [], stills = [];
  for (let t = 0; t < duration; t += 2) { const f = path.join(FRAMES, `t${String(t).padStart(3, '0')}.jpg`); times.push(await frame(t, f)); stills.push(f); }
  R.metrics.msPerFrame720p = Math.round(times.slice(1).reduce((a, x) => a + x, 0) / Math.max(1, times.length - 1));
  const mid = stills[Math.floor(stills.length / 2)], again = path.join(OUT, 'repeat.jpg');
  await frame(Math.floor(stills.length / 2) * 2, again);
  const repeatDiff = imgDiff(mid, again), blank = stills.filter(f => imgStats(f) < 0.02).length;
  const still = stills.slice(1).filter((f, k) => imgDiff(stills[k], f) < 0.003).length;
  R.metrics.repeatDiff = repeatDiff;
  run('magick', ['montage', ...stills, '-tile', '6x', '-geometry', '320x180+2+2', '-background', 'black', path.join(OUT, 'contact.jpg')]);
  const okDur = typeof duration === 'number' && duration >= minSeconds && duration <= maxSeconds;
  gate('film', !film.errors.length && okDur && repeatDiff < 0.02 && blank === 0 && still < stills.length / 3, {
    why: [film.errors.join(' | '), !okDur && `duration ${duration}s, want ${minSeconds}-${maxSeconds}`, repeatDiff >= 0.02 && `frame at the same t differs (${repeatDiff.toFixed(3)})`, blank && `${blank} blank frames`, still >= stills.length / 3 && `${still} of ${stills.length} stills identical to the one before`].filter(Boolean).join('; ') || undefined });
  if (arg('video')) {                                   // full 1080p30 film with its soundtrack, for the judges
    const hd = await open(`${M.film}?record`, { width: 1920, height: 1080 }, 'film', 'window.__ready === true', 20), F = hd.page;
    const silent = path.join(OUT, 'film-silent.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', silent]);
    for (let i = 0; i < Math.round(duration * 30); i++) { await F.evaluate(t => window.__frame(t), i / 30); const buf = await F.screenshot({ type: 'jpeg', quality: 95 }); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    const withSound = fs.existsSync(soundPath) ? ['-i', soundPath, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : [];
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, ...withSound, '-c:v', 'copy', '-movflags', '+faststart', path.join(OUT, 'film.mp4')]);
    fs.rmSync(silent, { force: true });
  }
} else gate('film', false, { why: film.errors.join(' | ') });

// ---------------------------------------------------------------- soundtrack
if (sd.ok && fs.existsSync(soundPath)) {
  const dur = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', soundPath]).stdout;
  const vol = run('ffmpeg', ['-hide_banner', '-i', soundPath, '-af', 'volumedetect', '-f', 'null', '-']).stderr;
  const mean = +(vol.match(/mean_volume: (-?[\d.]+)/) || [])[1], peak = +(vol.match(/max_volume: (-?[\d.]+)/) || [])[1];
  R.metrics.sound = { seconds: dur, meanDb: mean, peakDb: peak };
  const okLen = !duration || Math.abs(dur - duration) <= 2;
  gate('sound', okLen && mean > -50 && peak <= 0, { why: [!okLen && `${dur.toFixed(1)}s long, film is ${duration}s`, !(mean > -50) && `too quiet (${mean} dB mean)`].filter(Boolean).join('; ') || undefined });
} else gate('sound', false, { why: sd.why || `${M.soundFile} not written` });

gate('network', R.network.length === 0, R.network.length ? { why: R.network.slice(0, 4).map(n => `${n.type} ${n.url}`).join('; ') } : {});

// ---------------------------------------------------------------- code size, and code shared with known projects
const CODE = /\.(m?js|ts|tsx|jsx|html|css|glsl|frag|vert|sh|py)$/i;
const codeFiles = tracked.filter(f => CODE.test(f) && !/(^|\/)(node_modules|vendor|dist)\//.test(f));
const lines = codeFiles.reduce((a, f) => a + fs.readFileSync(path.join(BUILD, f), 'utf8').split('\n').length, 0);
R.metrics.code = { files: codeFiles.length, lines };
const refs = argList('reference');
if (refs.length) {
  const shingles = (root, files) => {
    const set = new Set();
    for (const f of files) {
      const ls = fs.readFileSync(path.join(root, f), 'utf8').split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(l => l.length > 12 && l.length < 400 && !/^(\/\/|\*|\/\*)/.test(l));
      for (let k = 0; k + 5 <= ls.length; k++) set.add(ls.slice(k, k + 5).join('\n'));
    }
    return set;
  };
  const mine = shingles(BUILD, codeFiles);
  const known = new Set();
  for (const ref of refs) {
    const files = run('git', ['-C', ref, 'ls-files']).stdout.split('\n').filter(f => CODE.test(f));
    for (const s of shingles(ref, files)) known.add(s);
  }
  const shared = [...mine].filter(s => known.has(s)).length / Math.max(1, mine.size);
  R.metrics.sharedWithReference = +shared.toFixed(3);
  gate('original', shared < 0.15, shared >= 0.15 ? { why: `${Math.round(shared * 100)}% of 5-line runs match a known project` } : {});
}

await browser.close(); server.close();
R.finished = new Date().toISOString();
const g = Object.values(R.gates);
R.summary = { passed: g.filter(x => x.pass).length, total: g.length };
save();
console.log(`\n${R.summary.passed}/${R.summary.total} gates passed. Results in ${path.relative(process.cwd(), OUT)}/results.json`);
