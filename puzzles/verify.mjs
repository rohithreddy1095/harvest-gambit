// Verify candidate puzzles exhaustively and build the answer tree the 3D page plays against.
//   node puzzles/verify.mjs [max]   (reads puzzles/mate3-easy.csv, writes puzzles/verified.json)
// A puzzle passes only if, after Lichess's setup move:
//   - Livestock (white) mates in 3 against every defence, and cannot mate faster;
//   - exactly one first move does it (no second solution);
//   - it has no castling, en passant or promotion (the field animates single pieces), and <= 14 pieces.
import { Chess } from 'chess.js';
import fs from 'node:fs';

const DIR = new URL('.', import.meta.url);
const max = +(process.argv[2] || 400);
const rows = fs.readFileSync(new URL('mate3-easy.csv', DIR), 'utf8').trim().split('\n').slice(1).map(l => l.split(','));

const mates1 = c => c.moves().filter(m => m.endsWith('#'));
// Can the side to move force mate within n of its own moves? Returns the list of moves that do.
function forcing(c, n, firstOnly = false) {
  const out = [];
  const moves = c.moves().sort((a, b) => (/[+#]/.test(b) - /[+#]/.test(a)));
  for (const m of moves) {
    if (m.endsWith('#')) { out.push(m); if (firstOnly) return out; continue; }
    if (n === 1) continue;
    c.move(m);
    const ok = !c.isGameOver() && everyReplyLoses(c, n - 1);
    c.undo();
    if (ok) { out.push(m); if (firstOnly) return out; }
  }
  return out;
}
function everyReplyLoses(c, n) {
  for (const r of c.moves()) { c.move(r); const ok = forcing(c, n, true).length > 0; c.undo(); if (!ok) return false; }
  return true;
}
// Best defence: a reply that avoids mate in fewer moves than remain, if one exists.
function bestDefence(c, n) {
  let best = null;
  for (const r of c.moves()) {
    c.move(r);
    const fast = n > 1 && forcing(c, n - 1, true).length > 0;
    c.undo();
    if (!fast) return r;
    best ??= r;
  }
  return best;
}
// Tree: for each accepted white move -> Crops reply -> next accepted white moves ... -> mates.
function tree(c, n, mainline) {
  const node = {};
  for (const w of forcing(c, n)) {
    c.move(w);
    if (c.isCheckmate()) { node[w] = { mate: true }; c.undo(); continue; }
    const reply = (mainline && mainline[0] === w && mainline[1]) ? mainline[1] : bestDefence(c, n - 1);
    c.move(reply);
    node[w] = { reply, next: tree(c, n - 1, mainline && mainline[0] === w ? mainline.slice(2) : null) };
    c.undo(); c.undo();
  }
  return node;
}

const out = [];
const t0 = Date.now();
for (const [id, fen, movesStr, rating, , popularity, plays, themes] of rows.slice(0, max)) {
  const uci = movesStr.split(' ');
  const c = new Chess(fen);
  const toSan = u => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })?.san;
  const setup = toSan(uci[0]);
  const start = c.fen();
  const pieces = c.board().flat().filter(Boolean).length;
  const line = []; for (const u of uci.slice(1)) line.push(toSan(u));
  const flags = [];
  const probe = new Chess(start);
  for (const s of line) { const mv = probe.move(s); if (/[kqpe]/.test(mv.flags.replace('n', '').replace('b', '').replace('c', ''))) flags.push(mv.flags); }
  if (pieces > 14 || flags.length || start.split(' ')[1] !== 'w') continue;
  const pos = new Chess(start);
  if (forcing(pos, 2, true).length) continue;          // mates faster than advertised
  const firsts = forcing(pos, 3);
  if (firsts.length !== 1 || firsts[0] !== line[0]) continue;
  out.push({ id, rating: +rating, popularity: +popularity, plays: +plays, themes: themes.split(' '), pieces,
             setupFen: fen, setup, fen: start, line, tree: tree(new Chess(start), 3, line), url: `https://lichess.org/training/${id}` });
  fs.writeFileSync(new URL('verified.json', DIR), JSON.stringify(out, null, 1));
  process.stdout.write(`\r${out.length} verified / ${rows.indexOf(rows.find(r => r[0] === id)) + 1} checked`);
}
console.log(`\n${out.length} puzzles verified in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
fs.writeFileSync(new URL('verified.json', DIR), JSON.stringify(out, null, 1));
