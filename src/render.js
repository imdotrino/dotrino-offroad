// Dibujo en pixel art. El terreno se pinta UNA vez por carrera en un lienzo aparte (píxel a
// píxel, desde el campo de distancias de la pista) y cada cuadro solo se le ponen encima las
// camionetas, las partículas y el premio. Nada de imágenes: todo sale de código.
import { W, H, rng } from './track.js';

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
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const px = img.data;
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
  // Lomas: cara clara y cara en sombra.
  for (const b of track.bumps) {
    stripe(track.samples[b], (x, y, u) => {
      if (u >= -4 && u < 0) mul(x, y, u < -3 ? 1.15 : 1.4); else if (u >= 0 && u < 3.5) mul(x, y, u < 2 ? 0.55 : 0.75);
    });
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
  ctx.putImageData(img, 0, 0);

  // Adornos fuera de la pista
  const deco = DECO[pal.deco];
  const rand = rng(track.spec.seed ^ 0x51ed);
  for (let k = 0; k < 70; k++) {
    const x = 4 + Math.floor(rand() * (W - 10)), y = 4 + Math.floor(rand() * (H - 10));
    if (track.field[y * W + x] - half < 9) continue;
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(x + 1, y + deco.rows.length, deco.rows[0].length - 1, 1);
    deco.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === '.') continue;
        ctx.fillStyle = deco.colors[ch]; ctx.fillRect(x + rx, y + ry, 1, 1);
      }
    });
  }
  return cv;
}

// ---------- Camionetas ----------
// Vista desde arriba, mirando a la derecha. k rueda, B carrocería, d caja, w parabrisas,
// h brillo, l faro.
const TRUCK = [
  '..kkk....kkk..',
  '..kkk....kkk..',
  '.dddddBBBBBBh.',
  '.dDDDdBwwBBBBl',
  '.dDDDdBwwBBBB.',
  '.dDDDdBwwBBBB.',
  '.dDDDdBwwBBBBl',
  '.dddddBBBBBBh.',
  '..kkk....kkk..',
  '..kkk....kkk..',
];
export const TRUCK_COLORS = {
  red: { B: '#e23b30', d: '#a82219', D: '#7c1710', h: '#ff8a7a' },
  blue: { B: '#2f7be0', d: '#1d55a6', D: '#143c78', h: '#8cc0ff' },
  yellow: { B: '#f2c21c', d: '#b98c0c', D: '#8a6606', h: '#fff0a0' },
  white: { B: '#e9edf2', d: '#aab2bd', D: '#7d8590', h: '#ffffff' },
  black: { B: '#3a3540', d: '#231f28', D: '#15121a', h: '#8a8296' },
};
export const FRAMES = 32;
const SP = 18;   // lado del cuadro de cada sprite

function truckFrames (color) {
  const c = { ...TRUCK_COLORS[color], k: '#17171b', w: '#9fd8ff', l: '#fff6b0' };
  const tw = TRUCK[0].length, th = TRUCK.length;
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const cv = document.createElement('canvas');
    cv.width = SP; cv.height = SP;
    const ctx = cv.getContext('2d');
    const a = (f / FRAMES) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < SP; y++) {
      for (let x = 0; x < SP; x++) {
        // Giro inverso: de cada píxel del cuadro al píxel del dibujo original.
        const dx = x + 0.5 - SP / 2, dy = y + 0.5 - SP / 2;
        const sx = Math.floor(dx * ca + dy * sa + tw / 2), sy = Math.floor(-dx * sa + dy * ca + th / 2);
        if (sx < 0 || sy < 0 || sx >= tw || sy >= th) continue;
        const ch = TRUCK[sy][sx];
        if (ch === '.') continue;
        ctx.fillStyle = c[ch]; ctx.fillRect(x, y, 1, 1);
      }
    }
    frames.push(cv);
  }
  return frames;
}

export function makeSprites () {
  const out = {};
  for (const color of Object.keys(TRUCK_COLORS)) out[color] = truckFrames(color);
  // Sombra: la silueta de un cuadro, en negro translúcido.
  out.shadow = out.black.map(fr => {
    const cv = document.createElement('canvas');
    cv.width = SP; cv.height = SP;
    const ctx = cv.getContext('2d');
    ctx.drawImage(fr, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(0, 0, SP, SP);
    return cv;
  });
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
  ctx.drawImage(bg, 0, 0);
  for (const p of fx.parts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  const pk = race.pickup;
  if (pk && (pk.ttl > 2 || Math.floor(t * 8) % 2)) {
    const spr = PICKUP[pk.type];
    const bob = Math.round(Math.sin(t * 6));
    const ox = Math.round(pk.x) - 2, oy = Math.round(pk.y) - 3 + bob;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(ox, Math.round(pk.y) + 3, 4, 1);
    spr.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '.') continue;
        ctx.fillStyle = spr.colors[row[rx]]; ctx.fillRect(ox + rx, oy + ry, 1, 1);
      }
    });
  }
  const order = race.trucks.slice().sort((a, b) => (a.y + a.z * 0.01) - (b.y + b.z * 0.01));
  const frameOf = (tr) => ((Math.round(tr.a / (Math.PI * 2) * FRAMES) % FRAMES) + FRAMES) % FRAMES;
  for (const tr of order) {
    ctx.drawImage(sprites.shadow[frameOf(tr)], Math.round(tr.x - SP / 2) + 1 + Math.round(tr.z * 0.3), Math.round(tr.y - SP / 2) + 2);
  }
  for (const tr of order) {
    ctx.drawImage(sprites[tr.color][frameOf(tr)], Math.round(tr.x - SP / 2), Math.round(tr.y - SP / 2 - tr.z));
  }
  // Flecha sobre el jugador al arrancar, para que sepa cuál es la suya.
  const me = race.trucks[0];
  if (race.state === 'countdown' || race.t < 2.5) {
    if (Math.floor(t * 5) % 2) {
      const ax = Math.round(me.x), ay = Math.round(me.y - 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ax - 2, ay, 5, 1); ctx.fillRect(ax - 1, ay + 1, 3, 1); ctx.fillRect(ax, ay + 2, 1, 1);
    }
  }
}

/** Partículas: polvo al rodar, llama del nitro y salpicadura del charco. */
export function emitParticles (race, fx, dust) {
  for (const tr of race.trucks) {
    const speed = Math.hypot(tr.vx, tr.vy);
    const bx = tr.x - Math.cos(tr.a) * 6, by = tr.y - Math.sin(tr.a) * 6;
    if (tr.nitroT > 0) {
      for (let i = 0; i < 2; i++) fx.parts.push({ x: bx + Math.random() * 3 - 1.5, y: by - tr.z + Math.random() * 3 - 1.5, vx: -tr.vx * 0.2, vy: -tr.vy * 0.2, life: 0.22, max: 0.22, size: 2, color: Math.random() < 0.5 ? '#ffd040' : '#ff6a20' });
    } else if (tr.z <= 0 && speed > 25 && Math.random() < 0.35) {
      fx.parts.push({ x: bx + Math.random() * 4 - 2, y: by + Math.random() * 4 - 2, vx: 0, vy: -3, life: 0.45, max: 0.45, size: Math.random() < 0.3 ? 2 : 1, color: tr.mud ? '#5a3c22' : dust });
    }
  }
  if (fx.parts.length > 260) fx.parts.splice(0, fx.parts.length - 260);
}

export function stepParticles (fx, dt) {
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0) fx.parts.splice(i, 1);
  }
}
