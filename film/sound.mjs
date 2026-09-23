// The film's soundtrack, synthesised sample by sample. No recordings, no samples.
//   node film/sound.mjs  ->  film/out/sound.wav (48 kHz stereo, 66 s)
import fs from 'node:fs';
import path from 'node:path';

const SR = 48000, DUR = 66, N = SR * DUR;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
const L = new Float32Array(N), R = new Float32Array(N);       // dry mix
const RL = new Float32Array(N), RR = new Float32Array(N);     // reverb send

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(66);
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const n2m = s => { const m = s.match(/^([A-G]#?)(-?\d)$/); return NOTE[m[1]] + (+m[2] + 1) * 12; };
// piecewise-linear automation: [[t, v], ...]
const auto = keys => t => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0); } return keys[keys.length - 1][1]; };
function add(i, l, r, send = 0) { if (i < 0 || i >= N) return; L[i] += l; R[i] += r; if (send) { RL[i] += l * send; RR[i] += r * send; } }
const pan = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// RBJ biquad
function biquad(type, f, q) {
  const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'bp') { b0 = a; b1 = 0; b2 = -a; } else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  a0 = 1 + a; a1 = -2 * c; a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
// slow smooth noise for gusts and drift
function smoothNoise(seed, rate) { const r = mulberry32(seed), pts = Array.from({ length: Math.ceil(DUR * rate) + 4 }, r); return t => { const x = t * rate, i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return pts[i] + (pts[i + 1] - pts[i]) * u; }; }

// ------------------------------------------------------------------ score: pad
const CHORDS = [
  [0, 'D2 A2 F#3 A3 E4'], [8.5, 'B1 F#2 D3 F#3 C#4'], [17, 'G1 D2 B2 D3 F#3 A3'], [26, 'E2 B2 D3 G3 F#4'],
  [33, 'A1 E2 A2 C#3 E3 B3'], [41, 'F#1 A2 D3 F#3 A3'], [49, 'G1 D2 G2 B2 D3 A3'], [55, 'A1 E2 A2 D3 E3 B3'],
  [59, 'D1 A1 D2 F#2 A2 D3 F#3 A3 E4'],
].map(([t, s], i, a) => ({ t, end: a[i + 1] ? a[i + 1][0] : DUR, notes: s.split(' ').map(n2m) }));
const padLevel = auto([[0, 0], [2, 0.5], [12, 0.55], [22, 0.45], [36, 0.6], [52, 0.55], [57, 0.8], [60, 1.0], [63.5, 0.8], [66, 0]]);
for (const ch of CHORDS) {
  const att = 2.6, rel = 3.5, t0 = ch.t, t1 = Math.min(DUR, ch.end + rel);
  ch.notes.forEach((m, vi) => {
    const f = midi(m), p = pan(((vi / (ch.notes.length - 1)) - 0.5) * 0.8), phs = Array.from({ length: 14 }, () => rnd() * TAU);
    const vol = 0.055 / Math.sqrt(ch.notes.length) * (m < 40 ? 1.3 : 1);
    for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR) && i < N; i++) {
      const t = i / SR, lt = t - t0;
      const env = Math.min(1, lt / att) * (t > ch.end ? Math.max(0, 1 - (t - ch.end) / rel) : 1);
      if (env <= 0) continue;
      let v = 0;
      for (let h = 1; h <= 6; h++) { const a = 1 / Math.pow(h, 1.6); v += a * (Math.sin(TAU * f * h * 1.0017 * lt + phs[h]) + Math.sin(TAU * f * h * 0.9983 * lt + phs[h + 6])); }
      v *= vol * env * padLevel(t) * (0.85 + 0.15 * Math.sin(TAU * 0.13 * t + vi));
      add(i, v * p[0], v * p[1], 0.55);
    }
  });
}

// ------------------------------------------------------------------ score: piano
const MOTIF = [
  [1.2, 'A4'], [2.4, 'F#4'], [3.6, 'E4'], [5.4, 'D4'],
  [17.2, 'D5'], [18.4, 'B4'], [19.6, 'A4'],
  [26.2, 'G4'], [27.4, 'B4'], [28.6, 'E5'],
  [33.2, 'C#5'], [34.4, 'E5'], [35.6, 'A5'],
  [41.2, 'F#4'], [42.4, 'A4'], [43.6, 'D5'],
  [49.2, 'B4'], [50.4, 'D5'], [51.6, 'G5'],
  [55.4, 'A4'], [56.2, 'D5'], [57.0, 'E5'], [59.0, 'F#5'], [59.0, 'D4'], [59.0, 'A3'],
  [61.2, 'A4'], [62.0, 'D5'],
];
for (const [t0, name] of MOTIF) {
  const m = n2m(name), f = midi(m), p = pan((m - 70) / 18), B = 0.00035, dur = 6;
  const vel = 0.11 * (t0 >= 59 && t0 < 60 ? 1.25 : 1);
  for (let i = Math.floor(t0 * SR), k = 0; k < dur * SR && i < N; i++, k++) {
    const t = k / SR; let v = 0;
    for (let h = 1; h <= 12; h++) {
      const fh = f * h * Math.sqrt(1 + B * h * h); if (fh > 16000) break;
      v += Math.sin(TAU * fh * t) * Math.exp(-t * (0.7 + h * 0.55)) / Math.pow(h, 1.1);
    }
    v *= vel * Math.min(1, t / 0.004);
    if (t < 0.03) v += (rnd() * 2 - 1) * 0.02 * Math.exp(-t * 200);  // hammer
    add(i, v * p[0], v * p[1], 0.7);
  }
}

