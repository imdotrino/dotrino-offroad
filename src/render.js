// Dibujo en pixel art, en PERSPECTIVA CABALLERA, como las máquinas de antes: lo ancho se
// dibuja tal cual, el fondo se aplasta y además se va hacia la derecha al alejarse, y cada
// punto sube según su altura. Así las vallas, los niveles y las rampas se ven con volumen. El terreno se pinta UNA vez por
// carrera y cada cuadro solo se le ponen encima las camionetas, las partículas y el premio.
// Nada de imágenes: todo sale de código.
import { W, H, rng, heightAt, RAMP_LEN } from './track.js';

const SHEAR = 0.2;             // cuánto se corre a la derecha cada unidad de fondo
export const SW = W + Math.ceil(SHEAR * H) + 1;    // tamaño de la pantalla (lienzo)
export const SH = 262;
const KY = 0.62;               // cuánto se aplasta el fondo
const KZ = 0.8;                // cuánto sube en pantalla una unidad de altura
const OFF = 40;                // margen de arriba, para lo que sobresale
const WALL_H = 5;

/** Del mundo (x, y, altura) a la fila de la pantalla. La columna es la misma x. */
export const screenY = (y, z) => y * KY - z * KZ + OFF;
/** Y la columna: la x, corrida según lo lejos que esté. */
export const screenX = (x, y) => x + SHEAR * (H - 1 - y);

