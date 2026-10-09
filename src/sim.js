// Simulación de la carrera: lógica PURA y determinista (sin DOM ni reloj). La pantalla
// (race.js) le pasa los mandos del jugador y dibuja el estado; tests/sim.mjs la corre sola.
import { rng, distAt, heightAt, W, H } from './track.js';

export const MAX_LEVEL = 6;
const TRUCK_R = 5;          // radio de choque de una camioneta contra las vallas
// Entre camionetas la caja de choque es la MITAD del dibujo: se meten una en otra al rozarse,
// pero el golpe se nota (rebote, chispas y sonido).
const CAR_R = 3.25;
const GRAVITY = 175;        // baja: los saltos son largos, como en las máquinas de antes
const LAUNCH = 1.6;         // cuánto exagera el despegue la subida que traía
const VZ_MAX = 72;
const NITRO_TIME = 0.75;
const TURN_RATE = 3.1;
const SLOPE = 55;            // cuánto frena una subida (y empuja una bajada)

/** Prestaciones de una camioneta según sus niveles de mejora (0..6, admite decimales). */
export function statsFor (up) {
  return {
    accel: 72 + up.accel * 12,
    top: 82 + up.speed * 8,
    grip: 8.5 + up.tires * 2,
    shocks: up.shocks,
    tires: up.tires,
  };
}

const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * @param {object} o
 * @param {object} o.track  pista de buildTrack()
 * @param {Array<{up:object, ai:boolean, skill?:number, nitro?:number, color?:string, boss?:boolean}>} o.trucks
 * @param {number} o.laps
 * @param {number} o.seed
 * @param {number} [o.grip]  factor de agarre del terreno (nieve < 1)
 */
export function createRace ({ track, trucks, laps, seed, grip = 1 }) {
  const rand = rng(seed ^ 0x9e3779b9);
  const n = track.n;
  // Parrilla: de dos en dos, detrás de la línea (muestra 0).
  const list = trucks.map((t, k) => {
    const back = 5 + Math.floor(k / 2) * 5;
    const i = (n - back) % n;
    const s = track.samples[i];
    const side = (k % 2 ? 1 : -1) * 8;
    return {
      k, ai: !!t.ai, color: t.color || 'red', boss: !!t.boss,
      stats: statsFor(t.up), skill: t.skill ?? 1,
      x: s.x - s.ty * side, y: s.y + s.tx * side,
      a: Math.atan2(s.ty, s.tx), vx: 0, vy: 0,
      // Altura: `g` suelo bajo la camioneta, `alt` la suya, `z` lo que vuela por encima.
      g: 0, alt: 0, z: 0, vz: 0, rate: 0, air: false, airT: 0, airMax: 0,
      idx: i, lap: -1, progress: i - n,
      nitro: t.nitro ?? 0, nitroT: 0, nitroHeld: false,
      mud: false, finished: false, finishT: 0, place: 0,
      cash: 0, lane: side * 0.6, laneT: 0, stuckT: 0, bestProgress: i - n,
      lapStart: 0, bestLap: 0,
    };
  });
  for (const tr of list) tr.g = tr.alt = heightAt(track, tr.x, tr.y);
  return {
    track, laps, grip, rand, trucks: list, t: 0, state: 'countdown', countdown: 3.2,
    finishedCount: 0, pickup: null, pickupT: 4 + rand() * 3, events: [], over: false,
  };
}

function aiControl (race, tr) {
  const { track, rand } = race;
  const n = track.n, s = track.samples;
  const speed = Math.hypot(tr.vx, tr.vy);
  const look = 4 + Math.floor(speed / 13);
  const tgt = s[(tr.idx + look) % n];
  // La máquina no va clavada al eje: cambia de carril cada tanto.
  tr.laneT -= 1 / 60;
  if (tr.laneT <= 0) { tr.lane = (rand() * 2 - 1) * 10; tr.laneT = 1.5 + rand() * 2.5; }
  const tx = tgt.x - tgt.ty * tr.lane, ty = tgt.y + tgt.tx * tr.lane;
  const diff = wrapAngle(Math.atan2(ty - tr.y, tx - tr.x) - tr.a);
  const steer = diff > 0.07 ? 1 : diff < -0.07 ? -1 : 0;
  // Frena si viene una curva cerrada y va rápido para ella: mira la más cerrada del tramo que viene.
  let curv = 0;
  for (let o = 2; o <= look + 6; o++) curv = Math.max(curv, s[(tr.idx + o) % n].curv);
  const limit = 52 + 78 * Math.max(0, 1 - curv / 1.2) + tr.stats.grip * 1.3;
  let gas = Math.abs(diff) < 1.1 || speed < 22;
  if (speed > limit) gas = false;
  const brake = speed > limit * 1.12;
  let nitro = false;
  if (tr.nitro > 0 && tr.nitroT <= 0 && !tr.air && Math.abs(diff) < 0.15 && curv < 0.2 && speed > 30 && rand() < 0.012) nitro = true;
  return { steer, gas, brake, nitro };
}

