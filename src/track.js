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

// Trazados: POLÍGONOS en el cuadro unidad. Cada tramo es una recta de verdad y cada esquina
// un arco de círculo (roundedLoop), como una pista real. El primer lado (p0→p1) lleva la salida.
export const LAYOUTS = [
  { name: 'bean', pts: [[0, 0], [1, 0], [1, 1], [0.72, 1], [0.5, 0.6], [0.28, 1], [0, 1]] },
  { name: 'eight', pts: [[1, 1], [1, 0], [0.64, 0], [0.36, 1], [0, 1], [0, 0], [0.36, 0], [0.64, 1]] },
  { name: 'comb', pts: [[0, 0], [1, 0], [1, 1], [0.67, 1], [0.67, 0.5], [0.33, 0.5], [0.33, 1], [0, 1]] },
  { name: 'hammer', pts: [[0, 0], [1, 0], [1, 0.42], [0.72, 0.42], [0.72, 1], [0.28, 1], [0.28, 0.42], [0, 0.42]] },
  { name: 'triangle', pts: [[0, 0], [1, 0], [0.5, 1]] },
  { name: 'hourglass', pts: [[0, 0], [1, 0], [1, 0.36], [0, 0.64], [0, 1], [1, 1], [1, 0.64], [0, 0.36]] },
  { name: 'oval', pts: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { name: 'boot', pts: [[1, 1], [0, 1], [0, 0], [0.52, 0], [0.52, 0.5], [1, 0.5]] },
];
// ---------- Pistas por piezas ----------
// Una cuadrícula de 3×3 casillas. Se elige un grupo de casillas pegadas entre sí (crece desde
// una, casilla a casilla, según la semilla) y la pista es su CONTORNO: cada lado de casilla es
// una pieza recta y cada vértice una curva; algunas esquinas se cortan en diagonal. El paso de
// la cuadrícula es el ancho de la pista, así que dos tramos nunca se pisan.
const CELLS = 3;
/**
 * El polígono de una pista generada (en el cuadro unidad), con el lado más largo primero.
 * @param {number} seed
 * @param {number} [size]  cuántas casillas (3..7): más casillas, más curvas
 */
export function generateLayout (seed, size = 4) {
  const rand = rng((seed ^ 0x7f4a7c15) >>> 0);
  const key = (x, y) => y * CELLS + x;
  const want = Math.max(3, Math.min(7, Math.round(size)));
  const ok = (set) => {
    const has = (x, y) => x >= 0 && y >= 0 && x < CELLS && y < CELLS && set.has(key(x, y));
    // Sin hueco en medio y sin dos casillas que se toquen solo por la esquina: así el
    // contorno es UN circuito cerrado.
    if (!has(1, 1) && has(1, 0) && has(0, 1) && has(2, 1) && has(1, 2)) return false;
    for (let vy = 1; vy < CELLS; vy++) for (let vx = 1; vx < CELLS; vx++) {
      const a = has(vx - 1, vy - 1), b = has(vx, vy - 1), c = has(vx - 1, vy), d = has(vx, vy);
      if ((a && d && !b && !c) || (b && c && !a && !d)) return false;
    }
    return true;
  };
  const set = new Set([key(Math.floor(rand() * CELLS), Math.floor(rand() * CELLS))]);
  for (let tries = 0; tries < 200 && set.size < want; tries++) {
    const from = [...set][Math.floor(rand() * set.size)];
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rand() * 4)];
    const x = from % CELLS + dx, y = Math.floor(from / CELLS) + dy;
    if (x < 0 || y < 0 || x >= CELLS || y >= CELLS || set.has(key(x, y))) continue;
    set.add(key(x, y));
    if (!ok(set)) set.delete(key(x, y));
  }
  // Contorno, en el sentido de las agujas: de cada casilla, los lados que dan afuera.
  const has = (x, y) => x >= 0 && y >= 0 && x < CELLS && y < CELLS && set.has(key(x, y));
  const next = new Map();
  const edge = (x1, y1, x2, y2) => next.set(x1 + ',' + y1, [x2, y2]);
  for (const k of set) {
    const x = k % CELLS, y = Math.floor(k / CELLS);
    if (!has(x, y - 1)) edge(x, y, x + 1, y);
    if (!has(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) edge(x, y + 1, x, y);
  }
  const first = [...next.keys()].sort()[0];
  let loop = [], cur = first.split(',').map(Number);
  do { loop.push(cur); cur = next.get(cur[0] + ',' + cur[1]); } while (cur[0] + ',' + cur[1] !== first);
  // Fuera los vértices que quedan en medio de una recta.
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  loop = loop.filter((b, i) => turn(loop[(i + loop.length - 1) % loop.length], b, loop[(i + 1) % loop.length]) !== 0);
  // Esquinas en diagonal: solo las que giran hacia dentro del circuito (se alejan de los demás tramos).
  const m = loop.length, out = [];
  for (let i = 0; i < m; i++) {
    const a = loop[(i + m - 1) % m], b = loop[i], c = loop[(i + 1) % m];
    if (turn(a, b, c) > 0 && rand() < 0.4) {
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      out.push([b[0] - (b[0] - a[0]) / la * 0.4, b[1] - (b[1] - a[1]) / la * 0.4], [b[0] + (c[0] - b[0]) / lc * 0.4, b[1] + (c[1] - b[1]) / lc * 0.4]);
    } else out.push(b);
  }
  // La salida va en el lado más largo.
  let best = 0, bestLen = 0;
  for (let i = 0; i < out.length; i++) {
    const q = out[(i + 1) % out.length], len = Math.hypot(q[0] - out[i][0], q[1] - out[i][1]) + rand() * 0.01;
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return out.slice(best).concat(out.slice(0, best)).map(q => [q[0] / CELLS, q[1] / CELLS]);
}

const CORNER_R = 60;           // radio de las curvas (se achica solo si el lado es corto)

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

/** El polígono con las esquinas redondeadas, como lista densa de puntos. Empieza a media recta del primer lado. */
function roundedLoop (pts) {
  const n = pts.length;
  const corners = pts.map((B, i) => {
    const A = pts[(i + n - 1) % n], C = pts[(i + 1) % n];
    const ul = Math.hypot(A[0] - B[0], A[1] - B[1]), vl = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const u = [(A[0] - B[0]) / ul, (A[1] - B[1]) / ul], v = [(C[0] - B[0]) / vl, (C[1] - B[1]) / vl];
    const th = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    if (th > Math.PI - 0.05) return { p1: B, p2: B, arc: null };
    const tan = Math.tan(th / 2);
    const t = Math.min(CORNER_R / tan, 0.47 * Math.min(ul, vl)), r = t * tan;
    const bl = Math.hypot(u[0] + v[0], u[1] + v[1]), cd = r / Math.sin(th / 2);
    return {
      p1: [B[0] + u[0] * t, B[1] + u[1] * t], p2: [B[0] + v[0] * t, B[1] + v[1] * t],
      arc: { c: [B[0] + (u[0] + v[0]) / bl * cd, B[1] + (u[1] + v[1]) / bl * cd], r },
    };
  });
  const out = [[(corners[0].p2[0] + corners[1].p1[0]) / 2, (corners[0].p2[1] + corners[1].p1[1]) / 2]];
  for (let k = 1; k <= n; k++) {
    const c = corners[k % n];
    out.push(c.p1);
    if (!c.arc) continue;
    const a1 = Math.atan2(c.p1[1] - c.arc.c[1], c.p1[0] - c.arc.c[0]);
    let d = Math.atan2(c.p2[1] - c.arc.c[1], c.p2[0] - c.arc.c[0]) - a1;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil(Math.abs(d) * c.arc.r / 2));
    for (let q = 1; q <= steps; q++) out.push([c.arc.c[0] + Math.cos(a1 + d * q / steps) * c.arc.r, c.arc.c[1] + Math.sin(a1 + d * q / steps) * c.arc.r]);
  }
  return out;
}

