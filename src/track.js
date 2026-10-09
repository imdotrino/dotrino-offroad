// Pistas: lógica PURA (sin DOM), para que la simulación corra también en Node (tests/sim.mjs).
// Una pista es un circuito cerrado: puntos de control → spline → muestras cada ~4 px, más un
// campo de distancias al eje (para las paredes) y sus obstáculos (lomas y charcos).
// Todo sale de una semilla: el mismo nivel es la misma pista para todos (§12.1).

// El MUNDO es un plano (x, y) con una altura por punto. La pantalla lo ve en perspectiva
// oblicua (render.js): por eso el mundo es más alto que la pantalla, que lo aplasta al dibujar.
export const W = 384;
export const H = 354;
export const HALF = 38;        // medio ancho de la pista: MUY ancha, seis camionetas a la par
export const RAMP_LEN = 10;    // largo de una rampa, en muestras
export const RAMP_H = 15;      // alto del borde de una rampa
const STEP = 4;                // separación entre muestras del eje
const FX = 52, FY = 54, FW = W - 104, FH = H - 108;   // área útil para los puntos de control

// Trazados dibujados a mano en el cuadro unidad. El primer tramo (p0→p1) es SIEMPRE una
// recta: ahí va la salida.
export const LAYOUTS = [
  { name: 'bean', pts: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.76, 1], [0.5, 0.62], [0.24, 1], [0, 1], [0, 0.5]] },
  { name: 'eight', pts: [[1, 1], [1, 0.5], [1, 0], [0.64, 0], [0.36, 1], [0, 1], [0, 0.5], [0, 0], [0.36, 0], [0.64, 1]] },
  { name: 'comb', pts: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.67, 1], [0.67, 0.5], [0.33, 0.5], [0.33, 1], [0, 1], [0, 0.5]] },
  { name: 'hammer', pts: [[0, 0], [0.5, 0], [1, 0], [1, 0.42], [0.72, 0.46], [0.72, 1], [0.28, 1], [0.28, 0.46], [0, 0.42]] },
  { name: 'triangle', pts: [[0, 0], [0.5, 0], [1, 0], [0.76, 0.52], [0.5, 1], [0.24, 0.52]] },
  { name: 'hourglass', pts: [[0, 0], [0.5, 0], [1, 0], [1, 0.36], [0, 0.64], [0, 1], [0.5, 1], [1, 1], [1, 0.64], [0, 0.36]] },
  { name: 'oval', pts: [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]] },
  { name: 'boot', pts: [[0.75, 1], [0.25, 1], [0, 1], [0, 0.5], [0, 0], [0.26, 0], [0.52, 0], [0.52, 0.5], [1, 0.5], [1, 1]] },
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

/** Distancia de cada píxel al eje (`field`) y en qué punto del eje cae (`near`, muestra con decimales). */
function buildField (s) {
  const n = s.length;
  const field = new Float32Array(W * H);
  const near = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 1e9, bn = 0;
      for (let i = 0; i < n; i++) {
        const a = s[i], b = s[(i + 1) % n];
        const vx = b.x - a.x, vy = b.y - a.y;
        const wx = x - a.x, wy = y - a.y;
        let t = (wx * vx + wy * vy) / (vx * vx + vy * vy);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = wx - vx * t, dy = wy - vy * t;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bn = i + t; }
      }
      field[y * W + x] = Math.sqrt(best);
      near[y * W + x] = bn;
    }
  }
  return { field, near };
}

/**
 * Construye una pista.
 * @param {{layout:number, reversed?:boolean, seed:number, bumps?:number, puddles?:number, hills?:number, ramps?:number}} spec
 */