function stepTruck (race, tr, input, dt) {
  const { track } = race;
  const n = track.n, s = track.samples;
  const st = tr.stats;
  const air = tr.air;
  let speed = Math.hypot(tr.vx, tr.vy);

  // Nitro: un toque gasta una unidad.
  if (input.nitro && !tr.nitroHeld && tr.nitro > 0 && tr.nitroT <= 0 && !tr.finished) {
    tr.nitro--; tr.nitroT = NITRO_TIME;
    race.events.push({ type: 'nitro', k: tr.k });
  }
  tr.nitroHeld = !!input.nitro;
  if (tr.nitroT > 0) tr.nitroT -= dt;

  // Charcos
  tr.mud = false;
  if (!air) for (const p of track.puddles) { if (Math.hypot(tr.x - p.x, tr.y - p.y) < p.r) { tr.mud = true; break; } }

  const turn = TURN_RATE * (air ? 0.3 : 1) * (0.4 + 0.6 * Math.min(1, speed / 28));
  tr.a = wrapAngle(tr.a + input.steer * turn * dt);
  const fx = Math.cos(tr.a), fy = Math.sin(tr.a);
  let vf = tr.vx * fx + tr.vy * fy;
  let vl = -tr.vx * fy + tr.vy * fx;

  if (!air) {
    const boost = tr.nitroT > 0;
    let top = st.top * tr.skill * (boost ? 1.55 : 1);
    if (tr.mud) top *= Math.min(0.88, 0.5 + 0.06 * st.tires);
    const acc = st.accel * (boost ? 2.8 : 1);
    if (input.gas && !tr.finished) {
      if (vf < top) vf = Math.min(top, vf + acc * dt); else vf -= (vf - top) * 3 * dt;
    } else if (input.brake && !tr.finished) {
      // Freno; ya parada, marcha atrás (para salir de una pared).
      if (vf > 4) vf -= Math.min(vf, (90 + vf * 2) * dt); else vf = Math.max(-0.35 * st.top, vf - st.accel * 0.6 * dt);
    } else {
      vf -= vf * (tr.finished ? 2.6 : 1.5) * dt;
    }
    // Cuestas: la pendiente bajo la camioneta, en el sentido en que mira.
    vf -= (heightAt(track, tr.x + fx * 2, tr.y + fy * 2) - heightAt(track, tr.x - fx * 2, tr.y - fy * 2)) / 4 * SLOPE * dt;
    const grip = st.grip * race.grip * (tr.mud ? 0.6 : 1);
    vl *= Math.exp(-grip * dt);
  }
  tr.vx = fx * vf - fy * vl; tr.vy = fy * vf + fx * vl;
  tr.x += tr.vx * dt; tr.y += tr.vy * dt;

  // Paredes: el campo de distancias da cuánto se salió y hacia dónde empujar.
  const lim = track.half - TRUCK_R;
  const d = distAt(track, tr.x, tr.y);
  if (d > lim) {
    let gx = distAt(track, tr.x + 1, tr.y) - distAt(track, tr.x - 1, tr.y);
    let gy = distAt(track, tr.x, tr.y + 1) - distAt(track, tr.x, tr.y - 1);
    const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    tr.x -= gx * (d - lim); tr.y -= gy * (d - lim);
    const vn = tr.vx * gx + tr.vy * gy;
    if (vn > 0) {
      tr.vx -= gx * vn * 1.25; tr.vy -= gy * vn * 1.25;
      tr.vx *= 0.9; tr.vy *= 0.9;
      if (vn > 25) race.events.push({ type: 'hit', k: tr.k });
    }
  }
  tr.x = Math.max(2, Math.min(W - 3, tr.x)); tr.y = Math.max(2, Math.min(H - 3, tr.y));

  // Altura. En el suelo la camioneta lo sigue; despega cuando el suelo se le acaba de golpe
  // bajo las ruedas (el borde de una rampa, la cresta de una loma) y venía subiendo.
  const g = heightAt(track, tr.x, tr.y);
  if (!tr.air) {
    const rate = (g - tr.g) / dt;
    if (tr.rate > 10 && tr.rate - rate > 4.5 && speed > 30) {
      tr.air = true; tr.airT = 0;
      tr.alt = tr.g; tr.vz = Math.min(VZ_MAX, tr.rate * LAUNCH);
      race.events.push({ type: 'jump', k: tr.k });
    } else { tr.alt = g; tr.rate = rate; }
  }
  if (tr.air) {
    tr.vz -= GRAVITY * dt; tr.alt += tr.vz * dt; tr.airT += dt;
    if (tr.alt <= g) {
      tr.air = false; tr.alt = g; tr.rate = 0; tr.vz = 0;
      if (tr.airT > tr.airMax) tr.airMax = tr.airT;
      if (tr.airT > 0.25) {
        // Caer de un salto largo cuesta velocidad; los amortiguadores la conservan.
        const keep = Math.min(0.97, 0.72 + 0.042 * st.shocks);
        tr.vx *= keep; tr.vy *= keep;
        race.events.push({ type: 'land', k: tr.k });
      }
    }
  }
  tr.g = g; tr.z = tr.alt - g;

  // Avance por el eje: la muestra más cercana dentro de una ventana (así un cruce no confunde).
  const prev = tr.idx;
  let best = 1e9, bi = prev;
  for (let o = -3; o <= 10; o++) {
    const i = (prev + o + n) % n;
    const q = s[i];
    const dd = (q.x - tr.x) * (q.x - tr.x) + (q.y - tr.y) * (q.y - tr.y);
    if (dd < best) { best = dd; bi = i; }
  }
  if (best < (track.half * 1.7) ** 2 && bi !== prev) {
    tr.idx = bi;
    if (bi < prev && prev - bi > n / 2) {            // cruzó la línea hacia adelante
      tr.lap++;
      if (tr.lap > 0 && !tr.finished) {
        const lt = race.t - tr.lapStart;
        if (!tr.bestLap || lt < tr.bestLap) tr.bestLap = lt;
        race.events.push({ type: 'lap', k: tr.k, lap: tr.lap });
      }
      tr.lapStart = race.t;
    } else if (bi > prev && bi - prev > n / 2) tr.lap--;   // la cruzó hacia atrás
  }
  tr.progress = tr.lap * n + tr.idx;

  if (!tr.finished && tr.lap >= race.laps) {
    tr.finished = true; tr.finishT = race.t; tr.place = ++race.finishedCount;
    race.events.push({ type: 'finish', k: tr.k, place: tr.place });
  }
}