export const PALETTES = {
  desert: { rock: [150, 132, 112], out: [216, 172, 104], out2: [202, 156, 90], track: [152, 106, 62], track2: [140, 96, 54],
    wallA: [222, 58, 48], wallB: [240, 240, 232], mud: [92, 62, 38], mudHi: [124, 90, 58], dust: '#d9b98a', deco: 'cactus' },
  forest: { rock: [122, 92, 60], out: [72, 130, 64], out2: [60, 114, 56], track: [130, 94, 58], track2: [116, 82, 50],
    wallA: [240, 200, 60], wallB: [58, 58, 68], mud: [70, 48, 30], mudHi: [100, 72, 48], dust: '#b89a70', deco: 'bush' },
  snow: { rock: [150, 190, 226], out: [228, 236, 246], out2: [208, 220, 236], track: [152, 154, 168], track2: [140, 142, 156],
    wallA: [58, 118, 222], wallB: [250, 250, 250], mud: [118, 170, 212], mudHi: [184, 218, 242], dust: '#ffffff', deco: 'pine' },
  volcano: { rock: [84, 66, 74], out: [46, 36, 50], out2: [58, 44, 60], track: [108, 90, 96], track2: [96, 78, 86],
    wallA: [250, 140, 40], wallB: [38, 32, 38], mud: [232, 92, 30], mudHi: [255, 196, 72], dust: '#9a8088', deco: 'rock' },
};

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Ruido suave (manchas) a la escala `s`: interpola el ruido de una rejilla. */
function blotch (x, y, s) {
  const gx = x / s, gy = y / s, x0 = Math.floor(gx), y0 = Math.floor(gy);
  let fx = gx - x0, fy = gy - y0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Adornos del terreno (fuera de la pista). Letras → color.
const DECO = {
  cactus: { rows: ['.g.', 'ggg', 'ggg', '.g.', '.g.'], colors: { g: '#3f8a4a' } },
  bush: { rows: ['.gg.', 'gGGg', 'gGGg', '.tt.'], colors: { g: '#2f6a34', G: '#3f8a44', t: '#5a3c22' } },
  pine: { rows: ['..g..', '.ggg.', '.gwg.', 'ggggg', '..t..'], colors: { g: '#2f6f52', w: '#f4f8fc', t: '#5a3c22' } },
  rock: { rows: ['.rr.', 'rRRr', 'rrrr'], colors: { r: '#6a5560', R: '#8c7480' } },
};

/** Pinta el terreno de una pista y devuelve el lienzo (W×H). */
export function paintTrack (track, regionKey) {
  const pal = PALETTES[regionKey] || PALETTES.desert;
  const cv = document.createElement('canvas');
  cv.width = SW; cv.height = SH;
  const ctx = cv.getContext('2d');
  // 1) Color de cada punto del MUNDO, visto desde arriba.
  const px = new Uint8ClampedArray(W * H * 4);
  const half = track.half;
  const set = (x, y, c, k = 1) => {
    const i = (y * W + x) * 4;
    px[i] = c[0] * k; px[i + 1] = c[1] * k; px[i + 2] = c[2] * k; px[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = track.field[y * W + x];
      const d = f - half;
      const n = hash(x, y), n2 = hash(x >> 1, y >> 1);
      if (d < -1) {
        let k = 1;
        if (d > -3) k = 0.86;                              // tierra apelmazada junto a la valla
        // Textura de tierra: manchas grandes, grano fino y piedritas.
        k *= 0.9 + 0.2 * blotch(x, y, 11) + 0.08 * (blotch(x + 40, y + 9, 4) - 0.5);
        if (n > 0.95) k *= 0.84; else if (n < 0.04) k *= 1.12;
        // Rodadas: surcos que siguen la pista, entrecortados.
        const fn = track.near[y * W + x], q = track.samples[Math.floor(fn) % track.n];
        const lat = -(x - q.x) * q.ty + (y - q.y) * q.tx;
        const rut = Math.sin(lat * 0.62 + blotch(fn * 4, 7, 26) * 5);
        if (rut > 0.9 && blotch(fn * 4, lat, 9) > 0.42) k *= 0.88; else if (rut < -0.94 && blotch(fn * 4 + 50, lat, 9) > 0.5) k *= 1.06;
        set(x, y, n2 < 0.5 ? pal.track : pal.track2, k);
      } else if (d < 1.5) {
        // Franjas a lo largo de la valla (no un ajedrezado suelto): siguen la pista.
        const block = Math.floor(track.near[y * W + x] * 4 / 7) & 1;
        set(x, y, block ? pal.wallA : pal.wallB, d >= 0.8 ? 0.85 : 1.06);
      } else {
        let k = 0.93 + 0.14 * blotch(x + 99, y + 31, 14);
        if (n > 0.975) k *= 1.1; else if (n < 0.03) k *= 0.9;
        set(x, y, n2 < 0.55 ? pal.out : pal.out2, k);
      }
    }
  }
  const mul = (x, y, k) => {
    const i = (y * W + x) * 4;
    px[i] = Math.min(255, px[i] * k); px[i + 1] = Math.min(255, px[i + 1] * k); px[i + 2] = Math.min(255, px[i + 2] * k);
  };
  // Recorre el rectángulo alrededor de una muestra en sus coordenadas locales (u a lo largo, v a lo ancho).
  const stripe = (s, fn) => {
    const r = half + 2;
    for (let y = Math.max(0, (s.y - r) | 0); y <= Math.min(H - 1, (s.y + r) | 0); y++) {
      for (let x = Math.max(0, (s.x - r) | 0); x <= Math.min(W - 1, (s.x + r) | 0); x++) {
        if (track.field[y * W + x] >= half - 1) continue;
        const dx = x - s.x, dy = y - s.y;
        const u = dx * s.tx + dy * s.ty, v = -dx * s.ty + dy * s.tx;
        if (Math.abs(v) < half) fn(x, y, u, v);
      }
    }
  };
  // Línea de salida: ajedrezada.
  stripe(track.samples[0], (x, y, u, v) => {
    if (u < -2 || u >= 2) return;
    const c = (Math.floor(u / 2) + Math.floor(v / 2)) & 1;
    set(x, y, c ? [245, 245, 245] : [24, 24, 28]);
  });
  // Lo que está en alto va un poco más claro, para que los niveles se distingan.
  for (let k = 0; k < W * H; k++) {
    if (track.field[k] >= half - 1) continue;
    const lv = track.level[Math.floor(track.near[k]) % track.n];
    if (lv > 0.5) mul(k % W, (k / W) | 0, 1 + Math.min(0.2, lv * 0.007));
  }
  // Rampas: un montículo de la misma tierra, que se lee desde cualquier lado: se aclara al
  // subir, la cresta va marcada y justo detrás queda la sombra de la caída.
  const n = track.n;
  for (let k = 0; k < W * H; k++) {
    if (track.field[k] >= half - 1) continue;
    for (const r of track.ramps) {
      const c = (r - track.near[k] + n) % n;                 // muestras que faltan para el borde
      const x = k % W, y = (k / W) | 0;
      if (c <= RAMP_LEN + 0.5) {
        const u = 1 - c / RAMP_LEN;
        mul(x, y, c < 0.55 ? 1.5 : 0.9 + 0.34 * u * u);
      } else if (n - c < 3.4) mul(x, y, 0.52 + 0.14 * (n - c));
    }
  }
  // Charcos
  for (const p of track.puddles) {
    for (let y = Math.max(0, (p.y - p.r) | 0); y <= Math.min(H - 1, (p.y + p.r + 1) | 0); y++) {
      for (let x = Math.max(0, (p.x - p.r) | 0); x <= Math.min(W - 1, (p.x + p.r + 1) | 0); x++) {
        if (track.field[y * W + x] >= half - 1) continue;
        const dx = x - p.x, dy = (y - p.y) * 1.25;
        const dd = Math.hypot(dx, dy) + (hash(x >> 1, y >> 1) - 0.5) * 1.6;
        if (dd > p.r) continue;
        const hi = dd < p.r * 0.55 && dx < 0 && dy < 0;
        set(x, y, hi ? pal.mudHi : pal.mud, dd > p.r - 1.2 ? 0.8 : 1);
      }
    }
  }

  // Rocas: se pintan en el suelo y se levantan al proyectar (como las vallas).
  const rise = new Float32Array(W * H);
  for (const r of track.rocks) {
    for (let y = Math.max(0, (r.y - r.r) | 0); y <= Math.min(H - 1, (r.y + r.r + 1) | 0); y++) {
      for (let x = Math.max(0, (r.x - r.r) | 0); x <= Math.min(W - 1, (r.x + r.r + 1) | 0); x++) {
        const dx = x - r.x, dy = y - r.y, dd = Math.hypot(dx, dy) / r.r;
        if (dd > 1) continue;
        rise[y * W + x] = 2 + 6 * Math.sqrt(1 - dd * dd);
        set(x, y, pal.rock, (dx + dy < -r.r * 0.3 ? 1.28 : dx + dy > r.r * 0.6 ? 0.7 : 1) * (hash(x, y) < 0.2 ? 0.86 : 1));
      }
    }
  }

  // Altura total de cada punto: el suelo más lo que tenga encima (valla o roca).
  const total = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = track.field[i] - half;
    total[i] = track.height[i] + (d >= -1 && d < 1.5 ? WALL_H : rise[i]);
  }
  // SOMBRAS ARROJADAS. La luz viene del noroeste y a media altura: un punto queda en sombra
  // si, mirando hacia la luz, algo sube más de lo que se aleja. Sirve igual para una valla,
  // una roca, el talud de un nivel o el borde de una rampa, y la sombra es tan larga como alto
  // es lo que la arroja. El borde va en penumbra.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let shade = 0;
      for (let k = 1; k <= 26 && x - k >= 0 && y - k >= 0; k++) {
        const over = total[i - k * W - k] - total[i] - k * 0.95;
        if (over > 0) { shade = Math.max(shade, Math.min(1, over / 2)); if (shade >= 1) break; }
      }
      if (shade) mul(x, y, 1 - 0.36 * shade);
    }
  }
  // Y un filo de luz en el canto de arriba de cada bloque.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (total[i] - total[i + W + 1] > 3 && total[i] - total[i - W - 1] < 1) mul(x, y, 1.13);
    }
  }

  // 2) Luz: lo que mira al noroeste se aclara y lo que le da la espalda se oscurece. Es lo
  //    que hace que una loma se lea como loma.
  const hg = track.height;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const k = 1 + Math.max(-0.42, Math.min(0.3, (hg[i - 1] - hg[i + 1]) * 0.12 + (hg[i - W] - hg[i + W]) * 0.22));
      if (k !== 1) mul(x, y, k);
    }
  }

  // 3) Proyección: fila a fila, del fondo al frente. Cada punto se dibuja como una columna
  //    desde su altura hasta el suelo, y lo que viene delante lo va tapando. Donde hay un
  //    corte (una valla, una roca, el borde de un nivel) la columna enseña su cara, más oscura;
  //    en una ladera se estira con el mismo color.
  const img = ctx.createImageData(SW, SH);
  const out = img.data;
  for (let r = 0; r < SH; r++) {
    for (let x = 0; x < SW; x++) {
      const o = (r * SW + x) * 4, c = hash(x >> 1, r >> 1) < 0.55 ? pal.out : pal.out2;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  // Graderías en la esquina de arriba a la izquierda, que la perspectiva deja libre.
  for (let r = 4; r < 124; r++) {
    const edge = Math.round(screenX(0, (r - OFF) / KY)) - 14 - Math.round((124 - r) * 0.1);
    for (let x = 0; x < edge; x++) {
      const o = (r * SW + x) * 4, step = (r + Math.round(x * 0.31)) % 7;
      let c = step < 2 ? [92, 96, 112] : [214, 218, 226];
      if (step >= 2 && hash(x, r) < 0.42) c = [[214, 70, 60], [60, 110, 200], [240, 200, 70], [70, 70, 80]][(hash(r, x) * 4) | 0];
      if (x > edge - 3) c = [60, 62, 74];
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    }
  }
  // De qué punto del mundo (su y) es cada píxel del terreno: con eso una valla o un nivel
  // que quedan delante tapan a la camioneta (drawRace).
  const depth = new Uint16Array(SW * SH);
  for (let y = 0; y < H; y++) {
    const shift = Math.round(screenX(0, y));
    const baseRow = Math.min(SH - 1, Math.round(screenY(y, 0)));
    for (let x = 0; x < W; x++) {
      const i = y * W + x, sx = x + shift;
      const top = Math.round(screenY(y, total[i]));
      const face = y < H - 1 ? total[i] - total[i + W] > 2.5 : total[i] > 2.5;
      // En mitad de un corte (el punto de detrás también cae) va todo oscuro: si no, cada fila
      // del corte pinta su filo claro y la cara sale a rayas.
      const mid = face && y > 0 && total[i - W] - total[i] > 2.5;
      for (let r = Math.max(0, top); r <= baseRow; r++) {
        const o = (r * SW + sx) * 4, k = face && (r > top || mid) ? 0.6 : 1;
        out[o] = px[i * 4] * k; out[o + 1] = px[i * 4 + 1] * k; out[o + 2] = px[i * 4 + 2] * k;
        depth[r * SW + sx] = y;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.depth = depth;

  // Adornos fuera de la pista
  const deco = DECO[pal.deco];
  const rand = rng(track.spec.seed ^ 0x51ed);
  const spots = [];
  for (let k = 0; k < 90; k++) {
    const x = 4 + Math.floor(rand() * (W - 10)), y = 8 + Math.floor(rand() * (H - 14));
    if (track.field[y * W + x] - half < 10) continue;
    spots.push([x, y]);
  }
  spots.sort((a, b) => a[1] - b[1]);      // los de atrás primero
  for (const [x, y] of spots) {
    const top = Math.round(screenY(y, hg[y * W + x])) - deco.rows.length;
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    const dx = Math.round(screenX(x, y)) - x;
    ctx.fillRect(dx + x + 1, top + deco.rows.length, deco.rows[0].length - 1, 1);
    deco.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === '.') continue;
        ctx.fillStyle = deco.colors[ch]; ctx.fillRect(dx + x + rx, top + ry, 1, 1);
      }
    });
  }
  return cv;
}

