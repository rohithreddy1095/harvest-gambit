// A flat, readable diagram of a puzzle position for the reply thread: node puzzles/diagram.mjs 1
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const n = +(process.argv[2] || 1), pz = JSON.parse(fs.readFileSync(new URL('selected.json', import.meta.url)))[n - 1];
const tpl = fs.readFileSync(new URL('../template.html', import.meta.url), 'utf8');
const symbols = tpl.match(/<symbol[\s\S]*?<\/symbol>/g).join('\n');
const S = 110, O = 90, W = O * 2 + S * 8;
let sq = '', pcs = '', coords = '';
fs.writeFileSync('/dev/null', '');
const rows = pz.fen.split(' ')[0].split('/');
for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
  const light = (r + f) % 2 === 0, x = O + f * S, y = O + r * S;
  sq += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${light ? '#ead38c' : '#7d5933'}"/>`;
  sq += light ? '' : Array.from({ length: 9 }, (_, k) => `<path d="M${x} ${y + 6 + k * 12.5}q${S / 4} -2 ${S / 2} 0t${S / 2} 0" stroke="#5f4124" stroke-width="2" fill="none" opacity=".5"/>`).join('');
}
rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) { f += +ch; continue; } const c = ch === ch.toUpperCase() ? 'w' : 'b', t = ch.toLowerCase(); pcs += `<g transform="translate(${O + f * S + 5} ${O + r * S + 5}) scale(${(S - 10) / 100})"><use href="#${t}" width="100" height="100" class="pc-${c}"/><use href="#em-${c}" width="100" height="100" class="em-${c}"/>${t === 'n' ? `<use href="#eye" width="100" height="100" fill="${c === 'w' ? '#2b2218' : '#9fcf6a'}"/>` : ''}</g>`; f++; } });
for (let i = 0; i < 8; i++) coords += `<text x="${O + i * S + S / 2}" y="${O + 8 * S + 44}" class="co">${'abcdefgh'[i]}</text><text x="${O - 34}" y="${O + i * S + S / 2 + 10}" class="co">${8 - i}</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W + 70}" viewBox="0 0 ${W} ${W + 70}">
<style>.pc-w{fill:#f6f1e4;stroke:#2b2218}.pc-b{fill:#2f5b33;stroke:#0e1e10}.pc-w,.pc-b{stroke-width:3.2;stroke-linejoin:round}.em-w{fill:none;stroke:#2b2218;stroke-width:2;stroke-linecap:round;opacity:.55}.em-b{fill:#9fcf6a}
.co{font:600 30px 'DejaVu Sans Mono',monospace;fill:#e3ead4;text-anchor:middle}.t{font:600 40px 'DejaVu Serif',serif;fill:#f4eddd}.s{font:400 28px 'DejaVu Sans',sans-serif;fill:#c8cfb8}</style>
<defs>${symbols}</defs><rect width="100%" height="100%" fill="#131a10"/>
<text x="${O}" y="58" class="t">Harvest Gambit #${n}</text><text x="${W - O}" y="58" class="s" text-anchor="end">Livestock (white) to move · mate in 3</text>
<rect x="${O - 4}" y="${O - 4}" width="${S * 8 + 8}" height="${S * 8 + 8}" fill="#2c3727"/>${sq}${pcs}${coords}</svg>`;
const out = new URL(`../film/out/puzzle-${n}-diagram`, import.meta.url).pathname;
fs.writeFileSync(out + '.svg', svg);
execFileSync('rsvg-convert', ['-w', '1080', out + '.svg', '-o', out + '.png']);
console.log('wrote', out + '.png');
