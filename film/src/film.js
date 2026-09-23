
// ---------------------------------------------------------------- the film
// The walk ends with the field replanting itself: both armies sink into the soil and
// puzzle #1 grows up out of it, seen from behind the Livestock side.
const PUZZLE = /*__PUZZLE__*/null;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Camera: [t, [x,y,z]] positions and look targets (a third element of 0 holds the spline still there).
const camPos = track([
  [0, [170, 95, 520]], [6, [96, 58, 380]], [12, [30, 17, 236]], [17, [3.5, 3.4, 162]], [22, [-0.6, 1.8, 118]],
  [27, [0.4, 1.72, 66]], [32, [0.1, 1.7, 36]], [36, [-0.9, 1.25, 25.8]], [40, [-0.8, 1.7, 13.5]], [45, [1.4, 1.85, 2.5]],
  [48, [17.8, 2.4, -10]], [50, [18.8, 2.4, -18.6]], [51.8, [19.3, 2.5, -20.8]], [54.5, [30, 18, 6]],
  [58.8, [0, 18, 41.5], 0], [66, [0, 17.2, 39.5]],
]);
const camLook = track([
  [0, [10, 5, 120]], [6, [2, 4, 96]], [12, [-3, 3, 112]], [17, [-3, 2.4, 96]], [22, [-10, 6.5, 104]],
  [27, [0, 3.3, 20]], [32, [0.6, 3.8, 21]], [36, [2.4, 3.3, 20.6]], [40, [-3, 2.5, 3]], [45, [0, 3.0, -21]],
  [48, [16, 2.6, -18]], [50, [15, 2.3, -21]], [51.8, [15, 2.3, -21]], [54.5, [2, 0, -4]],
  [58.8, [0, 1, -4], 0], [66, [0, 1, -4]],
]);
const camFov = track([[0, 36], [12, 42], [22, 52], [36, 50], [45, 40], [50, 50], [51.8, 48], [54.5, 44], [58.8, 48], [66, 47]]);
const dof = track([[0, [30, 0]], [33, [12, 0]], [35, [6.3, 0.0003]], [37.5, [6.3, 0.0003]], [39, [10, 0]], [44, [23, 0.00012]], [46, [23, 0.00012]], [48.5, [4.3, 0.0007]], [51.8, [4.3, 0.0007]], [53, [30, 0]]]);
const sunTrack = track([[0, [4.6, 22]], [14, [10, 52]], [30, [16, 96]], [44, [14, 142]], [54, [12, 156]], [60, [10, 160]], [66, [8.5, 164]]]);
const expo = track([[0, 1], [52, 1], [57, 1.12], [66, 1.12]]);
const mist = track([[0, 0.005], [10, 0.0025], [22, 0.0006], [52, 0.0006], [66, 0.0012]]);
const CARDS = [['k-title', 1.0, 6.2], ['k-code', 7.6, 13.6], ['k-claude', 15.0, 20.6], ['k-puzzle', 58.6, 67.5]];
const cardEls = CARDS.map(([id, a, b]) => [document.getElementById(id), a, b]);
const laterEl = document.querySelector('#k-puzzle .later');

const easeOutBack = x => { const c1 = 1.3, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
let army = [], planted = [];
function setupPieces() {
  const r = mulberry32(404);
  army = placePosition(START_FEN).map(p => Object.assign(p, { x0: p.x, z0: p.z, delay: r() * 0.9 + (p.z + 24) / 48 * 0.5 }));
  planted = placePosition(PUZZLE.fen).map(p => Object.assign(p, { x0: p.x, z0: p.z, delay: r() * 0.7 + (24 - p.z) / 48 * 0.4 }));
}
function animatePieces(t) {
  for (const p of army) setPose(p, p.x0, p.z0, sstep(53.0 + p.delay, 54.9 + p.delay, t));
  for (const p of planted) setPose(p, p.x0, p.z0, 1 - easeOutBack(clamp((t - 55.5 - p.delay) / 1.9, 0, 1)));
}

function update(t) {
  tickWorld(t);
  const [el, az] = sunTrack(t);
  applySky(el, az, mist(t)[0], expo(t)[0]);
  animatePieces(t);

  const p = camPos(t), l = camLook(t);
  camera.position.set(...p);
  camera.position.y = Math.max(camera.position.y, height(p[0], p[2]) + 0.9);
  camera.lookAt(...l);
  camera.fov = camFov(t)[0];
  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) { const v = shot.split(',').map(Number); camera.position.set(v[0], v[1], v[2]); camera.lookAt(v[3], v[4], v[5]); camera.fov = v[6] || 50; }
  camera.near = clamp(camera.position.y * 0.02, 0.05, 2); camera.updateProjectionMatrix();
  if (bokeh) { const [f, a] = dof(t); bokeh.uniforms.focus.value = f; bokeh.uniforms.aperture.value = a; bokeh.enabled = a > 1e-6; }

  for (const [el2, a, b] of cardEls) {
    const o = sstep(a, a + 1.1, t) * (1 - sstep(b - 1.1, b, t));
    el2.style.opacity = o.toFixed(3); el2.style.transform = `translateY(${((1 - o) * 10).toFixed(1)}px)`;
  }
  laterEl.style.opacity = sstep(61.2, 62.3, t).toFixed(3);
}

// ---------------------------------------------------------------- run
const statusEl = document.getElementById('status');
await startWorld(m => statusEl.textContent = m);
setupPieces();

if (RECORD) {
  const gl = renderer.getContext();
  const probe = label => console.warn(`[probe] ${label}: lost=${gl.isContextLost()} err=${gl.getError()}`);
  update(0); composer.render(); probe('after first frame');
  window.__frame = async t => { update(t); composer.render(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; };
  window.__stats = world.stats;
  window.__ready = true;
} else {
  document.querySelector('#k-claude .line').innerHTML = 'Written by Claude in one conversation.<br>Rendered live, in your browser.';
  let t = 0, playing = false, last = performance.now();
  const start = document.getElementById('start'), bar = document.getElementById('bar'), pp = document.getElementById('pp'), scrub = document.getElementById('scrub'), tc = document.getElementById('tc');
  statusEl.textContent = '';
  start.hidden = false; update(0.01); composer.render();
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const setPlaying = v => { playing = v; pp.textContent = v ? 'Pause' : 'Play'; last = performance.now(); };
  start.addEventListener('click', () => { start.hidden = true; statusEl.hidden = true; bar.hidden = false; if (t >= DURATION) t = 0; setPlaying(true); });
  pp.addEventListener('click', () => { if (t >= DURATION) t = 0; setPlaying(!playing); });
  scrub.addEventListener('input', () => { t = +scrub.value; update(t); composer.render(); tc.textContent = fmt(t); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; composer.setSize(innerWidth, innerHeight); });
  camera.aspect = innerWidth / innerHeight;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (playing) { t += Math.min(0.1, (now - last) / 1000); if (t >= DURATION) { t = DURATION; setPlaying(false); } scrub.value = t; tc.textContent = fmt(t); update(t); composer.render(); }
    last = now;
  });
}