/** Muestras del eje, equiespaciadas por longitud de arco. La muestra 0 es la línea de salida. */
function sampleLoop (pts) {
  const loop = roundedLoop(pts);
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
 * @param {{layout?:number, size?:number, reversed?:boolean, seed:number, bumps?:number, puddles?:number, hills?:number, ramps?:number, whoops?:number, mounds?:number, rocks?:number}} spec
 */
export function buildTrack (spec) {
  // Con `layout`, uno de los trazados dibujados a mano; sin él, una pista por piezas de su semilla.
  const layout = spec.layout != null
    ? LAYOUTS[spec.layout % LAYOUTS.length]
    : { name: 'gen', pts: generateLayout(spec.seed, spec.size) };
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

  const straightAt = (i, len) => { for (let o = 0; o <= len; o++) if (samples[(i + o) % n].curv > 0.25) return false; return true; };
  // Ondulado: tres resaltos seguidos.
  const whoops = [];
  for (let tries = 0; tries < 300 && whoops.length < (spec.whoops ?? 1); tries++) {
    const i = 16 + Math.floor(rand() * (n - 44));
    if (!straightAt(i, 12) || nearCross(i, 12) || onRamp(i, 16) || bumps.some(b => circ(b, i) < 18) || hills.some(q => circ(q.i, i) < 16) || whoops.some(w => circ(w, i) < 30)) continue;
    whoops.push(i);
  }
  // Montículos: no ocupan todo el ancho; el que lo pisa salta, el que lo esquiva no.
  const mounds = [];
  for (let tries = 0; tries < 300 && mounds.length < (spec.mounds ?? 2); tries++) {
    const i = 16 + Math.floor(rand() * (n - 32));
    if (nearCross(i, 10) || onRamp(i, 10) || bumps.some(b => circ(b, i) < 8) || whoops.some(w => circ(w + 5, i) < 12) || mounds.some(m => circ(m.i, i) < 14)) continue;
    mounds.push({ i, lat: (rand() < 0.5 ? -1 : 1) * (8 + rand() * 18), h: 5 + rand() * 2 });
  }

  // Perfil de alturas a lo largo del eje, y de ahí la altura de cada punto del mundo: la de
  // su tramo, que se va aplanando al alejarse de la pista.
  const elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const b of bumps) { const c = circ(b, i) / 1.4; e += 4.5 * Math.exp(-c * c / 2); }
    for (const w of whoops) for (let k = 0; k < 3; k++) { const c = circ((w + k * 5) % n, i) / 1.1; e += 3.4 * Math.exp(-c * c / 2); }
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
    let hk = elev[i0] + (elev[i1] - elev[i0]) * t;
    if (d < 0 && mounds.length) {
      const q = samples[i0], x = k % W, y = (k / W) | 0;
      const lat = -(x - q.x) * q.ty + (y - q.y) * q.tx;
      for (const m of mounds) {
        let c = Math.abs(f - m.i); c = Math.min(c, n - c) / 1.7;
        const l = (lat - m.lat) / 8;
        hk += m.h * Math.exp(-(c * c + l * l) / 2);
      }
    }
    height[k] = hk * fall;
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

  // Rocas: obstáculos SÓLIDOS a un lado del eje. Se rodean (o se saltan desde una rampa).
  const rocks = [];
  for (let tries = 0; tries < 400 && rocks.length < (spec.rocks ?? 2); tries++) {
    const i = 18 + Math.floor(rand() * (n - 30));
    if (nearCross(i, 8) || onRamp(i, 4)) continue;
    const q = samples[i], lat = (rand() < 0.5 ? -1 : 1) * (6 + rand() * 22);
    const r = { x: q.x - q.ty * lat, y: q.y + q.tx * lat, r: 4.5 + rand() * 1.5, i, lat };
    if (rocks.some(o => Math.hypot(o.x - r.x, o.y - r.y) < 44) || puddles.some(o => Math.hypot(o.x - r.x, o.y - r.y) < o.r + 12)) continue;
    rocks.push(r);
  }

  return { spec, name: layout.name, samples, n, field, near, height, bumps, ramps, hills, puddles, whoops, mounds, rocks, half: HALF };
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