// ---------- Camionetas ----------
// Un modelo de cubitos (13 de largo × 7 de ancho × 6 de alto, mirando a +x) que se gira y se
// proyecta con la misma perspectiva que el terreno: así cada ángulo enseña el costado que toca.
// k rueda, B carrocería, D fondo de la caja, w cristal, h techo, l faro.
function truckModel () {
  const v = [];
  const add = (x, y, z, c) => v.push({ x, y, z, c });
  for (const x0 of [1, 9]) for (let dx = 0; dx < 3; dx++) for (let z = 0; z < 3; z++) {
    if (dx !== 1 && z !== 1) continue;                  // rueda redondeada
    add(x0 + dx, 0, z, 'k'); add(x0 + dx, 6, z, 'k');
  }
  for (let x = 0; x <= 12; x++) for (let y = 1; y <= 5; y++) {
    add(x, y, 1, 'B');
    add(x, y, 2, x >= 1 && x <= 3 && y >= 2 && y <= 4 ? 'D' : (x === 12 && (y === 1 || y === 5) ? 'l' : 'B'));
    const rim = y === 1 || y === 5;
    if (x <= 4) { if (rim || x === 0 || x === 4) add(x, y, 3, 'B'); }           // caja
    else if (x <= 8) {                                                           // cabina
      add(x, y, 3, 'B');
      add(x, y, 4, rim || x === 5 || x === 8 ? 'w' : 'B');
      add(x, y, 5, 'h');
    } else add(x, y, 3, 'B');                                                    // capó
  }
  return v;
}
const MODEL = truckModel();
export const TRUCK_COLORS = {
  red: { B: '#e23b30', D: '#7c1710', h: '#ff8a7a' },
  blue: { B: '#2f7be0', D: '#143c78', h: '#8cc0ff' },
  yellow: { B: '#f2c21c', D: '#8a6606', h: '#fff0a0' },
  white: { B: '#e9edf2', D: '#7d8590', h: '#ffffff' },
  black: { B: '#3a3540', D: '#15121a', h: '#8a8296' },
};
export const FRAMES = 32;
const TS = 2;        // escala de la camioneta respecto al modelo de cubitos
const SP = 46;        // lado del cuadro de cada sprite
const AY = 29;        // fila del cuadro donde pisa el centro de la camioneta

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
};

