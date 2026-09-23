
// ---------------------------------------------------------------- the puzzles, played on the field
import { Chess } from 'chess.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PUZZLES = /*__PUZZLES__*/[];
const $ = id => document.getElementById(id);
const wait = s => new Promise(r => setTimeout(r, s * 1000));
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

// ---- tweens on the render clock
let clock = 0;
const tweens = new Set();
const animate = (dur, fn) => new Promise(res => tweens.add({ t0: clock, dur, fn, res }));
function runTweens() { for (const tw of tweens) { const k = clamp((clock - tw.t0) / tw.dur, 0, 1); tw.fn(k); if (k >= 1) { tweens.delete(tw); tw.res(); } } }

// ---- marks painted on the field
const GOLD = 0xffd36b, RED = 0xff8a66, PALE = 0xfff3d0;
const geoDot = new THREE.CircleGeometry(0.8, 40).rotateX(-Math.PI / 2);
const geoRing = new THREE.RingGeometry(2.05, 2.45, 72).rotateX(-Math.PI / 2);
const geoSquare = new THREE.PlaneGeometry(5.9, 5.9).rotateX(-Math.PI / 2);
const marks = new THREE.Group(); scene.add(marks);
function mark(geo, color, sq, opacity, kind) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  const [x, z] = sqXZ(sq); m.position.set(x, surfaceY(x, z) + (geo === geoSquare ? 0.05 : 0.2), z);
  m.userData = { kind, base: opacity }; marks.add(m); return m;
}
function clearMarks(...kinds) { for (const m of [...marks.children]) if (!kinds.length || kinds.includes(m.userData.kind)) { marks.remove(m); m.material.dispose(); } }

// ---- sound: synthesised on the spot, after the first tap
let ac = null, master = null, soundOn = false;
function initSound() {
  if (ac) return; ac = new AudioContext(); master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
  const len = ac.sampleRate * 4, buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let b = 0; for (let i = 0; i < len; i++) { b = 0.985 * b + 0.06 * (Math.random() * 2 - 1); d[i] = b; } }
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  const g = ac.createGain(); g.gain.value = 0.5;
  const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 0.3; lfo.connect(lg).connect(g.gain); lfo.start();
  src.connect(lp).connect(g).connect(master); src.start();
}
function setSound(on) { initSound(); soundOn = on; master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.2); $('sound').textContent = on ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', String(on)); }
function thud(weight = 1) {
  if (!soundOn) return; const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
  g.gain.setValueAtTime(0.5 * weight, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
}
function chime() {
  if (!soundOn) return; [587.3, 740, 880, 1174.7].forEach((f, i) => {
    const t = ac.currentTime + i * 0.16, o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2); o.connect(g).connect(master); o.start(t); o.stop(t + 2.3);
  });
}

