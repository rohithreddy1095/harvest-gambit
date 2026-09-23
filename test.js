import { Chess } from 'chess.js';
import { parseMove } from './lib/game.js';
const cases = [
  ['', 'knight to f3!!', 'Nf3'], ['', 'nf3', 'Nf3'], ['', 'e4', 'e4'], ['', 'e2e4', 'e4'], ['', 'push the h pawn', null],
  ['', 'pawn to e4 obviously', 'e4'], ['', 'horse f3', 'Nf3'], ['', 'sac the horse lol', null],
  ['r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'castle short', 'O-O'],
  ['r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', '0-0', 'O-O'],
  ['r1bqkb1r/p4ppp/2p2n2/n3p1N1/8/8/PPPPBPPP/RNBQK2R b KQkq - 0 8', 'h6 kick the horse', 'h6'],
  ['rnbqkbnr/pp1ppppp/8/2P5/8/8/PP1PPPPP/RNBQKBNR b KQkq - 0 2', 'x', null],
];
let fail = 0;
for (const [fen, text, want] of cases) {
  const got = parseMove(fen ? new Chess(fen) : new Chess(), text);
  const ok = got.san === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(text).padEnd(22)} -> ${got.san ?? '—'} ${got.reason ? `(${got.reason})` : ''}`);
}
// bxc6 in the sample line
const c = new Chess(); for (const m of 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6'.split(' ')) c.move(m);
const g = parseMove(c, 'bxc6'); console.log(g.san === 'bxc6' ? 'ok   "bxc6" pawn capture' : `FAIL bxc6 -> ${g.san}`); if (g.san !== 'bxc6') fail++;
process.exit(fail ? 1 : 0);