function truckFrames (color) {
  const base = { ...TRUCK_COLORS[color], k: '#1b1b20', w: '#9fd8ff', l: '#fff6b0' };
  const top = {}, side = {};
  for (const key of Object.keys(base)) { top[key] = base[key]; side[key] = shade(base[key], 0.66); }
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const cv = document.createElement('canvas');
    cv.width = SP; cv.height = SP;
    const ctx = cv.getContext('2d');
    const a = (f / FRAMES) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    // Cada cubito se parte en cuatro para no dejar huecos al girar.
    const dots = [];
    for (const vx of MODEL) {
      for (const ox of [0.13, 0.38, 0.63, 0.88]) for (const oy of [0.13, 0.38, 0.63, 0.88]) for (const oz of [0.5, 1]) {
        const lx = (vx.x + ox - 6.5) * TS, ly = (vx.y + oy - 3.5) * TS;
        dots.push({ rx: lx * ca - ly * sa, ry: lx * sa + ly * ca, z: (vx.z + oz) * TS - 1, c: vx.c });
      }
    }
    dots.sort((p, q) => (p.ry - q.ry) || (p.z - q.z));     // del fondo al frente, de abajo arriba
    // `dy`: a qué distancia del centro (hacia el frente) está lo pintado en cada píxel.
    const dy = new Float32Array(SP * SP);
    for (const d of dots) {
      const x = Math.round(SP / 2 + d.rx - d.ry * SHEAR - 0.5), y = Math.round(AY + d.ry * KY - (d.z + 1) * KZ);
      ctx.fillStyle = side[d.c]; ctx.fillRect(x, y + 1, 1, 1);
      ctx.fillStyle = top[d.c]; ctx.fillRect(x, y, 1, 1);
      if (x >= 0 && x < SP && y >= 0 && y + 1 < SP) { dy[y * SP + x] = d.ry; dy[(y + 1) * SP + x] = d.ry; }
    }
    cv.pixels = ctx.getImageData(0, 0, SP, SP).data;
    cv.dy = dy;
    frames.push(cv);
  }
  return frames;
}