function collide (race) {
  const ts = race.trucks;
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      if (a.z > 3 || b.z > 3) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const min = CAR_R * 2;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d, push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const imp = rel * 0.9;
        a.vx += nx * imp; a.vy += ny * imp; b.vx -= nx * imp; b.vy -= ny * imp;
        if (rel < -10) race.events.push({ type: 'crash', k: a.k, j: b.k, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: Math.max(a.z, b.z), force: -rel });
      }
    }
  }
}

function stepPickup (race, dt) {
  const { track, rand } = race;
  if (!race.pickup) {
    race.pickupT -= dt;
    if (race.pickupT <= 0) {
      const s = track.samples[Math.floor(rand() * track.n)];
      const side = (rand() * 2 - 1) * 11;
      race.pickup = { type: rand() < 0.55 ? 'nitro' : 'cash', x: s.x - s.ty * side, y: s.y + s.tx * side, ttl: 9 };
    }
    return;
  }
  const p = race.pickup;
  p.ttl -= dt;
  for (const tr of race.trucks) {
    if (tr.finished || tr.z > 3) continue;
    if (Math.hypot(tr.x - p.x, tr.y - p.y) < 8) {
      if (p.type === 'nitro') tr.nitro++; else tr.cash++;
      race.events.push({ type: 'pickup', k: tr.k, what: p.type });
      p.ttl = 0; break;
    }
  }
  if (p.ttl <= 0) { race.pickup = null; race.pickupT = 4 + rand() * 4; }
}

/** Avanza la carrera un paso fijo. `input` son los mandos del jugador (camioneta 0). */
export function step (race, dt, input) {
  if (race.over) return;
  if (race.state === 'countdown') {
    const before = Math.ceil(race.countdown);
    race.countdown -= dt;
    const now = Math.ceil(race.countdown);
    if (now !== before && now > 0) race.events.push({ type: 'beep', n: now });
    if (race.countdown <= 0) { race.state = 'racing'; race.events.push({ type: 'go' }); }
    return;
  }
  race.t += dt;
  for (const tr of race.trucks) {
    const inp = tr.ai ? aiControl(race, tr) : (input || { steer: 0, gas: false, brake: false, nitro: false });
    stepTruck(race, tr, inp, dt);
    // Una máquina atascada vuelve al eje (no se queda contra una pared para siempre).
    if (tr.ai && !tr.finished) {
      if (tr.progress > tr.bestProgress) { tr.bestProgress = tr.progress; tr.stuckT = 0; } else tr.stuckT += dt;
      if (tr.stuckT > 2.5) {
        const s = race.track.samples[tr.idx];
        tr.x = s.x; tr.y = s.y; tr.a = Math.atan2(s.ty, s.tx); tr.vx = tr.vy = 0; tr.stuckT = 0;
        tr.g = tr.alt = heightAt(race.track, s.x, s.y); tr.rate = 0; tr.air = false; tr.z = 0;
      }
    }
  }
  collide(race);
  stepPickup(race, dt);

  // Termina cuando llega el jugador, o cuando ya llegaron las tres máquinas.
  const player = race.trucks[0];
  const others = race.trucks.filter(t => t.ai);
  if (player.finished || (others.length && others.every(t => t.finished))) {
    race.over = true; race.state = 'over';
    // Los que no llegaron se ordenan por lo que llevan recorrido.
    const rest = race.trucks.filter(t => !t.finished).sort((a, b) => b.progress - a.progress);
    for (const t of rest) t.place = ++race.finishedCount;
  }
}

/** Posición en vivo (1..n) de una camioneta. */
export function livePlace (race, k) {
  const me = race.trucks[k];
  if (me.finished) return me.place;
  let p = 1;
  for (const t of race.trucks) {
    if (t === me) continue;
    if (t.finished || t.progress > me.progress) p++;
  }
  return p;
}
