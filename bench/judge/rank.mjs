#!/usr/bin/env node
// Turn blind pairwise votes into a ranking (Bradley-Terry, ties count half to each side).
//   node bench/judge/rank.mjs [--task example-harvest] [--criterion overall|realism|film|play]
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const crit = arg('criterion', 'overall'), task = arg('task');
const votes = fs.readFileSync(arg('votes', path.join(HERE, 'votes.jsonl')), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(v => !task || v.task === task)
  .map(v => ({ a: v.a, b: v.b, w: crit === 'overall' ? v.winner : v.criteria?.[crit] }))
  .filter(v => v.w);
if (!votes.length) { console.log(`No votes for ${crit}${task ? ` on ${task}` : ''}.`); process.exit(0); }

const ids = [...new Set(votes.flatMap(v => [v.a, v.b]))];
const wins = Object.fromEntries(ids.map(i => [i, 0])), games = Object.fromEntries(ids.map(i => [i, 0]));
const n = {};                                                    // comparisons per pair
for (const { a, b, w } of votes) {
  games[a]++; games[b]++;
  if (w === 'tie') { wins[a] += 0.5; wins[b] += 0.5; } else wins[w] += 1;
  const k = [a, b].sort().join('|'); n[k] = (n[k] || 0) + 1;
}
// Minorisation-maximisation for Bradley-Terry strengths, lightly regularised so a clean sweep stays finite.
let p = Object.fromEntries(ids.map(i => [i, 1]));
for (let it = 0; it < 500; it++) {
  const next = {};
  for (const i of ids) {
    let den = 0;
    for (const j of ids) { if (i === j) continue; const k = [i, j].sort().join('|'); if (n[k]) den += n[k] / (p[i] + p[j]); }
    next[i] = (wins[i] + 0.5) / (den + 1 / (p[i] + 1));
  }
  const g = Math.exp(ids.reduce((a, i) => a + Math.log(next[i]), 0) / ids.length);
  for (const i of ids) p[i] = next[i] / g;
}
const rows = ids.map(i => ({ id: i, rating: Math.round(1000 + 400 * Math.log10(p[i])), wins: wins[i], games: games[i] })).sort((x, y) => y.rating - x.rating);
console.log(`${crit} · ${votes.length} votes${task ? ` · ${task}` : ''}\n`);
for (const r of rows) console.log(`${String(r.rating).padStart(5)}  ${String(r.wins).padStart(5)}/${String(r.games).padEnd(4)} ${r.id}`);
