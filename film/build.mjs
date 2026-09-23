// Assemble the two pages from the shared world:
//   film/index.html  - the film (and its ?record mode for render.mjs)
//   play/index.html  - the puzzles, playable on the field
import fs from 'node:fs';
const here = f => new URL(f, import.meta.url);
const read = f => fs.readFileSync(here(f), 'utf8');
const world = read('src/world.js');
const puzzles = JSON.parse(read('../puzzles/selected.json'));
const page = (tpl, name, body) => read(tpl).replace('/*__JS__*/', () => `const PAGE = '${name}';\n${world}\n${body}`);

fs.writeFileSync(here('index.html'), page('src/template-film.html', 'film', read('src/film.js').replace('/*__PUZZLE__*/null', () => JSON.stringify(puzzles[0]))));
fs.mkdirSync(here('../play/'), { recursive: true });
fs.writeFileSync(here('../play/index.html'), page('src/template-play.html', 'play', read('src/puzzle.js').replace('/*__PUZZLES__*/[]', () => JSON.stringify(puzzles))));
console.log(`built film/index.html and play/index.html with ${puzzles.length} puzzles`);
