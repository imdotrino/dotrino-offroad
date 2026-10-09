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
export const LEVEL_H = 15;     // alto de un piso
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
 * @param {{cross?:number, chicane?:number}} [opts]  probabilidad de cruce y de chicana (0..1)
 */
export function generateLayout (seed, size = 4, opts = {}) {
  const pCross = opts.cross ?? 0.45, pChicane = opts.chicane ?? 0.5;
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
  let poly = out, crossed = false, chicanes = 0;
  const axisOf = (a, b) => (Math.abs(a[1] - b[1]) < 1e-9 ? 0 : Math.abs(a[0] - b[0]) < 1e-9 ? 1 : -1);   // 0 horizontal, 1 vertical

  // CRUCE. Dos rectas enfrentadas (una va, la otra vuelve) con todo el hueco entre ellas dentro
  // del circuito: se cambian de lado por dos diagonales que se cortan en medio, y el tramo que
  // queda entre ambas se recorre al revés. Es el «ocho».
  if (rand() < pCross) {
    const found = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length], ax = axisOf(A, B);
      if (ax < 0 || B[ax] <= A[ax]) continue;                      // la primera va en sentido +
      for (let k = 0; k < poly.length; k++) {
        const C = poly[k], D = poly[(k + 1) % poly.length];
        if (k === i || axisOf(C, D) !== ax || D[ax] >= C[ax]) continue;     // la otra, en sentido −
        const ua = Math.max(A[ax], D[ax]), ub = Math.min(B[ax], C[ax]), v1 = A[1 - ax], v2 = C[1 - ax];
        // Separadas dos casillas o más: con una sola, los dos lazos quedan sin isleta y el
        // cruce se lee como una explanada.
        if (ub - ua < 1.9 || Math.abs(v1 - v2) < 1.9) continue;
        let inside = true;
        for (let u = Math.floor(ua + 1e-6); u < Math.ceil(ub - 1e-6); u++) {
          for (let v = Math.round(Math.min(v1, v2)); v < Math.round(Math.max(v1, v2)); v++) if (!has(ax ? v : u, ax ? u : v)) inside = false;
        }
        if (inside) found.push({ i, k, ax, ua, ub, v1, v2 });
      }
    }
    if (found.length) {
      const f = found[Math.floor(rand() * found.length)];
      const m2 = poly.length, rot = poly.slice(f.i).concat(poly.slice(0, f.i)), j = (f.k - f.i + m2) % m2;
      const span = f.ub - f.ua, du = Math.max(0.8, span * 0.34), u1 = f.ua + (span - du) / 2, u2 = u1 + du;
      const at = (u, v) => (f.ax ? [v, u] : [u, v]);
      poly = [rot[0], at(u1, f.v1), at(u2, f.v2), ...rot.slice(1, j + 1).reverse(), at(u2, f.v1), at(u1, f.v2), ...rot.slice(j + 1)];
      crossed = true;
    }
  }

  // La salida va en la recta más larga (nunca en una diagonal).
  let best = 0, bestLen = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    if (axisOf(poly[i], q) < 0) continue;
    const len = Math.hypot(q[0] - poly[i][0], q[1] - poly[i][1]) + rand() * 0.01;
    if (len > bestLen) { bestLen = len; best = i; }
  }
  poly = poly.slice(best).concat(poly.slice(0, best));

  // CHICANAS. En una recta larga, la pista se desvía a un lado y vuelve. Solo si el desvío
  // cabe: dentro de la cuadrícula y sin acercarse a ningún otro tramo.
  const PX = [(W - 104) / CELLS, (H - 108) / CELLS];             // una casilla, en px (ver FX/FY)
  const distSeg = (p, a, b) => {
    const vx = (b[0] - a[0]) * PX[0], vy = (b[1] - a[1]) * PX[1], wx = (p[0] - a[0]) * PX[0], wy = (p[1] - a[1]) * PX[1];
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(wx - vx * t, wy - vy * t);
  };
  for (let i = 1; i < poly.length && chicanes < 2; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length], ax = axisOf(A, B);
    const len = ax < 0 ? 0 : Math.abs(B[ax] - A[ax]);
    if (len < 1.8 || rand() >= pChicane) continue;
    const dir = Math.sign(B[ax] - A[ax]), mid = (A[ax] + B[ax]) / 2;
    for (const side of rand() < 0.5 ? [1, -1] : [-1, 1]) {
      const v = A[1 - ax] + side * 0.42;
      const pt = (u, w) => (ax ? [w, u] : [u, w]);
      const jog = [pt(mid - dir * 0.2, v), pt(mid + dir * 0.2, v)];
      let fits = v > 0.02 && v < CELLS - 0.02;
      for (let k = 0; fits && k < poly.length; k++) {
        if (k === i || k === (i + 1) % poly.length || k === (i + poly.length - 1) % poly.length) continue;
        if (jog.some(q => distSeg(q, poly[k], poly[(k + 1) % poly.length]) < 66)) fits = false;
      }
      if (!fits) continue;
      poly.splice(i + 1, 0, pt(mid - dir * 0.52, A[1 - ax]), jog[0], jog[1], pt(mid + dir * 0.52, A[1 - ax]));
      i += 4; chicanes++;
      break;
    }
  }
  const pts = poly.map(q => [q[0] / CELLS, q[1] / CELLS]);
  return Object.assign(pts, { crossed, chicanes });
}

