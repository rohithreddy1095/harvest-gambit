// Render the page: template.html + game state baked in as JSON.
// The page is the record — republishing it is how a move goes live.
import fs from 'node:fs';
import * as G from './game.js';

export function build(state, outDir = new URL('../dist/', import.meta.url)) {
  const chess = G.replay(state);
  const data = {
    title: state.title,
    preview: state.preview,
    white: state.white, black: state.black,
    plies: G.plies(state),
    suggestions: state.suggestions.map(({ handle, text, san, reason, likes }) => ({ handle, text, san, reason, likes })),
    tally: G.tally(state),
    turn: chess.turn(),
    day: chess.moveNumber(),
    season: G.seasonOf(chess.moveNumber()),
    inCheck: chess.inCheck(),
    result: state.result,
    cutoff: G.nextCutoff(state).toISOString(),
    cutoffLabel: `${fmt12(state.cutoff)} IST`,
    builtAt: new Date().toISOString(),
  };
  const tpl = fs.readFileSync(new URL('../template.html', import.meta.url), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  fs.mkdirSync(outDir, { recursive: true });
  const out = new URL('index.html', outDir);
  fs.writeFileSync(out, tpl.replace('/*__GAME__*/null', json));
  return out.pathname;
}

function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
