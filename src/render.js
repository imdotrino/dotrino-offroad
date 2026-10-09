// Dibujo en pixel art, en PERSPECTIVA OBLICUA (la cámara mira la pista desde arriba y desde
// el sur): el mundo plano se aplasta en vertical y cada punto sube según su altura, así que
// las lomas, las cuestas y las vallas se ven con volumen. El terreno se pinta UNA vez por
// carrera y cada cuadro solo se le ponen encima las camionetas, las partículas y el premio.
// Nada de imágenes: todo sale de código.
import { W, H, rng, heightAt, RAMP_LEN } from './track.js';

export const SW = W;           // tamaño de la pantalla (lienzo)
export const SH = 240;
const KY = 0.64;               // cuánto se aplasta el fondo
const KZ = 0.8;                // cuánto sube en pantalla una unidad de altura
const OFF = 14;                // margen de arriba, para lo que sobresale
const WALL_H = 4;

/** Del mundo (x, y, altura) a la fila de la pantalla. La columna es la misma x. */
export const screenY = (y, z) => y * KY - z * KZ + OFF;

export const PALETTES = {
  desert: { out: [216, 172, 104], out2: [202, 156, 90], track: [152, 106, 62], track2: [140, 96, 54],
    wallA: [222, 58, 48], wallB: [240, 240, 232], mud: [92, 62, 38], mudHi: [124, 90, 58], dust: '#d9b98a', deco: 'cactus' },
  forest: { out: [72, 130, 64], out2: [60, 114, 56], track: [130, 94, 58], track2: [116, 82, 50],
    wallA: [240, 200, 60], wallB: [58, 58, 68], mud: [70, 48, 30], mudHi: [100, 72, 48], dust: '#b89a70', deco: 'bush' },
  snow: { out: [228, 236, 246], out2: [208, 220, 236], track: [152, 154, 168], track2: [140, 142, 156],
    wallA: [58, 118, 222], wallB: [250, 250, 250], mud: [118, 170, 212], mudHi: [184, 218, 242], dust: '#ffffff', deco: 'pine' },
  volcano: { out: [46, 36, 50], out2: [58, 44, 60], track: [108, 90, 96], track2: [96, 78, 86],
    wallA: [250, 140, 40], wallB: [38, 32, 38], mud: [232, 92, 30], mudHi: [255, 196, 72], dust: '#9a8088', deco: 'rock' },
};

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

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
        if (d > -3) k = 0.86;                              // sombra junto a la pared
        else if (Math.abs(f - 5) < 0.7) k = 0.93;          // rodadas
        if (n > 0.93) k *= 0.9;
        set(x, y, n2 < 0.5 ? pal.track : pal.track2, k);
      } else if (d < 3) {
        const block = ((x >> 2) + (y >> 2)) & 1;
        set(x, y, block ? pal.wallA : pal.wallB, d >= 2 ? 0.45 : d < 0 ? 1.08 : 0.92);
      } else {
        let k = d < 5.5 ? 0.82 : 1;
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
  // Rampas: tablones, para que se vean venir.
  const n = track.n;
  for (let k = 0; k < W * H; k++) {
    if (track.field[k] >= half - 1) continue;
    for (const r of track.ramps) {
      const c = (r - track.near[k] + n) % n;
      if (c > RAMP_LEN + 0.5) continue;
      const x = k % W, y = (k / W) | 0;
      const plank = Math.floor(c * 2) % 3 === 0;
      set(x, y, c < 0.6 ? [250, 214, 80] : [184, 134, 78], (plank ? 0.74 : 1) * (hash(x >> 1, y >> 1) < 0.5 ? 1 : 0.93));
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

  // 3) Proyección: columna a columna, del frente al fondo. Cada punto sube según su altura
  //    (el suelo, más la valla si la hay) y tapa lo que queda detrás; lo que sobresale deja
  //    ver su cara frontal, más oscura.
  const img = ctx.createImageData(SW, SH);
  const out = img.data;
  // De qué punto del mundo (su y) es cada píxel del terreno: con eso una valla o una loma
  // que quedan delante tapan a la camioneta (drawRace).
  const depth = new Uint16Array(SW * SH);
  for (let x = 0; x < W; x++) {
    let minY = SH;
    for (let y = H - 1; y >= 0 && minY > 0; y--) {
      const i = y * W + x;
      const d = track.field[i] - half;
      const wall = d >= -1 && d < 3;
      const sy = Math.round(screenY(y, hg[i] + (wall ? WALL_H : 0)));
      if (sy >= minY) continue;
      // Enseñan cara frontal la valla y los cortes (el borde de una rampa); una ladera se estira sin más.
      const tall = minY - sy > 1 && (wall || (y < H - 1 && hg[i] - hg[i + W] > 1.5));
      for (let r = Math.max(0, sy); r < minY; r++) {
        const o = (r * SW + x) * 4, k = tall && r > sy ? 0.62 : 1;
        out[o] = px[i * 4] * k; out[o + 1] = px[i * 4 + 1] * k; out[o + 2] = px[i * 4 + 2] * k; out[o + 3] = 255;
        depth[r * SW + x] = y;
      }
      minY = sy;
    }
    // Por encima del fondo del mundo: más terreno.
    for (let r = 0; r < minY; r++) {
      const o = (r * SW + x) * 4, c = hash(x >> 1, r >> 1) < 0.55 ? pal.out : pal.out2;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
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
    ctx.fillRect(x + 1, top + deco.rows.length, deco.rows[0].length - 1, 1);
    deco.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === '.') continue;
        ctx.fillStyle = deco.colors[ch]; ctx.fillRect(x + rx, top + ry, 1, 1);
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
const SP = 22;        // lado del cuadro de cada sprite
const AY = 14;        // fila del cuadro donde pisa el centro de la camioneta

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
      for (const ox of [0.25, 0.75]) for (const oy of [0.25, 0.75]) {
        const lx = vx.x + ox - 6.5, ly = vx.y + oy - 3.5;
        dots.push({ rx: lx * ca - ly * sa, ry: lx * sa + ly * ca, z: vx.z, c: vx.c });
      }
    }
    dots.sort((p, q) => (p.ry - q.ry) || (p.z - q.z));     // del fondo al frente, de abajo arriba
    // `dy`: a qué distancia del centro (hacia el frente) está lo pintado en cada píxel.
    const dy = new Float32Array(SP * SP);
    for (const d of dots) {
      const x = Math.round(SP / 2 + d.rx - 0.5), y = Math.round(AY + d.ry * KY - (d.z + 1) * KZ);
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
    for (let lx = -7; lx <= 7; lx += 0.5) for (let ly = -4; ly <= 4; ly += 0.5) {
      ctx.clearRect(Math.round(SP / 2 + lx * ca - ly * sa), Math.round(AY + (lx * sa + ly * ca) * KY), 1, 1);
      ctx.fillRect(Math.round(SP / 2 + lx * ca - ly * sa), Math.round(AY + (lx * sa + ly * ca) * KY), 1, 1);
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
    ctx.fillRect(p.x | 0, screenY(p.y, ground(p.x, p.y) + p.z) | 0, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  const pk = race.pickup;
  if (pk && (pk.ttl > 2 || Math.floor(t * 8) % 2)) {
    const spr = PICKUP[pk.type];
    const base = Math.round(screenY(pk.y, ground(pk.x, pk.y)));
    const ox = Math.round(pk.x) - 2, oy = base - 6 + Math.round(Math.sin(t * 6));
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
  const left = (tr) => Math.round(tr.x - SP / 2);
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
    const ax = Math.round(me.x), ay = Math.round(screenY(me.y, ground(me.x, me.y))) - 17;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ax - 2, ay, 5, 1); ctx.fillRect(ax - 1, ay + 1, 3, 1); ctx.fillRect(ax, ay + 2, 1, 1);
  }
}

/** Partículas: polvo al rodar, llama del nitro y salpicadura del charco. */
export function emitParticles (race, fx, dust) {
  for (const tr of race.trucks) {
    const speed = Math.hypot(tr.vx, tr.vy);
    const bx = tr.x - Math.cos(tr.a) * 6, by = tr.y - Math.sin(tr.a) * 6;
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