export function makeSprites () {
  const out = {};
  out.scratch = document.createElement('canvas');
  out.scratch.width = SP; out.scratch.height = SP;
  for (const color of Object.keys(TRUCK_COLORS)) out[color] = truckFrames(color);
  // Sombra: la huella de la camioneta en el suelo, por ángulo.
  out.shadow = [];
  for (let f = 0; f < FRAMES; f++) {
    const cv = document.createElement('canvas');
    cv.width = SP; cv.height = SP;
    const ctx = cv.getContext('2d');
    const a = (f / FRAMES) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    for (let lx = -7 * TS; lx <= 7 * TS; lx += 0.5) for (let ly = -4 * TS; ly <= 4 * TS; ly += 0.5) {
      ctx.clearRect(Math.round(SP / 2 + lx * ca - ly * sa - (lx * sa + ly * ca) * SHEAR), Math.round(AY + (lx * sa + ly * ca) * KY), 1, 1);
      ctx.fillRect(Math.round(SP / 2 + lx * ca - ly * sa - (lx * sa + ly * ca) * SHEAR), Math.round(AY + (lx * sa + ly * ca) * KY), 1, 1);
    }
    out.shadow.push(cv);
  }
  return out;
}

/** Una camioneta sola (para el taller y el mapa), ampliada sin suavizar. */
export function truckIcon (sprites, color, scale = 4, frame = 0) {
  const cv = document.createElement('canvas');
  cv.width = SP * scale; cv.height = SP * scale;
  cv.className = 'truck-icon';
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprites[color][frame], 0, 0, SP * scale, SP * scale);
  return cv;
}