// La pista en sí tiene las esquinas CUADRADAS (ver buildField). Esta curva es solo la de la
// trazada: el camino por el que se mide el avance y por el que conduce la máquina.
const CORNER_R = 30;

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

/**
 * Distancia de un punto a un segmento, medida según el ESTILO de esquina:
 *   0 redonda  → distancia normal (la franja dobla en arco)
 *   1 a 45°    → «de octógono»: la mayor entre lo que se aleja en x, en y y en diagonal
 * En una recta horizontal o vertical las dos dan lo mismo, así que cambiar de estilo a media
 * recta no deja costura. `cap`: si ya se sabe que no baja de ahí, se deja.
 */
const OCT = Math.SQRT1_2;
function segDist (px, py, a, b, cap, style) {
  // Cota rápida: lo que falta hasta la caja del segmento.
  const lx = Math.max(Math.min(a[0], b[0]) - px, px - Math.max(a[0], b[0]), 0);
  const ly = Math.max(Math.min(a[1], b[1]) - py, py - Math.max(a[1], b[1]), 0);
  if (Math.max(lx, ly) >= cap) return cap;
  const ax = a[0] - px, ay = a[1] - py, bx = b[0] - a[0], by = b[1] - a[1];
  const g = (t) => {
    const u = Math.abs(ax + bx * t), v = Math.abs(ay + by * t);
    return style === 0 ? Math.hypot(u, v) : Math.max(u, v, (u + v) * OCT);
  };
  // g es convexa en t: búsqueda ternaria.
  let lo = 0, hi = 1;
  for (let k = 0; k < 16; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (g(m1) < g(m2)) hi = m2; else lo = m1;
  }
  return Math.min(cap, g((lo + hi) / 2));
}

/**
 * `field`: distancia de cada punto al POLÍGONO de la pista. Cada punto usa el estilo de la
 * esquina que tiene más cerca (`styles`), así que en una misma pista hay esquinas en arco y
 * cortadas a 45°. Los picos que queden los lima después `smoothCorners`. `near`: en qué punto de la trazada cae cada punto (muestra con decimales).
 */
function buildField (s, poly, styles) {
  const n = s.length, m = poly.length;
  const field = new Float32Array(W * H);
  const near = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let box = 1e9;
      let style = 0, vd = 1e9;
      for (let k = 0; k < m; k++) { const d = (poly[k][0] - x) ** 2 + (poly[k][1] - y) ** 2; if (d < vd) { vd = d; style = styles[k]; } }
      for (let k = 0; k < m; k++) box = segDist(x, y, poly[k], poly[(k + 1) % m], box, style);
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
      field[y * W + x] = box;
      near[y * W + x] = bn;
    }
  }
  return { field, near };
}

/** Distancia de cada punto al punto marcado más cercano (transformada exacta, dos pasadas 1D). */
function distanceTo (mask) {
  const INF = 1e12, out = new Float32Array(W * H);
  const size = Math.max(W, H), f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1);
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let p;
      do { const r = v[k]; p = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); } while (p <= z[k] && --k >= 0);
      k++; v[k] = q; z[k] = p; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; }
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = mask[y * W + x] ? 0 : INF;
    pass(H);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = out[y * W + x];
    pass(W);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

