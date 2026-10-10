// Simulación de la carrera: lógica PURA y determinista (sin DOM ni reloj). La pantalla
// (race.js) le pasa los mandos del jugador y dibuja el estado; tests/sim.mjs la corre sola.
import { rng, distAt, heightAt, crossesLedge, W, H } from './track.js';

export const MAX_LEVEL = 6;
const TRUCK_R = 8;          // radio de choque de una camioneta contra las vallas
// Entre camionetas la caja de choque es la MITAD del dibujo: se meten una en otra al rozarse,
// pero el golpe se nota (rebote, chispas y sonido).
const CAR_R = 5.7;
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

// Dónde pisan las ruedas respecto al centro (el dibujo mide 23×12 px: ejes a ±7 a lo largo,
// ruedas a ±5 a lo ancho). Un desnivel mayor que WHEEL_MAX bajo una rueda no es terreno que
// se pise (es un muro entre pisos, de 15 o 30): esa rueda cuenta como si pisara donde el centro.
const WHEEL_L = 7, WHEEL_W = 5, WHEEL_MAX = 10;
/**
 * El suelo bajo una camioneta: lo que pisan sus cuatro ruedas, no un punto. Devuelve la altura
 * del centro (el promedio de las ruedas) y la inclinación del plano que forman, así una
 * montaña o una roca al costado la levantan y la ladean en vez de atravesarla.
 */