const PICKUP = {
  nitro: { rows: ['.ww.', 'rrrr', 'rNNr', 'rNNr', 'rrrr'], colors: { w: '#e8e8e8', r: '#d8362c', N: '#ffe070' } },
  cash: { rows: ['.gg.', 'gGGg', 'gYYg', 'gGGg', '.gg.'], colors: { g: '#1f7a3a', G: '#35b05a', Y: '#ffe070' } },
};

/** Dibuja un cuadro de la carrera. `fx.parts` son las partículas (polvo, llama, barro). */
export function drawRace (ctx, bg, race, sprites, fx, t) {
  const track = race.track;
  const ground = (x, y) => heightAt(track, x, y);
  ctx.drawImage(bg, 0, 0);
  for (const p of fx.parts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    ctx.fillStyle = p.color;
    ctx.fillRect(screenX(p.x, p.y) | 0, screenY(p.y, ground(p.x, p.y) + p.z) | 0, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  const pk = race.pickup;
  if (pk && (pk.ttl > 2 || Math.floor(t * 8) % 2)) {
    const spr = PICKUP[pk.type];
    const base = Math.round(screenY(pk.y, ground(pk.x, pk.y)));
    const ox = Math.round(screenX(pk.x, pk.y)) - 2, oy = base - 6 + Math.round(Math.sin(t * 6));
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(ox, base, 4, 1);
    spr.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '.') continue;
        ctx.fillStyle = spr.colors[row[rx]]; ctx.fillRect(ox + rx, oy + ry, 1, 1);
      }
    });
  }
  const order = race.trucks.slice().sort((a, b) => a.y - b.y);     // las de atrás primero
  const frameOf = (tr) => ((Math.round(tr.a / (Math.PI * 2) * FRAMES) % FRAMES) + FRAMES) % FRAMES;
  const left = (tr) => Math.round(screenX(tr.x, tr.y) - SP / 2);
  for (const tr of order) {
    ctx.drawImage(sprites.shadow[frameOf(tr)], left(tr) + 1, Math.round(screenY(tr.y, ground(tr.x, tr.y))) - AY + 1);
  }
  // Cada camioneta se dibuja píxel a píxel contra el terreno: lo que tiene delante (una
  // valla, una loma, el borde de una rampa) la tapa.
  const sctx = sprites.scratch.getContext('2d');
  const tmp = sctx.createImageData(SP, SP);
  for (const tr of order) {
    const fr = sprites[tr.color][frameOf(tr)];
    const x0 = left(tr), y0 = Math.round(screenY(tr.y, ground(tr.x, tr.y) + tr.z)) - AY;
    tmp.data.set(fr.pixels);
    for (let py = 0; py < SP; py++) {
      const sy = y0 + py;
      if (sy < 0 || sy >= SH) continue;
      for (let pxl = 0; pxl < SP; pxl++) {
        const sx = x0 + pxl, k = py * SP + pxl;
        if (sx < 0 || sx >= SW || !fr.pixels[k * 4 + 3]) continue;
        if (bg.depth[sy * SW + sx] > tr.y + fr.dy[k] + 1.5) tmp.data[k * 4 + 3] = 0;
      }
    }
    sctx.putImageData(tmp, 0, 0);
    ctx.drawImage(sprites.scratch, x0, y0);
  }
  // Flecha sobre el jugador al arrancar, para que sepa cuál es la suya.
  const me = race.trucks[0];
  if ((race.state === 'countdown' || race.t < 2.5) && Math.floor(t * 5) % 2) {
    const ax = Math.round(screenX(me.x, me.y)), ay = Math.round(screenY(me.y, ground(me.x, me.y) + me.z)) - 31;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ax - 2, ay, 5, 1); ctx.fillRect(ax - 1, ay + 1, 3, 1); ctx.fillRect(ax, ay + 2, 1, 1);
  }
}