export function buildTrack (spec) {
  const layout = LAYOUTS[spec.layout % LAYOUTS.length];
  let pts = layout.pts.map(p => [FX + p[0] * FW, FY + p[1] * FH]);
  // Al revés: mismo trazado en sentido contrario, conservando p0→p1 como recta de salida.
  if (spec.reversed) pts = [pts[1], pts[0]].concat(pts.slice(2).reverse());
  const samples = sampleLoop(pts);
  // La curva suavizada se abomba un poco hacia afuera en las esquinas: se recorta para que la
  // pista entera, con su valla, quepa en el mundo.
  const M = HALF + 5;
  for (const q of samples) { q.x = Math.max(M, Math.min(W - M, q.x)); q.y = Math.max(M, Math.min(H - M, q.y)); }
  finishSamples(samples);
  const n = samples.length;
  const { field, near } = buildField(samples);
  const rand = rng(spec.seed);

  // Lomas: en tramos rectos, lejos de la salida y separadas entre sí.
  const circ = (a, b) => Math.min(Math.abs(a - b), n - Math.abs(a - b));
  // Cruces (el ocho, la espiral): ahí el suelo es de dos tramos a la vez, así que va plano.
  const cross = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 17; j < n; j++) {
      if (circ(i, j) > 16 && Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y) < HALF * 1.3) { cross.push(i, j); }
    }
  }
  const nearCross = (i, m) => cross.some(c => circ(c, i) < m);
  // Rampas: una subida larga que acaba en un borde cortado, en plena recta. A velocidad, la
  // camioneta sale volando y cae bastante más allá (la física del salto está en sim.js).
  const ramps = [];
  const wantRamps = spec.ramps ?? 1;
  // Se puntúa cada sitio posible por lo recto que es su tramo (la subida y la caída) y se
  // elige al azar entre los rectos; si el trazado no tiene ninguno, vale el menos curvo.
  const spots = [];
  for (let i = RAMP_LEN + 4; i < n - 30; i++) {
    if (nearCross(i, 24)) continue;
    let worst = 0;
    for (let o = -RAMP_LEN - 2; o <= 16; o++) worst = Math.max(worst, samples[(i + o + n) % n].curv);
    spots.push({ i, worst });
  }
  for (let k = 0; k < wantRamps; k++) {
    const free = spots.filter(q => !ramps.some(r => circ(r, q.i) < 50));
    const good = free.filter(q => q.worst < 0.38);
    if (good.length) ramps.push(good[Math.floor(rand() * good.length)].i);
    else {
      const best = free.sort((a, b) => a.worst - b.worst)[0];
      if (best && best.worst < 0.75) ramps.push(best.i);
    }
  }
  const onRamp = (i, m) => ramps.some(r => { const c = (r - i + n) % n; return c <= RAMP_LEN + m || n - c <= 22 + m; });

  const bumps = [];
  const wantBumps = spec.bumps ?? 3;
  for (let tries = 0; tries < 200 && bumps.length < wantBumps; tries++) {
    const i = 14 + Math.floor(rand() * (n - 28));
    if (samples[i].curv > 0.25 || nearCross(i, 6) || onRamp(i, 8)) continue;
    if (bumps.some(b => circ(b, i) < 18)) continue;
    bumps.push(i);
  }
  bumps.sort((a, b) => a - b);

  // Cuestas: subidas largas y suaves. Frenan al subir y lanzan al bajar.
  const hills = [];
  const wantHills = spec.hills ?? 1;
  for (let tries = 0; tries < 200 && hills.length < wantHills; tries++) {
    const i = 20 + Math.floor(rand() * (n - 40));
    if (nearCross(i, 16) || onRamp(i, 14) || bumps.some(b => circ(b, i) < 14) || hills.some(q => circ(q.i, i) < 40)) continue;
    hills.push({ i, h: 13 + rand() * 6, s: 8 + rand() * 3 });
  }

  // Perfil de alturas a lo largo del eje, y de ahí la altura de cada punto del mundo: la de
  // su tramo, que se va aplanando al alejarse de la pista.
  const elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const b of bumps) { const c = circ(b, i) / 1.4; e += 4.5 * Math.exp(-c * c / 2); }
    for (const r of ramps) {
      const c = (r - i + n) % n;                       // muestras que faltan para el borde
      if (c <= RAMP_LEN) { const u = 1 - c / RAMP_LEN; e += RAMP_H * u * u * (3 - 2 * u) * 0.35 + RAMP_H * u * 0.65; }
    }
    for (const q of hills) { const c = circ(q.i, i) / q.s; e += q.h * Math.exp(-c * c / 2); }
    elev[i] = e;
  }
  const height = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const d = field[k] - HALF;
    let fall = d < 3 ? 1 : Math.max(0, 1 - (d - 3) / 16);
    fall = fall * fall * (3 - 2 * fall);
    if (!fall) continue;
    const f = near[k], i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
    height[k] = (elev[i0] + (elev[i1] - elev[i0]) * t) * fall;
  }
  // Suavizado: en el interior de una curva muchos puntos caen en muestras distintas y la
  // altura sale a rayas; dos pasadas de promedio las borran.
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        tmp[k] = (height[k - W - 1] + height[k - W] + height[k - W + 1] + height[k - 1] + height[k] + height[k + 1] + height[k + W - 1] + height[k + W] + height[k + W + 1]) / 9;
      }
    }
    height.set(tmp);
  }

  // Charcos: círculos a un lado del eje (se pueden esquivar).
  const puddles = [];
  const wantPuddles = spec.puddles ?? 2;
  for (let tries = 0; tries < 200 && puddles.length < wantPuddles; tries++) {
    const i = 14 + Math.floor(rand() * (n - 28));
    if (bumps.some(b => circ(b, i) < 6) || onRamp(i, 4)) continue;
    const s = samples[i];
    const side = (rand() < 0.5 ? -1 : 1) * (6 + rand() * 20);
    const p = { x: s.x - s.ty * side, y: s.y + s.tx * side, r: 7 + rand() * 4, i };
    if (puddles.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 30)) continue;
    puddles.push(p);
  }

  return { spec, name: layout.name, samples, n, field, near, height, bumps, ramps, hills, puddles, half: HALF };
}

function sample (f, x, y, out) {
  if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return out;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i = y0 * W + x0;
  const a = f[i] + (f[i + 1] - f[i]) * fx;
  const b = f[i + W] + (f[i + W + 1] - f[i + W]) * fx;
  return a + (b - a) * fy;
}
/** Distancia al eje en un punto cualquiera (bilineal sobre el campo). Fuera del cuadro: lejos. */
export const distAt = (track, x, y) => sample(track.field, x, y, 999);
/** Altura del suelo en un punto cualquiera. */
export const heightAt = (track, x, y) => sample(track.height, x, y, 0);
