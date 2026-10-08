// Pistas: lógica PURA (sin DOM), para que la simulación corra también en Node (tests/sim.mjs).
// Una pista es un circuito cerrado: puntos de control → spline → muestras cada ~4 px, más un
// campo de distancias al eje (para las paredes) y sus obstáculos (lomas y charcos).
// Todo sale de una semilla: el mismo nivel es la misma pista para todos (§12.1).

export const W = 384;          // resolución interna (pixel art, pista entera en pantalla)
export const H = 240;
export const HALF = 13;        // medio ancho de la pista, en px
const STEP = 4;                // separación entre muestras del eje
const FX = 26, FY = 28, FW = W - 52, FH = H - 52;   // área útil para los puntos de control

// Trazados dibujados a mano en el cuadro unidad. El primer tramo (p0→p1) es SIEMPRE una
// recta: ahí va la salida.
export const LAYOUTS = [
  { name: 'kidney', pts: [[0.1, 0.16], [0.5, 0.08], [0.9, 0.16], [0.92, 0.8], [0.64, 0.9], [0.5, 0.52], [0.36, 0.9], [0.08, 0.8]] },
  { name: 'eight', pts: [[0.9, 0.88], [0.9, 0.12], [0.62, 0.12], [0.38, 0.88], [0.1, 0.88], [0.1, 0.12], [0.38, 0.12], [0.62, 0.88]] },
  { name: 'snake', pts: [[0.08, 0.1], [0.92, 0.1], [0.92, 0.38], [0.3, 0.38], [0.3, 0.64], [0.92, 0.64], [0.92, 0.92], [0.08, 0.92]] },
  { name: 'crown', pts: [[0.08, 0.9], [0.08, 0.1], [0.32, 0.1], [0.5, 0.54], [0.68, 0.1], [0.92, 0.1], [0.92, 0.9], [0.5, 0.92]] },
  { name: 'peanut', pts: [[0.36, 0.28], [0.64, 0.28], [0.82, 0.1], [0.93, 0.5], [0.82, 0.9], [0.64, 0.72], [0.36, 0.72], [0.18, 0.9], [0.07, 0.5], [0.18, 0.1]] },
  { name: 'spiral', pts: [[0.06, 0.08], [0.94, 0.08], [0.94, 0.92], [0.3, 0.92], [0.3, 0.4], [0.7, 0.4], [0.7, 0.66], [0.06, 0.66]] },
  { name: 'boot', pts: [[0.08, 0.1], [0.55, 0.1], [0.55, 0.46], [0.92, 0.46], [0.92, 0.9], [0.08, 0.9]] },
  { name: 'hammer', pts: [[0.08, 0.1], [0.92, 0.1], [0.92, 0.42], [0.64, 0.42], [0.64, 0.9], [0.36, 0.9], [0.36, 0.42], [0.08, 0.42]] },
];

/** PRNG determinista (mulberry32). */
export function rng (seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmull (p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Muestras del eje, equiespaciadas por longitud de arco. La muestra 0 es la línea de salida. */
function sampleLoop (pts) {
  const n = pts.length;
  const fine = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      // La salida cae a media recta del primer tramo: el bucle arranca ahí.
      fine.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  const startAt = 20;   // mitad del tramo p0→p1
  const loop = fine.slice(startAt).concat(fine.slice(0, startAt));
  // Longitudes acumuladas
  const acc = [0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    acc.push(acc[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = acc[loop.length];
  const count = Math.round(total / STEP);
  const out = [];
  let j = 0;
  for (let s = 0; s < count; s++) {
    const d = (s / count) * total;
    while (acc[j + 1] < d) j++;
    const a = loop[j], b = loop[(j + 1) % loop.length];
    const f = (d - acc[j]) / ((acc[j + 1] - acc[j]) || 1);
    out.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, tx: 0, ty: 0, curv: 0 });
  }
  return out;
}

function finishSamples (s) {
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const a = s[(i + n - 1) % n], b = s[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    s[i].tx = dx / l; s[i].ty = dy / l;
  }
  // Curvatura: cuánto gira el eje en las ~10 muestras siguientes (la usa la máquina para frenar).
  for (let i = 0; i < n; i++) {
    const a = s[i], b = s[(i + 10) % n];
    s[i].curv = Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
  }
}

/** Distancia de cada píxel al eje de la pista (Float32Array W×H). */
function buildField (s) {
  const n = s.length;
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 1e9;
      for (let i = 0; i < n; i++) {
        const a = s[i], b = s[(i + 1) % n];
        const vx = b.x - a.x, vy = b.y - a.y;
        const wx = x - a.x, wy = y - a.y;
        let t = (wx * vx + wy * vy) / (vx * vx + vy * vy);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = wx - vx * t, dy = wy - vy * t;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      field[y * W + x] = Math.sqrt(best);
    }
  }
  return field;
}

/**
 * Construye una pista.
 * @param {{layout:number, reversed?:boolean, seed:number, bumps?:number, puddles?:number}} spec
 */
export function buildTrack (spec) {
  const layout = LAYOUTS[spec.layout % LAYOUTS.length];
  let pts = layout.pts.map(p => [FX + p[0] * FW, FY + p[1] * FH]);
  // Al revés: mismo trazado en sentido contrario, conservando p0→p1 como recta de salida.
  if (spec.reversed) pts = [pts[1], pts[0]].concat(pts.slice(2).reverse());
  const samples = sampleLoop(pts);
  finishSamples(samples);
  const n = samples.length;
  const field = buildField(samples);
  const rand = rng(spec.seed);

  // Lomas: en tramos rectos, lejos de la salida y separadas entre sí.
  const bumps = [];
  const wantBumps = spec.bumps ?? 3;
  for (let tries = 0; tries < 200 && bumps.length < wantBumps; tries++) {
    const i = 14 + Math.floor(rand() * (n - 28));
    if (samples[i].curv > 0.25) continue;
    if (bumps.some(b => Math.min(Math.abs(b - i), n - Math.abs(b - i)) < 18)) continue;
    bumps.push(i);
  }
  bumps.sort((a, b) => a - b);

  // Charcos: círculos a un lado del eje (se pueden esquivar).
  const puddles = [];
  const wantPuddles = spec.puddles ?? 2;
  for (let tries = 0; tries < 200 && puddles.length < wantPuddles; tries++) {
    const i = 14 + Math.floor(rand() * (n - 28));
    if (bumps.some(b => Math.min(Math.abs(b - i), n - Math.abs(b - i)) < 6)) continue;
    const s = samples[i];
    const side = (rand() < 0.5 ? -1 : 1) * (2 + rand() * 4);
    const p = { x: s.x - s.ty * side, y: s.y + s.tx * side, r: 5 + rand() * 2.5, i };
    if (puddles.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 30)) continue;
    puddles.push(p);
  }

  return { spec, name: layout.name, samples, n, field, bumps, puddles, half: HALF };
}

/** Distancia al eje en un punto cualquiera (bilineal sobre el campo). Fuera del cuadro: lejos. */
export function distAt (track, x, y) {
  if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return 999;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const f = track.field, i = y0 * W + x0;
  const a = f[i] + (f[i + 1] - f[i]) * fx;
  const b = f[i + W] + (f[i + W + 1] - f[i + W]) * fx;
  return a + (b - a) * fy;
}