/** Partículas: polvo al rodar, llama del nitro y salpicadura del charco. */
export function emitParticles (race, fx, dust) {
  for (const tr of race.trucks) {
    const speed = Math.hypot(tr.vx, tr.vy);
    const bx = tr.x - Math.cos(tr.a) * 13, by = tr.y - Math.sin(tr.a) * 13;
    if (tr.nitroT > 0) {
      for (let i = 0; i < 2; i++) fx.parts.push({ x: bx + Math.random() * 3 - 1.5, y: by + Math.random() * 3 - 1.5, z: tr.z + 2, vz: 0, vx: -tr.vx * 0.2, vy: -tr.vy * 0.2, life: 0.22, max: 0.22, size: 2, color: Math.random() < 0.5 ? '#ffd040' : '#ff6a20' });
    } else if (!tr.air && speed > 25 && Math.random() < 0.35) {
      fx.parts.push({ x: bx + Math.random() * 4 - 2, y: by + Math.random() * 4 - 2, z: 0, vz: 5, vx: 0, vy: 0, life: 0.45, max: 0.45, size: Math.random() < 0.3 ? 2 : 1, color: tr.mud ? '#5a3c22' : dust });
    }
  }
  if (fx.parts.length > 260) fx.parts.splice(0, fx.parts.length - 260);
}

export function stepParticles (fx, dt) {
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.life <= 0) fx.parts.splice(i, 1);
  }
}
