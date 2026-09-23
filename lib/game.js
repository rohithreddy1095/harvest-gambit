// Game state: game.json is the single source of truth. Everything else
// (the page, the post images, the PGN) is derived from it.
import { Chess } from 'chess.js';
import fs from 'node:fs';

export const STATE_FILE = new URL('../game.json', import.meta.url);

export function newGame({ white = 'rohith', black = 'claude', cutoff = '20:00', tz = 'Asia/Kolkata', preview = false } = {}) {
  return {
    title: 'Harvest Gambit',
    preview,                      // true = sample game, page shows a banner
    white, black,                 // white = Livestock (Rohith + the crowd), black = Crops (Claude)
    cutoff, tz,                   // replies before this local time count for the day's move
    startedAt: new Date().toISOString(),
    moves: [],                    // {san, by, suggestedBy?, note?, at}
    suggestions: [],              // replies for the next Livestock move
    result: null,
  };
}

export function load() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

export function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

export function replay(state) {
  const chess = new Chess();
  for (const m of state.moves) chess.move(m.san);
  return chess;
}

// Every ply as a position, for the page's replay scrubber and the timelapse.
export function plies(state) {
  const chess = new Chess();
  const out = [{ fen: chess.fen(), move: null }];
  for (const m of state.moves) {
    const mv = chess.move(m.san);
    out.push({ fen: chess.fen(), move: { ...m, from: mv.from, to: mv.to, captured: mv.captured || null, piece: mv.piece, color: mv.color } });
  }
  return out;
}

export function play(state, text, { by, suggestedBy, note } = {}) {
  const chess = replay(state);
  const parsed = parseMove(chess, text);
  if (!parsed.san) throw new Error(`Not a legal move here: "${text}" (${parsed.reason})`);
  const expected = chess.turn() === 'w' ? state.white : state.black;
  by = by || expected;
  chess.move(parsed.san);
  state.moves.push({ san: parsed.san, by, ...(suggestedBy && { suggestedBy }), ...(note && { note }), at: new Date().toISOString() });
  if (chess.turn() === 'b') state.suggestions = [];   // Livestock just moved: the round's votes are spent
  if (chess.isGameOver()) state.result = resultOf(chess);
  return parsed.san;
}

function resultOf(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
  return '1/2-1/2';
}

// ---- Reply parsing -------------------------------------------------------
// Replies arrive as "Nf3", "nf3!!", "e2e4", "knight to f3", "push the h pawn",
// "castle short", "Bxf7+ let's go". Resolve to exactly one legal SAN or explain why not.

const PIECE_WORDS = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', horse: 'n', pawn: 'p',
  // farm names from the page's legend
  farmer: 'k', matriarch: 'q', silo: 'r', scarecrow: 'b', seedling: 'p', lamb: 'p',
};