// ------------------------------------------------------------------ field: wind and wheat
{
  const gust = smoothNoise(1, 0.35), gust2 = smoothNoise(2, 1.1);
  const windLevel = auto([[0, 0.05], [8, 0.07], [14, 0.05], [18, 0.035], [40, 0.035], [52, 0.05], [60, 0.07], [66, 0.05]]);
  const rustle = auto([[0, 0], [15, 0], [19, 1], [44, 1], [50, 0.5], [55, 0]]);
  const lpL = biquad('lp', 380, 0.7), lpR = biquad('lp', 400, 0.7);
  const bpL = biquad('bp', 3400, 0.6), bpR = biquad('bp', 3000, 0.6);
  let bL = 0, bR = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, g = gust(t), g2 = gust2(t);
    bL = 0.985 * bL + 0.06 * (rnd() * 2 - 1); bR = 0.985 * bR + 0.06 * (rnd() * 2 - 1);
    const w = windLevel(t) * (0.5 + g * 0.9);
    const rs = rustle(t) * 0.05 * Math.pow(clamp(g * 0.7 + g2 * 0.5, 0, 1.2), 2);
    add(i, lpL(bL) * w * 2.2 + bpL(rnd() * 2 - 1) * rs, lpR(bR) * w * 2.2 + bpR(rnd() * 2 - 1) * rs, 0.15);
  }
}