// ---- moving pieces on the field
let pieces = [], pieceAt = {};
async function fieldMove(mv) {
  const p = pieceAt[mv.from], info = { mv, p, cap: null, rook: null, promo: null };
  const capSq = mv.flags.includes('e') ? mv.to[0] + mv.from[1] : mv.to;
  if (mv.captured) info.cap = pieceAt[capSq];
  const [x0, z0] = sqXZ(mv.from), [x1, z1] = sqXZ(mv.to), hop = p.type === 'n' ? 2.4 : 0.5;
  delete pieceAt[mv.from];
  await animate(0.8, k => {
    const e = ease(k); setPose(p, lerp(x0, x1, e), lerp(z0, z1, e), 0, Math.sin(Math.PI * k) * hop);
    if (info.cap && k > 0.5) setPose(info.cap, info.cap.x, info.cap.z, ease((k - 0.5) / 0.5) * 1.0);
  });
  thud(p.h / 4);
  if (info.cap) { delete pieceAt[capSq]; info.cap.group.visible = info.cap.blob.visible = false; }
  if (mv.flags.includes('k') || mv.flags.includes('q')) {           // castling: the rook follows
    const rank = mv.from[1], [rf, rt] = mv.flags.includes('k') ? ['h', 'f'] : ['a', 'd'];
    const r = pieceAt[rf + rank]; info.rook = r; delete pieceAt[rf + rank];
    const [a, b] = sqXZ(rf + rank), [c, d] = sqXZ(rt + rank);
    await animate(0.5, k => setPose(r, lerp(a, c, ease(k)), lerp(b, d, ease(k)), 0, Math.sin(Math.PI * k) * 0.4));
    pieceAt[rt + rank] = r; r.sq = rt + rank;
  }
  pieceAt[mv.to] = p; p.sq = mv.to;
  if (mv.promotion) {                                                // the pawn is replaced where it stands
    const q = makePiece(mv.promotion, p.color, mv.to); info.promo = q; pieces.push(q);
    p.group.visible = p.blob.visible = false; pieceAt[mv.to] = q;
  }
  return info;
}
async function fieldUndo(info) {
  const { mv, p } = info;
  if (info.promo) { removePiece(info.promo); pieces = pieces.filter(x => x !== info.promo); p.group.visible = p.blob.visible = true; }
  if (info.rook) {
    const rank = mv.from[1], [rf, rt] = mv.flags.includes('k') ? ['h', 'f'] : ['a', 'd'], [a, b] = sqXZ(rt + rank), [c, d] = sqXZ(rf + rank);
    delete pieceAt[rt + rank]; await animate(0.4, k => setPose(info.rook, lerp(a, c, ease(k)), lerp(b, d, ease(k))));
    pieceAt[rf + rank] = info.rook; info.rook.sq = rf + rank;
  }
  const [x0, z0] = sqXZ(mv.to), [x1, z1] = sqXZ(mv.from);
  delete pieceAt[mv.to];
  if (info.cap) { info.cap.group.visible = true; }
  await animate(0.65, k => {
    const e = ease(k); setPose(p, lerp(x0, x1, e), lerp(z0, z1, e), 0, Math.sin(Math.PI * k) * (p.type === 'n' ? 1.8 : 0.4));
    if (info.cap) setPose(info.cap, info.cap.x, info.cap.z, 1 - ease(k));
  });
  pieceAt[mv.from] = p; p.sq = mv.from;
  if (info.cap) pieceAt[info.cap.sq] = info.cap;
}

// ---- puzzle state
let idx = 0, pz, game, node, step, busy = false, selected = null, targets = [], tries, hints, solved, played;
const STEP_LEFT = ['Mate in 3.', 'Mate in 2 to go.', 'Mate in 1 to go.'];
function say(text, cls = '') { $('msg').textContent = text; $('msg').className = cls; }
function drawSteps() {
  [...$('steps').children].forEach((li, i) => {
    const s = played[i];
    li.className = s ? (tries[i] ? 'retry' : 'done') : (i === step && !solved ? 'now' : '');
    li.innerHTML = s ? `<b>${i + 1}. ${s.w}</b><span>${s.b ? `Crops: ${s.b}` : 'Checkmate'}</span>` : `<span>Move ${i + 1}</span>`;
  });
}
function loadPuzzle(i) {
  idx = (i + PUZZLES.length) % PUZZLES.length; pz = PUZZLES[idx];
  try { history.replaceState(null, '', `#p${idx + 1}`); } catch {}
  game = new Chess(pz.fen); node = pz.tree; step = 0; tries = [0, 0, 0]; hints = 0; solved = false; played = []; selected = null; targets = [];
  for (const p of pieces) removePiece(p);
  pieces = placePosition(pz.fen); pieceAt = Object.fromEntries(pieces.map(p => [p.sq, p]));
  clearMarks();
  const setup = new Chess(pz.setupFen).move(pz.setup);
  mark(geoSquare, GOLD, setup.from, 0.07, 'last'); mark(geoSquare, GOLD, setup.to, 0.11, 'last');
  $('pz-name').textContent = `Harvest Gambit #${idx + 1}`;
  $('pz-link').href = pz.url;
  [...$('pz-nav').children].forEach((b, j) => b.setAttribute('aria-current', String(j === idx)));
  $('solved').hidden = true; $('actions').hidden = false;
  say(`The Crops just played ${pz.setup}. Tap a cream piece, then the square it should go to.`);
  drawSteps();
}
function select(sq) {
  selected = sq; clearMarks('sel', 'target', 'hint');
  mark(geoRing, GOLD, sq, 0.95, 'sel');
  targets = game.moves({ square: sq, verbose: true }).map(m => m.to);
  for (const to of [...new Set(targets)]) mark(pieceAt[to] ? geoRing : geoDot, pieceAt[to] ? RED : GOLD, to, pieceAt[to] ? 0.8 : 0.6, 'target');
  if (!targets.length) say('That piece has no legal moves here.');
}
function deselect() { selected = null; targets = []; clearMarks('sel', 'target'); }