export function parseMove(chess, raw) {
  const legal = chess.moves({ verbose: true });
  const text = raw.toLowerCase().replace(/[!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = (cands, why) => {
    const uniq = [...new Map(cands.map(m => [m.san, m])).values()];
    if (uniq.length === 1) return { san: uniq[0].san };
    if (uniq.length === 0) return { san: null, reason: why };
    return { san: null, reason: `ambiguous: ${uniq.map(m => m.san).join(', ')}` };
  };

  // Castling
  if (/\b(o-o-o|0-0-0|castle[sd]? (long|queen ?side)|long castle|queen ?side castle)\b/.test(text))
    return pick(legal.filter(m => m.flags.includes('q')), 'cannot castle queenside');
  if (/\b(o-o|0-0|castle[sd]?( short| king ?side)?|short castle|king ?side castle)\b/.test(text))
    return pick(legal.filter(m => m.flags.includes('k')), 'cannot castle kingside');

  const sq = [...text.matchAll(/\b([a-h][1-8])\b/g)].map(m => m[1]);
  const pieceWord = Object.keys(PIECE_WORDS).find(w => new RegExp(`\\b${w}s?\\b`).test(text));
  const piece = pieceWord && PIECE_WORDS[pieceWord];

  // "knight to f3" is Nf3, not the pawn move f3: a bare square defers to a piece named before it.
  const byWords = () => {
    // "e2 to e4" names a from/to pair; otherwise try each square as the destination
    // in reply order, so "queen f3 attack f7" is Qf3.
    const mine = legal.filter(m => !piece || m.piece === piece);
    if (sq.length > 1) {
      const pair = mine.filter(m => m.from === sq[0] && m.to === sq[1]);
      if (pair.length) return pick(pair, '');
    }
    for (const to of sq) {
      const r = pick(mine.filter(m => m.to === to), '');
      if (r.san || r.reason) return r;
    }
    return { san: null, reason: `nothing ${piece ? PIECE_NAME[piece] + ' ' : ''}can go to ${sq.join(' or ')}` };
  };

  // Exact SAN / UCI tokens anywhere in the reply. Try as written first so "bxc6"
  // stays a pawn capture, then with the piece letter capitalised ("nf3" -> Nf3).
  const strip = t => t.replace(/[+#]$/, '');
  for (const tok of raw.replace(/[!?]+/g, '').split(/[\s,;:()]+/)) {
    if (!tok) continue;
    for (const v of [tok, tok.replace(/^([kqrbn])/i, c => c.toUpperCase())]) {
      const hit = legal.find(m => strip(m.san) === strip(v).replace(/^0-0/, 'O-O'));
      const namedFirst = piece && piece !== 'p' && text.indexOf(pieceWord) < text.indexOf(tok.toLowerCase());
      if (hit && !(namedFirst && hit.piece === 'p' && /^[a-h][1-8]$/.test(strip(v)))) return { san: hit.san };
    }
    const uci = tok.toLowerCase().match(/^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/);
    if (uci) {
      const hit = legal.filter(m => m.from === uci[1] && m.to === uci[2] && (!m.promotion || m.promotion === (uci[3] || 'q')));
      if (hit.length) return pick(hit, '');
    }
  }

  if (sq.length) return byWords();

  // "push the h pawn", "h-pawn forward"
  const file = text.match(/\b([a-h])[- ]?pawn\b/);
  if (file) return pick(legal.filter(m => m.piece === 'p' && m.from[0] === file[1] && !m.captured), `no ${file[1]}-pawn push`);

  return { san: null, reason: 'no move found in reply' };
}

const PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

// ---- The daily round -----------------------------------------------------

export function addSuggestion(state, { handle, text, likes = 0, url }) {
  const chess = replay(state);
  if (chess.turn() !== 'w') throw new Error('Suggestions are for the Livestock move; it is the Crops turn.');
  handle = handle.replace(/^@?/, '@');
  const parsed = parseMove(chess, text);
  const existing = state.suggestions.find(s => s.handle === handle);
  const entry = { handle, text, san: parsed.san, ...(parsed.reason && { reason: parsed.reason }), likes: Number(likes), ...(url && { url }), at: new Date().toISOString() };
  if (existing) Object.assign(existing, entry); else state.suggestions.push(entry);   // one voice per person: latest reply wins
  return entry;
}

// Moves ranked by likes, then by how many people suggested them, then earliest.
export function tally(state) {
  const by = new Map();
  for (const s of state.suggestions.filter(s => s.san)) {
    const t = by.get(s.san) || { san: s.san, likes: 0, voters: [], first: s.at };
    t.likes += s.likes; t.voters.push(s.handle); if (s.at < t.first) t.first = s.at;
    by.set(s.san, t);
  }
  return [...by.values()].sort((a, b) => b.likes - a.likes || b.voters.length - a.voters.length || a.first.localeCompare(b.first));
}

export function nextCutoff(state, now = new Date()) {
  // cutoff is a wall-clock time in state.tz; find the next occurrence as a UTC instant
  const [h, m] = state.cutoff.split(':').map(Number);
  const offsetMin = tzOffsetMinutes(state.tz, now);
  const local = new Date(now.getTime() + offsetMin * 60000);
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - offsetMin * 60000;
  if (target <= now.getTime()) target += 86400000;
  return new Date(target);
}

function tzOffsetMinutes(tz, at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(at).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

// Seasons advance with the game, not the calendar: the finale timelapse is one year on the farm.
export function seasonOf(fullmove) {
  if (fullmove <= 8) return 'spring';
  if (fullmove <= 18) return 'summer';
  if (fullmove <= 30) return 'autumn';
  return 'winter';
}