// ------------------------------------------------------------------ field: birds
function chirpNote(start, f0, f1, dur, amp, p, vib = 0) {
  const P = pan(p); let ph = 0;
  for (let k = 0; k < dur * SR; k++) {
    const t = k / SR, u = t / dur, f = f0 + (f1 - f0) * u + Math.sin(TAU * 38 * t) * vib;
    ph += TAU * f / SR;
    const env = Math.sin(Math.PI * u) ** 1.5, v = (Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * env * amp;
    add(Math.floor(start * SR) + k, v * P[0], v * P[1], 0.35);
  }
}
{
  const density = auto([[0, 3.2], [16, 2.2], [30, 1.0], [45, 0.6], [54, 0.3], [60, 0]]);
  const r = mulberry32(7); let t = 0.3;
  while (t < 60) {
    const kind = r(), p = r() * 1.8 - 0.9, amp = 0.012 + r() * 0.03;
    if (kind < 0.45) { // warbler phrase
      let s = t; const n = 4 + (r() * 6 | 0), base = 2600 + r() * 1800;
      for (let k = 0; k < n; k++) { const d = 0.05 + r() * 0.08, f = base * (0.8 + r() * 0.5); chirpNote(s, f, f * (0.8 + r() * 0.5), d, amp, p, r() * 150); s += d + 0.02 + r() * 0.05; }
    } else if (kind < 0.75) { // two-note whistle
      const f = 2200 + r() * 1200; chirpNote(t, f, f * 1.05, 0.22, amp, p); chirpNote(t + 0.3, f * 0.84, f * 0.8, 0.28, amp, p);
    } else { // chips
      for (let k = 0; k < 3; k++) chirpNote(t + k * 0.11, 4800 + r() * 1200, 3800, 0.03, amp * 0.8, p);
    }
    t += (0.4 + r() * 1.6) / Math.max(0.2, density(t));
  }
}
// geese crossing overhead, right to left, while the flock is in shot
{
  const r = mulberry32(9);
  for (let t = 9.5; t < 24; t += 0.35 + r() * 0.9) {
    const p = 0.8 - (t - 9.5) / 14.5 * 1.6, f0 = 300 + r() * 60, dur = 0.16 + r() * 0.08, P = pan(p);
    const bp1 = biquad('bp', 950, 3), bp2 = biquad('bp', 2100, 4); let ph = 0;
    const amp = 0.05 * Math.sin(Math.PI * (t - 9.5) / 14.5);
    for (let k = 0; k < dur * SR; k++) {
      const u = k / (dur * SR), f = f0 * (1 + 0.25 * Math.sin(Math.PI * u) - 0.1 * u);
      ph += TAU * f / SR; const saw = (ph / Math.PI) % 2 - 1;
      const v = (bp1(saw) + 0.6 * bp2(saw)) * Math.sin(Math.PI * u) * amp;
      add(Math.floor(t * SR) + k, v * P[0], v * P[1], 0.5);
    }
  }
}
// the windpump: a stick-slip creak once per turn of the rotor (2.3 rad/s), loudest as we pass it
{
  const near = auto([[14, 0], [19, 0.5], [22, 1], [25, 0.4], [28, 0]]);
  const period = TAU / 2.3;
  for (let t = 14 + 0.6; t < 28; t += period) {
    const a = near(t) * 0.09; if (a <= 0) continue;
    const bp1 = biquad('bp', 1150, 9), bp2 = biquad('bp', 2350, 11), P = pan(-0.45), dur = 0.42; let next = 0;
    for (let k = 0; k < dur * SR; k++) {
      const u = k / (dur * SR), rate = 70 + 60 * u;
      let x = 0; if (k >= next) { x = 1; next = k + SR / rate * (0.8 + rnd() * 0.4); }
      const v = (bp1(x) + 0.5 * bp2(x)) * Math.sin(Math.PI * u) * a * 6;
      add(Math.floor(t * SR) + k, v * P[0], v * P[1], 0.3);
    }
  }
}
// crickets as the sun goes down
{
  const level = auto([[52, 0], [58, 0.5], [63, 1], [66, 1]]);
  for (let c = 0; c < 7; c++) {
    const r = mulberry32(100 + c), f = 4300 + r() * 700, P = pan(r() * 1.6 - 0.8), amp = 0.006 + r() * 0.008;
    for (let t = 52 + r() * 2; t < DUR; t += 0.55 + r() * 0.5) {
      const a = level(t) * amp; if (a <= 0) continue;
      const pulses = 3 + (r() * 3 | 0);
      for (let q = 0; q < pulses; q++) for (let k = 0; k < 0.018 * SR; k++) {
        const u = k / (0.018 * SR), v = Math.sin(TAU * f * k / SR) * Math.sin(Math.PI * u) * a;
        add(Math.floor((t + q * 0.034) * SR) + k, v * P[0], v * P[1], 0.4);
      }
    }
  }
}
// air rushing past as the camera cranes up for the reveal
{
  const swell = auto([[51, 0], [55, 0.6], [58.5, 1], [61, 0.3], [64, 0]]);
  let f = 300; const bpL = biquad('bp', 600, 0.8); let lp = 0;
  for (let i = 51 * SR; i < 64 * SR; i++) {
    const t = i / SR, a = swell(t) * 0.05; lp = 0.9 * lp + 0.1 * (rnd() * 2 - 1);
    const v = (bpL(rnd() * 2 - 1) * 0.7 + lp) * a;
    add(i, v, v * 0.95, 0.4);
  }
}

// the field replanting itself: the armies sink (53-55.5 s), puzzle #1 grows up (55.5-58 s)
{
  const env = auto([[52.6, 0], [53.6, 1], [55.2, 0.5], [55.8, 0.9], [57.6, 0.4], [58.6, 0]]);
  const crumble = auto([[52.8, 0], [53.5, 1], [55.3, 0.2], [55.7, 1], [57.8, 0.3], [58.5, 0]]);
  const lp = biquad('lp', 85, 0.9), lp2 = biquad('lp', 70, 0.9), bp = biquad('bp', 1400, 1.2);
  let b = 0;
  for (let i = Math.floor(52.6 * SR); i < 58.6 * SR; i++) {
    const t = i / SR; b = 0.995 * b + 0.05 * (rnd() * 2 - 1);
    const rumble = (lp(b) * 6 + lp2(rnd() * 2 - 1) * 0.6) * env(t) * 0.22;
    const grit = rnd() < 0.004 * crumble(t) ? (rnd() * 2 - 1) : 0;
    const dirt = bp(grit) * 0.9 * crumble(t);
    add(i, rumble + dirt * 0.8, rumble + dirt, 0.25);
  }
}

// ------------------------------------------------------------------ space: Freeverb-style hall
function reverb(input, spread) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(d => ({ buf: new Float32Array(Math.round((d + spread) * SR / 44100 * 1.6)), i: 0, f: 0 }));
  const aps = [556, 441, 341, 225].map(d => ({ buf: new Float32Array(Math.round((d + spread) * SR / 44100)), i: 0 }));
  const out = new Float32Array(N), fb = 0.86, damp = 0.35;
  for (let n = 0; n < N; n++) {
    const x = input[n] * 0.015; let y = 0;
    for (const c of combs) { const o = c.buf[c.i]; c.f = o * (1 - damp) + c.f * damp; c.buf[c.i] = x + c.f * fb; c.i = (c.i + 1) % c.buf.length; y += o; }
    for (const a of aps) { const o = a.buf[a.i]; a.buf[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.buf.length; y = o - y; }
    out[n] = y;
  }
  return out;
}
const wl = reverb(RL, 0), wr = reverb(RR, 23);
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh((L[i] + wl[i] * 1.0) * 1.4); R[i] = Math.tanh((R[i] + wr[i] * 1.0) * 1.4); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const gain = 0.89 / peak;

// ------------------------------------------------------------------ write WAV
fs.mkdirSync(OUT, { recursive: true });
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(clamp(L[i] * gain, -1, 1) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(clamp(R[i] * gain, -1, 1) * 32767), 46 + i * 4); }
fs.writeFileSync(path.join(OUT, 'sound.wav'), buf);
console.log(`wrote film/out/sound.wav (${DUR}s, peak gain ${gain.toFixed(2)})`);
