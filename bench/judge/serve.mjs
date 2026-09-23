#!/usr/bin/env node
// Blind side-by-side judging. Judges see two anonymous submissions to the same task and pick the better one.
//   node bench/judge/serve.mjs --task example-harvest [--runs bench/runs] [--port 8765]
// Votes are appended to bench/judge/votes.jsonl; rank them with bench/judge/rank.mjs.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const TASK = arg('task'), RUNS = path.resolve(arg('runs', path.join(HERE, '..', 'runs'))), VOTES = path.resolve(arg('votes', path.join(HERE, 'votes.jsonl')));
if (!TASK) { console.error('usage: serve.mjs --task <task-id> [--runs bench/runs]'); process.exit(2); }

// Every checked submission for this task: a folder holding results.json and the judging material.
function find(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || ['build', 'workspace', 'home', 'frames', 'node_modules'].includes(e.name)) continue;
    const d = path.join(dir, e.name), r = path.join(d, 'results.json');
    if (fs.existsSync(r) && fs.existsSync(path.join(d, 'contact.jpg'))) {
      const res = JSON.parse(fs.readFileSync(r, 'utf8'));
      if (res.task === TASK) {
        const runFile = path.join(d, '..', 'run.json'), run = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null;
        out.push({ id: run?.id || path.basename(d), dir: d, gates: res.summary });
      }
    }
    find(d, out);
  }
  return out;
}
const subs = find(RUNS);
if (subs.length < 2) { console.error(`Found ${subs.length} checked submission(s) for ${TASK} under ${RUNS}; judging needs at least 2.`); process.exit(1); }
const token = Object.fromEntries(subs.map(s => [crypto.randomBytes(6).toString('hex'), s]));
const votes = () => fs.existsSync(VOTES) ? fs.readFileSync(VOTES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const pending = new Map();
const FILES = ['film.mp4', 'contact.jpg', 'play-desktop.png', 'play-solved.png', 'play-phone.png'];

function nextPair(judge) {
  const seen = new Map();                                         // prefer pairs this judge has voted on least
  for (const v of votes().filter(v => v.task === TASK && v.judge === judge)) { const k = [v.a, v.b].sort().join('|'); seen.set(k, (seen.get(k) || 0) + 1); }
  const pairs = [];
  for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) pairs.push([subs[i], subs[j]]);
  const least = Math.min(...pairs.map(([a, b]) => seen.get([a.id, b.id].sort().join('|')) || 0));
  const pool = pairs.filter(([a, b]) => (seen.get([a.id, b.id].sort().join('|')) || 0) === least);
  let [a, b] = pool[crypto.randomInt(pool.length)];
  if (crypto.randomInt(2)) [a, b] = [b, a];
  const tok = s => Object.keys(token).find(k => token[k] === s);
  const side = s => ({ token: tok(s), files: FILES.filter(f => fs.existsSync(path.join(s.dir, f))) });
  const pairId = crypto.randomBytes(8).toString('hex'); pending.set(pairId, [a, b]);
  return { pairId, left: side(a), right: side(b), voted: votes().filter(v => v.task === TASK && v.judge === judge).length, total: pairs.length };
}

const TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(HERE, 'page.html'), 'utf8').replace('__TASK__', TASK)); }
  if (u.pathname === '/api/pair') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(nextPair(u.searchParams.get('judge') || 'anonymous'))); }
  const m = u.pathname.match(/^\/media\/([0-9a-f]+)\/([\w.-]+)$/);
  if (m && token[m[1]] && FILES.includes(m[2])) {
    const f = path.join(token[m[1]].dir, m[2]), size = fs.statSync(f).size, range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {                                                  // video seeking needs byte ranges
      const start = +range[1], end = range[2] ? +range[2] : size - 1;
      res.writeHead(206, { 'content-type': TYPES[path.extname(f)], 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      return fs.createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)], 'content-length': size, 'accept-ranges': 'bytes' }); return fs.createReadStream(f).pipe(res);
  }
  if (u.pathname === '/api/vote' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => {
      const v = JSON.parse(body), pair = pending.get(v.pairId);
      if (!pair || !['left', 'right', 'tie'].includes(v.winner)) { res.writeHead(400).end(); return; }
      pending.delete(v.pairId);
      const [a, b] = pair, pick = w => w === 'left' ? a.id : w === 'right' ? b.id : 'tie';
      const rec = { task: TASK, judge: String(v.judge || 'anonymous').slice(0, 60), a: a.id, b: b.id, winner: pick(v.winner),
        criteria: Object.fromEntries(Object.entries(v.criteria || {}).map(([k, w]) => [k, pick(w)])), at: new Date().toISOString() };
      fs.appendFileSync(VOTES, JSON.stringify(rec) + '\n');
      res.writeHead(204).end();
    });
  }
  res.writeHead(404).end();
}).listen(+arg('port', 8765), () => console.log(`Judging ${subs.length} submissions for ${TASK}: http://localhost:${server.address().port}/`));