async function tryMove(from, to) {
  busy = true; deselect(); clearMarks('hint');
  const mv = game.move({ from, to, promotion: 'q' });
  const info = await fieldMove(mv);
  const hit = node[mv.san];
  if (!hit) {
    tries[step]++;
    say(`After ${mv.san} the Crops slip away. Try another move.`, 'bad');
    await wait(1.0); game.undo(); await fieldUndo(info);
    busy = false; return false;
  }
  clearMarks('last'); mark(geoSquare, GOLD, mv.from, 0.07, 'last'); mark(geoSquare, GOLD, mv.to, 0.11, 'last');
  if (hit.mate) { played[step] = { w: mv.san }; await checkmate(); busy = false; return true; }
  say(`${mv.san}. Good.`, 'good'); drawSteps();
  await wait(0.5);
  const reply = game.move(hit.reply);
  await fieldMove(reply);
  played[step] = { w: mv.san, b: reply.san };
  node = hit.next; step++;
  clearMarks('last'); mark(geoSquare, GOLD, reply.from, 0.07, 'last'); mark(geoSquare, GOLD, reply.to, 0.11, 'last');
  say(`The Crops answer ${reply.san}. ${STEP_LEFT[step]}`);
  drawSteps(); busy = false; return true;
}
async function checkmate() {
  solved = true; drawSteps(); clearMarks('sel', 'target', 'hint');
  say('Checkmate. The Crops king goes down in the wheat.', 'good');
  const k = pieces.find(p => p.type === 'k' && p.color === 'b' && p.group.visible);
  chime();
  await animate(1.8, t => setPose(k, k.x, k.z, 0, 0, Math.pow(t, 2.2) * 1.42, Math.PI / 2));
  thud(1.4);
  const grid = tries.map(n => (n ? '🟨' : '🟩')).join('');
  $('share').textContent = `Harvest Gambit #${idx + 1} · mate in 3\n${grid}${hints ? ' with a hint' : ''} · played on the field`;
  $('solved').hidden = false; $('actions').hidden = true;
}
function hint() {
  if (busy || solved) return;
  const mainline = pz.line[step * 2];
  const want = played.every((s, i) => s.w === pz.line[i * 2]) && node[mainline] ? mainline : Object.keys(node)[0];
  const mv = game.moves({ verbose: true }).find(m => m.san === want);
  hints++; deselect(); clearMarks('hint');
  mark(geoRing, PALE, mv.from, 0.9, 'hint');
  if (hints >= 2) { mark(geoDot, PALE, mv.to, 0.8, 'hint'); say(`Try ${mv.san}.`); }
  else say('This piece starts it. Ask again to see where it goes.');
}

// ---- picking squares on the field
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new V3(0, 1, 0), -0.1);
function pick(ev) {
  ndc.set(ev.clientX / innerWidth * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pieces.filter(p => p.group.visible).map(p => p.mesh), false);
  if (hits.length) return pieces.find(p => p.mesh === hits[0].object).sq;
  const pt = new V3(); return ray.ray.intersectPlane(ground, pt) ? xzSq(pt.x, pt.z) : null;
}
function onSquare(sq) {
  if (busy || solved || !sq) return;
  if (selected && targets.includes(sq)) return tryMove(selected, sq);
  const p = pieceAt[sq];
  if (p && p.color === 'w') select(sq); else { deselect(); if (p) say('Those are the Crops. Move a cream piece.'); }
}

