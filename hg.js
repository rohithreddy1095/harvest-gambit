#!/usr/bin/env node
// hg — run the Harvest Gambit.
//   hg new [--preview]                          start a fresh game (overwrites game.json)
//   hg suggest @handle "reply text" [--likes N]  record a reply's move for the Livestock side
//   hg tally                                    ranked suggestions for the current round
//   hg play <move> [--by who] [--from @handle] [--note "..."]
//   hg undo                                     take back the last ply
//   hg status                                   board, turn, cutoff, round
//   hg build                                    render dist/index.html from game.json
//   hg pgn
import fs from 'node:fs';
import * as G from './lib/game.js';
import { build } from './lib/build.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}; const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  } else args.push(rest[i]);
}

const die = msg => { console.error(`hg: ${msg}`); process.exit(1); };

try {
  switch (cmd) {
    case 'new': {
      if (fs.existsSync(G.STATE_FILE) && !flags.force) die('game.json exists; pass --force to start over');
      G.save(G.newGame({ preview: !!flags.preview }));
      console.log('New game. Livestock (white) to move.');
      break;
    }
    case 'suggest': {
      const [handle, ...words] = args;
      if (!handle || !words.length) die('usage: hg suggest @handle "reply text" [--likes N]');
      const s = G.load();
      const e = G.addSuggestion(s, { handle, text: words.join(' '), likes: flags.likes || 0, url: flags.url });
      G.save(s);
      console.log(e.san ? `${e.handle}: ${e.san}` : `${e.handle}: unreadable — ${e.reason}`);
      break;
    }
    case 'tally': {
      const s = G.load();
      const t = G.tally(s);
      if (!t.length) console.log('No legal suggestions yet.');
      for (const r of t) console.log(`${r.san.padEnd(8)} ${String(r.likes).padStart(4)} likes  ${r.voters.join(' ')}`);
      const bad = s.suggestions.filter(x => !x.san);
      if (bad.length) console.log(`\nUnreadable: ${bad.map(x => `${x.handle} "${x.text}" (${x.reason})`).join('; ')}`);
      break;
    }
    case 'play': {
      if (!args[0]) die('usage: hg play <move> [--by who] [--from @handle] [--note "..."]');
      const s = G.load();
      const san = G.play(s, args.join(' '), { by: flags.by, suggestedBy: flags.from && flags.from.replace(/^@?/, '@'), note: flags.note });
      G.save(s);
      console.log(`Played ${san}.${s.result ? ` Game over: ${s.result}` : ''}`);
      break;
    }
    case 'undo': {
      const s = G.load();
      const m = s.moves.pop();
      if (!m) die('nothing to undo');
      s.result = null; G.save(s);
      console.log(`Took back ${m.san}.`);
      break;
    }
    case 'status': {
      const s = G.load(); const c = G.replay(s);
      console.log(c.ascii());
      const n = c.moveNumber();
      console.log(`Day ${n} · ${G.seasonOf(n)} · ${c.turn() === 'w' ? 'Livestock' : 'Crops'} to move${s.result ? ` · result ${s.result}` : ''}`);
      console.log(`Cutoff ${G.nextCutoff(s).toLocaleString('en-IN', { timeZone: s.tz })} · ${s.suggestions.length} replies this round`);
      console.log(`FEN ${c.fen()}`);
      break;
    }
    case 'build': {
      const out = build(G.load());
      console.log(`Wrote ${out}`);
      break;
    }
    case 'pgn': {
      const s = G.load(); const c = G.replay(s);
      c.header('Event', s.title, 'White', 'Rohith & the crowd (Livestock)', 'Black', 'Claude (Crops)');
      console.log(c.pgn());
      break;
    }
    default:
      console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
  }
} catch (e) { die(e.message); }