/**
 * NINGUNA ESQUINA PUNTIAGUDA. Las vallas siguen rectas y justo en cada esquina, por fuera y por
 * dentro, queda un arco pequeño. Se hace sobre la silueta de la pista: primero se le liman los
 * picos que salen y luego se le rellenan los que entran, con un disco de radio CORNER_ARC; de
 * paso desaparecen las isletas que eran poco más que una valla. Después `field` se rehace como
 * distancia a la valla resultante.
 */
const CORNER_ARC = 9;
function smoothCorners (field) {
  const N = W * H, r = CORNER_ARC;
  const grow = (mask, by) => { const d = distanceTo(mask), o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = d[i] <= by ? 1 : 0; return o; };
  const not = (mask) => { const o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = mask[i] ? 0 : 1; return o; };
  const shrink = (mask, by) => not(grow(not(mask), by));
  let track = new Uint8Array(N);
  for (let i = 0; i < N; i++) track[i] = field[i] < HALF ? 1 : 0;
  // El borde del mundo cuenta como «fuera».
  for (let x = 0; x < W; x++) { track[x] = 0; track[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { track[y * W] = 0; track[y * W + W - 1] = 0; }
  track = grow(shrink(track, r), r);          // lima los picos que salen
  track = shrink(grow(track, r), r);          // rellena los picos que entran
  const inside = distanceTo(not(track)), outside = distanceTo(track);
  for (let i = 0; i < N; i++) field[i] = track[i] ? HALF - (inside[i] - 0.5) : HALF + (outside[i] - 0.5);
}

/**
 * Construye una pista.
 * @param {{layout?:number, size?:number, cross?:number, chicane?:number, reversed?:boolean, seed:number, bumps?:number, puddles?:number, hills?:number, ramps?:number, whoops?:number, mounds?:number, rocks?:number, maxLevel?:number}} spec
 */
export function buildTrack (spec) {
  // Con `layout`, uno de los trazados dibujados a mano; sin él, una pista por piezas de su semilla.
  const layout = spec.layout != null
    ? LAYOUTS[spec.layout % LAYOUTS.length]
    : { name: 'gen', pts: generateLayout(spec.seed, spec.size, { cross: spec.cross, chicane: spec.chicane }) };
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
  // Estilo de cada esquina. Se sortea solo donde los dos lados que llegan son
  // horizontales o verticales; junto a una diagonal va en arco, que es la única medida que no
  // ensancha la diagonal.
  const styleRand = rng((spec.seed ^ 0xc0ffee) >>> 0);
  const straight = (a, b) => Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1;
  const corners = pts.map((p, k) => {
    const r = styleRand();
    if (!straight(pts[(k + pts.length - 1) % pts.length], p) || !straight(p, pts[(k + 1) % pts.length])) return 0;
    return r < 0.55 ? 0 : 1;                       // en arco o cortada a 45°; cuadrada, nunca
  });
  const { field, near } = buildField(samples, pts, corners);
  smoothCorners(field);
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
      if (best) ramps.push(best.i);          // sin recta larga: el tramo menos curvo que haya
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
    hills.push({ i, h: 7 + rand() * 3, s: 8 + rand() * 3 });   // bajas: una loma alta tapa la valla de detrás
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
  // NIVELES POR MÓDULOS. Cada esquina del trazado es un módulo a una altura (0, 1 o 2 pisos) y
  // cada recta une dos: si están al mismo piso es llana; si no, una RAMPA empinada a media
  // recta o, al bajar, un CORTE del que se cae volando. La pista queda hecha de bloques que
  // encajan, con su talud vertical por fuera.
  const m = pts.length, maxLevel = spec.maxLevel ?? 2;
  const vIdx = pts.map(p => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.hypot(samples[i].x - p[0], samples[i].y - p[1]); if (d < bd) { bd = d; b = i; } } return b; });
  const elen = (k) => Math.hypot(pts[(k + 1) % m][0] - pts[k][0], pts[(k + 1) % m][1] - pts[k][1]);
  const lv = new Array(m).fill(0), pinned = new Array(m).fill(false);
  pinned[0] = pinned[1] = true;                                  // la recta de salida, a nivel del suelo
  for (let k = 0; k < m; k++) {                                  // y las diagonales de un cruce
    const a = pts[k], b = pts[(k + 1) % m];
    if (Math.abs(a[0] - b[0]) > 1 && Math.abs(a[1] - b[1]) > 1 && elen(k) > 100) pinned[k] = pinned[(k + 1) % m] = true;
  }
  for (let k = 2; k < m; k++) {
    let L = lv[k - 1];
    if (!pinned[k] && elen(k - 1) >= 58) {
      const r = rand();
      if (r < 0.42 && L < maxLevel) L++; else if (r < 0.74 && L > 0) L -= rand() < 0.35 && L > 1 ? 2 : 1;
    }
    lv[k] = pinned[k] ? 0 : L;
  }
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 0; k < m; k++) {
      const a = k, b = (k + 1) % m;
      // Una recta corta no da para cambiar de piso, y de subida solo se sube un piso por recta.
      if (elen(k) < 58 && lv[a] !== lv[b]) { if (!pinned[b]) lv[b] = lv[a]; else if (!pinned[a]) lv[a] = lv[b]; }
      if (lv[b] - lv[a] > 1) { if (!pinned[b]) lv[b] = lv[a] + 1; else if (!pinned[a]) lv[a] = lv[b] - 1; }
    }
  }
  const sm = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); };
  const level = new Float32Array(n);
  const drops = [];
  for (let k = 0; k < m; k++) {
    const a = lv[k], b = lv[(k + 1) % m], sA = vIdx[k], span = (vIdx[(k + 1) % m] - sA + n) % n;
    const drop = b < a && (b < a - 1 || rand() < 0.55);
    const rl = Math.max(6, Math.min(13, span * 0.4)) / Math.max(1, span);       // la rampa, en fracción de recta
    if (drop) drops.push((sA + Math.floor(span / 2)) % n);
    for (let q = 0; q <= span; q++) {
      const t = q / Math.max(1, span);
      level[(sA + q) % n] = LEVEL_H * (a === b ? a : drop ? (t < 0.5 ? a : b) : a + (b - a) * sm((t - 0.5 + rl / 2) / rl));
    }
  }
  const levels = lv;

  const height = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const d = field[k] - HALF;
    if (d < 5) {                                    // el módulo sube entero, con su valla; por fuera, talud vertical
      const f = near[k], i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
      height[k] = level[i0] + (level[i1] - level[i0]) * t;
    }
    // El relieve es de la pista y muere antes de llegar a la valla: así las vallas quedan
    // rectas y a nivel, y el terreno de fuera, limpio.
    let fall = Math.max(0, Math.min(1, (-d - 2) / 9));
    fall = fall * fall * (3 - 2 * fall);
    if (!fall) continue;
    const base = height[k];
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
    height[k] = base + hk * fall;
  }
  // Suavizado: en el interior de una curva muchos puntos caen en muestras distintas y la
  // altura sale a rayas; dos pasadas de promedio las borran.
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 1; pass++) {
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
    // En recta: en plena curva o en un cruce una roca es una trampa, no un obstáculo.
    if (nearCross(i, 14) || onRamp(i, 4) || samples[i].curv > 0.3 || samples[(i + n - 8) % n].curv > 0.3) continue;
    const q = samples[i], lat = (rand() < 0.5 ? -1 : 1) * (6 + rand() * 22);
    const r = { x: q.x - q.ty * lat, y: q.y + q.tx * lat, r: 4.5 + rand() * 1.5, i, lat };
    if (field[Math.round(r.y) * W + Math.round(r.x)] > HALF - r.r - 4) continue;       // pegada a la valla no
    if (rocks.some(o => Math.hypot(o.x - r.x, o.y - r.y) < 44) || puddles.some(o => Math.hypot(o.x - r.x, o.y - r.y) < o.r + 12)) continue;
    rocks.push(r);
  }

  return { spec, name: layout.name, samples, n, field, near, height, bumps, ramps, hills, puddles, whoops, mounds, rocks, levels, level, drops, corners, half: HALF,
    crossed: !!(/** @type {any} */ (layout.pts)).crossed, chicanes: (/** @type {any} */ (layout.pts)).chicanes || 0 };
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