// ---- camera: a short flight in, then orbit around the board
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enabled: false, enableDamping: true, dampingFactor: 0.08, enablePan: false, minDistance: 16, maxDistance: 115, maxPolarAngle: 1.3, minPolarAngle: 0.15, rotateSpeed: 0.6 });
// Frame the board clear of the panel: to its right on wide screens, above it on tall ones.
const playerView = () => {
  const a = innerWidth / innerHeight;
  if (a < 0.9) return { pos: [0, 70, 96], target: [0, 0, 12], fov: 56 };
  const side = innerWidth > 900 ? clamp(430 / innerWidth, 0, 0.42) : 0;   // share of the screen the panel covers
  return { pos: [-side * 24, 26, 52], target: [-side * 38, 0, -2], fov: 46 };
};
let intro = { t: 0, dur: 6, from: [70, 46, 170], fromLook: [0, 2, 10] };
function flyIntro(dt) {
  const v = playerView(); intro.t += dt; const k = ease(clamp(intro.t / intro.dur, 0, 1));
  camera.position.set(...intro.from.map((a, i) => lerp(a, v.pos[i], k)));
  camera.lookAt(...intro.fromLook.map((a, i) => lerp(a, v.target[i], k)));
  camera.fov = lerp(50, v.fov, k); camera.updateProjectionMatrix();
  if (k >= 1) endIntro();
}
function endIntro() {
  if (!intro) return; intro = null; const v = playerView();
  camera.position.set(...v.pos); camera.fov = v.fov; camera.updateProjectionMatrix();
  controls.target.set(...v.target); controls.enabled = true; controls.update();
  $('panel').hidden = false;
}

// ---- run
await startWorld(m => $('status').textContent = m);
applySky(12, 152, 0.0005, 1.08);
camera.near = 0.3; camera.aspect = innerWidth / innerHeight;
PUZZLES.forEach((_, j) => { const b = document.createElement('button'); b.textContent = j + 1; b.setAttribute('aria-label', `Puzzle ${j + 1}`); b.addEventListener('click', () => { if (!busy) loadPuzzle(j); }); $('pz-nav').append(b); });
const fromHash = +(location.hash.match(/^#p(\d+)$/) || [])[1];
loadPuzzle(fromHash ? fromHash - 1 : 0);
$('loading').classList.add('gone'); $('sound').hidden = false;

let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; if (intro) endIntro(); });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 600; down = null;
  if (moved < 8 && quick && !intro) onSquare(pick(e));
});
renderer.domElement.addEventListener('pointermove', e => { if (down || intro || e.pointerType !== 'mouse') return; const sq = pick(e); renderer.domElement.style.cursor = sq && (targets.includes(sq) || pieceAt[sq]?.color === 'w') ? 'pointer' : ''; });
$('reset').addEventListener('click', () => { if (!busy) loadPuzzle(idx); });
$('hint').addEventListener('click', hint);
$('next').addEventListener('click', () => loadPuzzle(idx + 1));
$('sound').addEventListener('click', () => setSound(!soundOn));
$('copy').addEventListener('click', async () => {
  const text = $('share').textContent;
  try { await navigator.clipboard.writeText(text); $('copy').textContent = 'Copied'; }
  catch { const r = document.createRange(); r.selectNodeContents($('share')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copy').textContent = 'Selected, copy it'; }
  setTimeout(() => $('copy').textContent = 'Copy result', 2000);
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); composer.setSize(innerWidth, innerHeight); });

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
  tickWorld(clock);
  runTweens();
  if (intro) flyIntro(dt); else controls.update();
  for (const m of marks.children) if (m.userData.kind === 'target' || m.userData.kind === 'hint') m.material.opacity = m.userData.base * (0.75 + 0.25 * Math.sin(clock * 4));
  composer.render();
});
// The benchmark interface (bench/CONTRACT.md): lets a checker play the puzzles without a mouse.
const until = f => new Promise(r => { const t = () => f() ? r() : setTimeout(t, 50); t(); });
window.__play = {
  count: PUZZLES.length,
  async load(i) { await until(() => !busy); loadPuzzle(i); },
  state: () => ({ index: idx, idx, step, solved, busy, fen: game.fen() }),
  async move(from, to) {
    await until(() => !busy);
    const legal = !solved && game.moves({ verbose: true }).some(m => m.from === from && m.to === to);
    if (!legal) return { legal: false, accepted: false, solved };
    const accepted = await tryMove(from, to);
    return { legal: true, accepted, solved };
  },
  loadPuzzle, onSquare,
};