export function groundAt (track, x, y, a) {
  const fx = Math.cos(a), fy = Math.sin(a);
  // Sobre la franja de un muro no se interpola entre píxeles: a medio píxel del corte la
  // altura saldría a media pared. Ahí vale el píxel en el que se está.
  const at = (px, py) => {
    const k = Math.round(py) * W + Math.round(px);
    return k >= 0 && k < W * H && track.ledge[k] ? track.height[k] : heightAt(track, px, py);
  };
  const c = at(x, y);
  const w = (dl, dw) => {
    const wx = x + fx * dl - fy * dw, wy = y + fy * dl + fx * dw;
    const h = at(wx, wy);
    // Una rueda al otro lado de un muro entre piezas no pisa nada: cuenta como el centro.
    return Math.abs(h - c) > WHEEL_MAX || crossesLedge(track, x, y, wx, wy) ? c : h;
  };
  const fl = w(WHEEL_L, WHEEL_W), fr = w(WHEEL_L, -WHEEL_W), rl = w(-WHEEL_L, WHEEL_W), rr = w(-WHEEL_L, -WHEEL_W);
  // El plano que mejor pasa por las cuatro ruedas (en una cuesta pareja la carrocería va a
  // la altura del centro, inclinada); si una rueda sobresale de ese plano (una montaña bajo
  // un solo lado), la carrocería sube lo que haga falta para no hundirla. Y nunca más abajo
  // que lo que hay bajo el centro: en la cresta de una rampa (ruedas delanteras ya en el
  // aire) sigue arriba hasta despegar.
  const mean = (fl + fr + rl + rr) / 4;
  const sp = (fl + fr - rl - rr) / (4 * WHEEL_L), sr = (fl + rl - fr - rr) / (4 * WHEEL_W);
  const over = Math.max(0,
    fl - (mean + sp * WHEEL_L + sr * WHEEL_W), fr - (mean + sp * WHEEL_L - sr * WHEEL_W),
    rl - (mean - sp * WHEEL_L + sr * WHEEL_W), rr - (mean - sp * WHEEL_L - sr * WHEEL_W));
  return { h: Math.max(c, mean + over), c, pitch: Math.atan(sp), roll: Math.atan(sr) };
}

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
    const back = 9 + Math.floor(k / 2) * 9;
    const i = (n - back) % n;
    const s = track.samples[i];
    const side = (k % 2 ? 1 : -1) * 16;
    return {
      k, ai: !!t.ai, color: t.color || 'red', boss: !!t.boss,
      stats: statsFor(t.up), skill: t.skill ?? 1,
      x: s.x - s.ty * side, y: s.y + s.tx * side,
      a: Math.atan2(s.ty, s.tx), vx: 0, vy: 0,
      // Altura: `g` suelo bajo la camioneta, `alt` la suya, `z` lo que vuela por encima.
      g: 0, gc: 0, alt: 0, z: 0, vz: 0, rate: 0, climb: 0, air: false, airT: 0, airMax: 0,
      pitch: 0, roll: 0, pitchV: 0, rollV: 0,
      idx: i, lap: -1, progress: i - n,
      nitro: t.nitro ?? 0, nitroT: 0, nitroHeld: false,
      mud: false, finished: false, finishT: 0, place: 0,
      cash: 0, lane: side * 0.6, laneT: 0, stuckT: 0, offT: 0, bestProgress: i - n,
      lapStart: 0, bestLap: 0,
    };
  });
  for (const tr of list) { const gr = groundAt(track, tr.x, tr.y, tr.a); tr.g = tr.alt = gr.h; tr.gc = gr.c; }
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
  if (tr.laneT <= 0) { tr.lane = (rand() * 2 - 1) * 22; tr.laneT = 1.5 + rand() * 2.5; }
  // Si hay una roca cerca por delante y en su carril, se abre hacia el lado que le queda.
  let lane = tr.lane;
  for (const r of track.rocks) {
    const ahead = (r.i - tr.idx + n) % n;
    // Una puerta de rocas en una rampa se pasa por el medio (abrirse hacia fuera deja a la
    // máquina entre la roca y la valla).
    if (r.gate && ahead > 0 && ahead < 24) { lane = 0; break; }
    if (ahead > 0 && ahead < 16 && Math.abs(lane - r.lat) < 13) lane = r.lat + (lane >= r.lat ? 15 : -15);
  }
  lane = Math.max(-26, Math.min(26, lane));
  // El punto al que apunta tiene que quedar con margen de las vallas: en una esquina cuadrada
  // el carril de fuera cae dentro de la pared, así que se va cerrando hacia la trazada.
  let tx = tgt.x - tgt.ty * lane, ty = tgt.y + tgt.tx * lane;
  for (let k = 0; k < 4 && distAt(track, tx, ty) > track.half - 15; k++) {
    lane *= 0.5;
    tx = tgt.x - tgt.ty * lane; ty = tgt.y + tgt.tx * lane;
  }
  // Si entre la camioneta y ese punto hay un muro entre pisos (la pista pasa pegada a sí
  // misma a distinta altura), apunta más cerca, siguiendo su carril, hasta que no lo cruce.
  for (let o = look - 2; o >= 2 && crossesLedge(track, tr.x, tr.y, tx, ty); o -= 2) {
    const q = s[(tr.idx + o) % n];
    tx = q.x - q.ty * lane; ty = q.y + q.tx * lane;
  }
  // Si ni así (el carril elegido queda al otro lado del muro), sigue por el carril en el que
  // ya va: el muro corre a lo largo de la pista, nunca la cruza.
  if (crossesLedge(track, tr.x, tr.y, tx, ty)) {
    const q = s[tr.idx];
    lane = Math.max(-26, Math.min(26, -(tr.x - q.x) * q.ty + (tr.y - q.y) * q.tx));
    tx = tgt.x - tgt.ty * lane; ty = tgt.y + tgt.tx * lane;
  }
  const diff = wrapAngle(Math.atan2(ty - tr.y, tx - tr.x) - tr.a);
  let steer = Math.max(-1, Math.min(1, diff * 3.2));         // gira en proporción, como un volante
  // Y si aun así tiene una roca justo delante, la esquiva por el lado contrario.
  const hx = Math.cos(tr.a), hy = Math.sin(tr.a);
  for (const r of track.rocks) {
    const rx = r.x - tr.x, ry = r.y - tr.y, fwd = rx * hx + ry * hy, side = -rx * hy + ry * hx;
    if (fwd > 0 && fwd < 36 && Math.abs(side) < r.r + 12) { steer = side > 0 ? -1 : 1; break; }
  }
  // Frena si viene una curva cerrada y va rápido para ella: mira la más cerrada del tramo que viene.
  let curv = 0;
  for (let o = 2; o <= look + 6; o++) curv = Math.max(curv, s[(tr.idx + o) % n].curv);
  const limit = 52 + 78 * Math.max(0, 1 - curv / 1.2) + tr.stats.grip * 1.3;
  let gas = Math.abs(diff) < 1.1 || speed < 22;
  if (speed > limit) gas = false;
  const brake = speed > limit * 1.12;
  let nitro = false;
  if (tr.nitro > 0 && tr.nitroT <= 0 && !tr.air && Math.abs(diff) < 0.15 && curv < 0.2 && speed > 30 && rand() < 0.012) nitro = true;
  // Trabada contra una valla o una roca: marcha atrás girando al otro lado, y vuelve a intentarlo.
  if (tr.stuckT > 0.6 && tr.stuckT < 1.4) return { steer: -steer, gas: false, brake: true, nitro: false };
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
  const px = tr.x, py = tr.y;
  tr.x += tr.vx * dt; tr.y += tr.vy * dt;

  // Bordes entre piezas a distinto piso: un muro con valla. Rodando no se cruza (a ninguna
  // velocidad: se mira si el paso cruza la franja del muro, no cuánto cambió la altura); se
  // rebota como contra la valla de fuera. En el aire sí se puede caer encima del piso alto.
  tr.walled = false;
  // La valla que corona el muro (FENCE_H) también para a una camioneta EN EL AIRE que la roce:
  // tirarse del piso alto al bajo era el atajo. Solo pasa por encima quien vuela más alto.
  const FENCE_H = 8;
  const overFence = tr.air && tr.alt > Math.max(tr.gc, heightAt(track, tr.x, tr.y)) + FENCE_H;
  if (!overFence && crossesLedge(track, px, py, tr.x, tr.y)) {
    let gx = heightAt(track, px + 1, py) - heightAt(track, px - 1, py);
    let gy = heightAt(track, px, py + 1) - heightAt(track, px, py - 1);
    if (tr.gc > heightAt(track, tr.x, tr.y)) { gx = -gx; gy = -gy; }     // desde arriba, el muro está hacia abajo (por el suelo bajo el CENTRO: la carrocería puede ir más alta)
    const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    const vn = tr.vx * gx + tr.vy * gy;
    tr.x = px; tr.y = py;
    // Solo si va CONTRA el muro se rebota; si se aleja (acaba de caer justo en el borde) se la deja ir.
    if (vn > 0) {
      tr.walled = true;
      tr.vx -= gx * vn * 1.25; tr.vy -= gy * vn * 1.25;
      tr.vx *= 0.9; tr.vy *= 0.9;
      if (vn > 25) race.events.push({ type: 'hit', k: tr.k });
    }
  }

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
  // Rocas: sólidas, salvo que se pase volando por encima.
  if (tr.z < 5) {
    for (const r of track.rocks) {
      const dx = tr.x - r.x, dy = tr.y - r.y, dd = Math.hypot(dx, dy), min = r.r + 7;
      if (dd >= min || dd === 0) continue;
      const nx = dx / dd, ny = dy / dd;
      tr.x += nx * (min - dd); tr.y += ny * (min - dd);
      const vn = tr.vx * nx + tr.vy * ny;
      if (vn < 0) {
        tr.vx -= nx * vn * 1.5; tr.vy -= ny * vn * 1.5;
        tr.vx *= 0.8; tr.vy *= 0.8;
        if (vn < -25) race.events.push({ type: 'hit', k: tr.k });
      }
    }
  }
  tr.x = Math.max(2, Math.min(W - 3, tr.x)); tr.y = Math.max(2, Math.min(H - 3, tr.y));

  // Altura. En el suelo la camioneta lo sigue; despega cuando el suelo se le acaba de golpe
  // bajo las ruedas (el borde de una rampa, la cresta de una loma) y venía subiendo.
  // `g` es donde descansa la carrocería (las cuatro ruedas); el despegue se decide por lo que
  // hay bajo el centro (`gc`), que es lo que se acaba de golpe en una cresta.
  const ground = groundAt(track, tr.x, tr.y, tr.a), g = ground.h, gc = ground.c;
  if (!tr.air) {
    const rate = (gc - tr.gc) / dt;
    // Despega solo si el suelo se le va de debajo más rápido de lo que caería (una cresta tras
    // una subida, o la bajada de un nivel), Y hay de dónde saltar: una subida de 7 o más
    // (rampa, montaña) o un piso en alto. Un hueco (6 de hondo, desde el suelo) no da para
    // volar: se entra y se sale rodando, pegada al suelo.
    // La subida que traía se mira ANTES de borrarla por la bajada de este cuadro: en la cresta
    // el suelo cae de golpe y es justo entonces cuando cuenta lo que subió.
    const climbed = tr.climb;
    if (rate > 0) tr.climb += gc - tr.gc; else if (rate < -1) tr.climb = 0;
    const falls = tr.gc + tr.rate * dt - 0.5 * GRAVITY * dt * dt - gc > 0.12;
    // Desde el borde de un muro entre piezas no se salta: el suelo cae igual bajo el centro,
    // pero ahí lo que hay es una valla (crossesLedge la hace de pared).
    const onLedge = track.ledge[Math.round(tr.y) * W + Math.round(tr.x)] !== 0;
    if (falls && !onLedge && speed > 20 && (climbed >= 7 || tr.gc >= 10)) {
      tr.air = true; tr.airT = 0; tr.climb = 0;
      tr.alt = tr.g; tr.vz = Math.min(VZ_MAX, tr.rate > 0 ? tr.rate * LAUNCH : tr.rate);
      race.events.push({ type: 'jump', k: tr.k });
    } else { tr.alt = g; tr.rate = rate; }
  }
  if (tr.air) {
    tr.vz -= GRAVITY * dt; tr.alt += tr.vz * dt; tr.airT += dt;
    if (tr.alt <= g) {
      // El golpe de aterrizar hunde el morro; unos amortiguadores mejores lo absorben.
      tr.pitchV -= Math.min(60, -tr.vz) * 0.09 * Math.max(0.25, 1 - 0.1 * st.shocks);
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
  tr.g = g; tr.gc = gc; tr.z = tr.alt - g;

  // Inclinación: en el suelo la camioneta se acomoda a la normal del piso (cabeceo a lo largo
  // del eje, balanceo entre las ruedas); en el aire levanta el morro al subir y lo baja al
  // caer. Se sigue con suavidad, como lo haría la suspensión.
  // Encima va lo que hace la carrocería sobre la suspensión, ponderado por las mejoras: al
  // girar se ladea hacia fuera (menos con mejores llantas), al acelerar levanta el morro y al
  // frenar lo hunde, y al aterrizar rebota (menos, y más corto, con mejores amortiguadores).
  let pitchT, rollT;
  if (!tr.air) {
    pitchT = ground.pitch; rollT = ground.roll;
    rollT += input.steer * Math.min(speed, 90) * 0.0028 * Math.max(0.5, 1.3 - 0.12 * st.tires);
    if (!tr.finished) {
      if (input.gas && speed < st.top * 0.9) pitchT += 0.05 * (1 + 0.1 * st.accel / 12);
      else if (input.brake) pitchT -= 0.07;
    }
    if (tr.nitroT > 0) pitchT += 0.08;
  } else {
    pitchT = Math.atan2(tr.vz, Math.max(20, speed)) * 0.5;
    rollT = 0;
  }
  // Muelle amortiguado: más duro y mejor amortiguado con mejores amortiguadores.
  const omega = (tr.air ? 6 : 11) + 1.5 * Math.min(12, st.shocks), zeta = 0.5 + 0.07 * Math.min(12, st.shocks);
  tr.pitchV += ((pitchT - tr.pitch) * omega * omega - 2 * zeta * omega * tr.pitchV) * dt;
  tr.rollV += ((rollT - tr.roll) * omega * omega - 2 * zeta * omega * tr.rollV) * dt;
  tr.pitch = Math.max(-1, Math.min(1, tr.pitch + tr.pitchV * dt));
  tr.roll = Math.max(-1, Math.min(1, tr.roll + tr.rollV * dt));

  // Avance por el eje: la muestra más cercana dentro de una ventana (así un cruce no confunde).
  const prev = tr.idx;
  let best = 1e9, bi = prev;
  for (let o = -12; o <= 10; o++) {
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
  // Lejos de toda la ventana: se salió del eje (voló una valla, tomó el otro ramal de un cruce).
  // ATAJAR NO ES POSIBLE: si la muestra más cercana de toda la pista queda bastante por delante,
  // la camioneta vuelve a donde iba. Si queda por detrás (dio la vuelta, o el otro ramal lleva
  // atrás), se sincroniza y sigue desde ahí. Antes el avance se quedaba clavado y la vuelta
  // no contaba hasta pasar otra vez por el punto perdido: cortar camino costaba una vuelta.
  if (best >= (track.half * 1.7) ** 2) {
    tr.offT += dt;
    if (tr.offT > 0.4) {
      let gb = 1e9, gi = prev;
      for (let i = 0; i < n; i++) {
        const q = s[i], dd = (q.x - tr.x) * (q.x - tr.x) + (q.y - tr.y) * (q.y - tr.y);
        if (dd < gb) { gb = dd; gi = i; }
      }
      if (gb < (track.half * 1.7) ** 2) {
        const ahead = (gi - prev + n) % n;
        if (ahead > 10 && ahead < n / 2) {
          const q = s[prev];
          tr.x = q.x; tr.y = q.y; tr.a = Math.atan2(q.ty, q.tx); tr.vx = tr.vy = 0;
          const gr = groundAt(track, q.x, q.y, tr.a);
          tr.g = tr.alt = gr.h; tr.gc = gr.c; tr.rate = 0; tr.air = false; tr.z = 0;
          race.events.push({ type: 'shortcut', k: tr.k });
        } else if (ahead >= n / 2) {
          if (gi > prev && gi - prev > n / 2) tr.lap--;   // volvió a cruzar la meta hacia atrás
          tr.idx = gi;
        }
        tr.offT = 0;
      }
    }
  } else tr.offT = 0;
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
      const side = (rand() * 2 - 1) * 22;
      race.pickup = { type: rand() < 0.55 ? 'nitro' : 'cash', x: s.x - s.ty * side, y: s.y + s.tx * side, ttl: 9 };
    }
    return;
  }
  const p = race.pickup;
  p.ttl -= dt;
  for (const tr of race.trucks) {
    if (tr.finished || tr.z > 3) continue;
    if (Math.hypot(tr.x - p.x, tr.y - p.y) < 13) {
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
      // Trabada = sin avanzar Y casi parada. Por fuera de una esquina cuadrada se recorre un
      // buen trecho sin que cambie el punto más cercano de la trazada: eso no es estar trabada.
      if (tr.progress > tr.bestProgress) { tr.bestProgress = tr.progress; tr.stuckT = 0; }
      // Empujar contra un muro con velocidad también es estar trabada.
      else if (Math.hypot(tr.vx, tr.vy) < 14 || tr.walled) tr.stuckT += dt;
      else tr.stuckT = Math.max(0, tr.stuckT - dt);
      if (tr.stuckT > 2.5) {
        const s = race.track.samples[tr.idx];
        tr.x = s.x; tr.y = s.y; tr.a = Math.atan2(s.ty, s.tx); tr.vx = tr.vy = 0; tr.stuckT = 0;
        const gr = groundAt(race.track, s.x, s.y, tr.a);
        tr.g = tr.alt = gr.h; tr.gc = gr.c; tr.rate = 0; tr.air = false; tr.z = 0;
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
