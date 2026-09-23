// Exhaustive mate search, for checking a submission's puzzles without trusting its answers.
import { Chess } from 'chess.js';

const checksFirst = moves => moves.sort((a, b) => (/[+#]/.test(b) - /[+#]/.test(a)));

// Moves for the side to move that force mate within n of its own moves.
export function forcing(c, n, firstOnly = false) {
  const out = [];
  for (const m of checksFirst(c.moves())) {
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

// Checks one puzzle against the task's rules. Returns { ok, problems, firstMoves }.
export function checkPuzzle(p, { mateIn, side = 'w', maxPieces = 32 }) {
  const problems = [];
  let c;
  try { c = new Chess(p.fen); } catch (e) { return { ok: false, problems: [`illegal FEN: ${e.message}`] }; }
  if (c.turn() !== side) problems.push(`side to move is ${c.turn()}, expected ${side}`);
  const pieces = c.board().flat().filter(Boolean).length;
  if (pieces > maxPieces) problems.push(`${pieces} pieces, limit ${maxPieces}`);
  if (mateIn > 1 && forcing(new Chess(p.fen), mateIn - 1, true).length) problems.push(`mates faster than in ${mateIn}`);
  const firstMoves = forcing(new Chess(p.fen), mateIn);
  if (firstMoves.length === 0) problems.push(`no forced mate in ${mateIn}`);
  if (firstMoves.length > 1) problems.push(`${firstMoves.length} first moves work (${firstMoves.join(', ')}); must be unique`);
  const line = p.solution || [];
  if (line.length !== 2 * mateIn - 1) problems.push(`solution has ${line.length} plies, expected ${2 * mateIn - 1}`);
  else {
    const s = new Chess(p.fen);
    try {
      for (const m of line) s.move(m);
      if (!s.isCheckmate()) problems.push('solution line does not end in checkmate');
      if (firstMoves.length === 1 && new Chess(p.fen).move(line[0]).san !== firstMoves[0]) problems.push(`solution starts ${line[0]}, but the only winning first move is ${firstMoves[0]}`);
    } catch (e) { problems.push(`solution line is illegal: ${e.message}`); }
  }
  return { ok: problems.length === 0, problems, firstMoves, pieces };
}
