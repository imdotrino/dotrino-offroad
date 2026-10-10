// Prueba de la lógica pura: en CADA carrera del mapa las cuatro camionetas (todas llevadas
// por la máquina) tienen que completar las vueltas sin atascarse, y la carrera tiene que ser
// determinista. Es lo que comprueba que un trazado nuevo se puede correr.
import assert from 'node:assert/strict';
import { buildTrack, distAt, heightAt, generateLayout, LAYOUTS, W, H } from '../src/track.js';
import { createRace, step, groundAt } from '../src/sim.js';
import { allNodes, rivalsFor, isUnlocked, totalStars, starsForPlace, prizeFor, randomNode } from '../src/levels.js';

function run (node, playerLevel) {
  const track = buildTrack(node.race);
  const up = { tires: playerLevel, shocks: playerLevel, accel: playerLevel, speed: playerLevel };
  const trucks = [{ ai: true, color: 'red', up, skill: 0.95, nitro: 3 }, ...rivalsFor(node)];
  const race = createRace({ track, trucks, laps: node.race.laps, seed: node.race.seed, grip: node.race.grip });
  let steps = 0, resets = 0;
  const DT = 1 / 60;
  while (!race.trucks.every(t => t.finished) && steps < 60 * 400) {
    race.over = false;                     // seguir hasta que lleguen todas
    const before = race.trucks.map(t => t.stuckT);
    step(race, DT, null);
    race.trucks.forEach((t, i) => { if (before[i] > 2 && t.stuckT === 0 && t.vx === 0 && t.vy === 0) resets++; });
    steps++;
  }
  return { race, track, steps, resets };
}

/** Al colocar una camioneta a mano, su avance apunta a la muestra más cercana (si no, la
 *  simulación cree que atajó y la devuelve a donde «iba»). */
function placeIdx (track, a) {
  let b = 1e9;
  for (let i = 0; i < track.n; i++) { const q = track.samples[i], d = (q.x - a.x) ** 2 + (q.y - a.y) ** 2; if (d < b) { b = d; a.idx = i; } }
}

// 1. Cada trazado deja una pista con la salida dentro y obstáculos sobre el eje.
for (let i = 0; i < LAYOUTS.length; i++) {
  for (const reversed of [false, true]) {
    const t = buildTrack({ layout: i, reversed, seed: 7 + i, bumps: 3, puddles: 3, rocks: 4, mounds: 3, whoops: 1 });
    assert.ok(t.rocks.length >= 1 && t.rocks.length <= 4, `${t.name}: rocks (${t.rocks.length})`);
    assert.equal(t.mounds.length, 3, `${t.name}: mounds`);
    for (const r of t.rocks) assert.ok(distAt(t, r.x, r.y) < t.half - r.r, `${t.name}: rock outside the track`);
    assert.ok(t.n > 120, `${t.name}: too short (${t.n})`);
    // La pista entera (con su valla) cabe en el mundo, y dos tramos no se pisan salvo en un cruce.
    for (const q of t.samples) assert.ok(q.x > t.half + 4 && q.x < W - t.half - 4 && q.y > t.half + 4 && q.y < H - t.half - 4, `${t.name}: track leaves the world at ${q.x.toFixed(0)},${q.y.toFixed(0)}`);
    // La trazada redondea las esquinas, así que se separa un poco del eje del polígono.
    for (const s of t.samples) assert.ok(distAt(t, s.x, s.y) < t.half * 0.75, `${t.name}: racing line strays from the track axis`);
    assert.ok(t.bumps.length >= 1, `${t.name}: bumps`);
    assert.ok(t.ramps.length >= 1, `${t.name}${reversed ? ' rev' : ''}: no straight long enough for a ramp`);
    assert.ok(t.samples[0].curv < 0.45, `${t.name}: start line is not on a straight (${t.samples[0].curv.toFixed(2)})`);
  }
}

// 1b. Pistas por piezas: hay muchas formas distintas, con cruces y chicanas; la misma semilla
//      da la misma pista; caben en el mundo; dos tramos no se pisan (salvo en su cruce); y la
//      máquina las termina.
{
  const shapes = new Set();
  let crossed = 0, chicaned = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const g = generateLayout(seed, 3 + seed % 5);
    shapes.add(JSON.stringify(g));
    if (g.crossed) crossed++;
    if (g.chicanes) chicaned++;
  }
  assert.ok(shapes.size > 400, `only ${shapes.size} distinct generated layouts`);
  assert.ok(crossed > 100, `only ${crossed} layouts with a crossing`);
  assert.ok(chicaned > 200, `only ${chicaned} layouts with a chicane`);
  assert.deepEqual(generateLayout(77, 5), generateLayout(77, 5));
  assert.ok(!generateLayout(77, 6, { cross: 0, chicane: 0 }).crossed);
  let ranCross = 0, ranChicane = 0, ranPlain = 0;
  for (let seed = 11; seed < 111; seed++) {
    const node = randomNode(seed * 7919, { tires: 1, shocks: 1, accel: 1, speed: 1 });
    const t = buildTrack(node.race);
    for (const q of t.samples) assert.ok(q.x > t.half + 4 && q.x < W - t.half - 4 && q.y > t.half + 4 && q.y < H - t.half - 4, `gen ${seed}: leaves the world`);
    let touching = 0;
    for (let i = 0; i < t.n; i++) {
      for (let j = i + 40; j < t.n; j++) {
        if (Math.min(j - i, t.n - (j - i)) < 40) continue;
        const d = Math.hypot(t.samples[i].x - t.samples[j].x, t.samples[i].y - t.samples[j].y);
        if (d < 3) touching++;
        if (!t.crossed) assert.ok(d > t.half * 1.6, `gen ${seed}: two stretches overlap (${d.toFixed(0)} px apart)`);
      }
    }
    if (t.crossed) assert.ok(touching >= 1 && touching <= 6, `gen ${seed}: expected ONE clean crossing, got ${touching} touching pairs`);
    assert.ok(t.samples[0].curv < 0.45, `gen ${seed}: start line is not on a straight`);
    const want = t.crossed ? ranCross < 4 : t.chicanes ? ranChicane < 5 : ranPlain < 3;
    if (want) {
      if (t.crossed) ranCross++; else if (t.chicanes) ranChicane++; else ranPlain++;
      const { race, resets } = run(node, 1);
      for (const tr of race.trucks) assert.ok(tr.finished, `gen ${seed}: truck ${tr.color} did not finish`);
      assert.ok(resets <= 3, `gen ${seed}: ${resets} stuck resets`);
    }
  }
  assert.ok(ranCross >= 3 && ranChicane >= 3, `too few simulated: ${ranCross} crossed, ${ranChicane} with chicane`);
  console.log(`generated layouts: ${shapes.size} distinct out of 3000 seeds · ${crossed} with a crossing · ${chicaned} with a chicane · simulated ${ranCross}+${ranChicane}+${ranPlain}`);
}

// 2. Todas las carreras del mapa se pueden terminar.
let worst = 0;
for (const node of allNodes()) {
  const { race, steps, resets } = run(node, node.race.level);
  const secs = steps / 60;
  for (const t of race.trucks) assert.ok(t.finished, `${node.id} (${race.track.name}): truck ${t.color} did not finish in ${secs.toFixed(0)}s`);
  assert.ok(resets <= 3, `${node.id} (${race.track.name}): ${resets} stuck resets`);
  const lap = secs / node.race.laps;
  worst = Math.max(worst, lap);
  const air = Math.max(...race.trucks.map(t => t.airMax));
  if (race.track.ramps.length) assert.ok(air > 0.55, `${node.id} (${race.track.name}): ramp jump too short (${air.toFixed(2)}s)`);
  console.log(`${node.id.padEnd(4)} ${race.track.name.padEnd(9)} ${node.race.reversed ? 'rev' : '   '} n=${race.track.n} laps=${node.race.laps} total=${secs.toFixed(1)}s lap≈${lap.toFixed(1)}s resets=${resets} ramps=${race.track.ramps.length} air=${air.toFixed(2)}s order=${race.trucks.slice().sort((a, b) => a.place - b.place).map(t => t.color).join('>')}`);
}
assert.ok(worst < 26, `a lap takes too long (${worst.toFixed(1)}s)`);

// 2b. Entre camionetas la caja de choque es la mitad del dibujo (13 de largo): se solapan al
//     rozarse, pero no se atraviesan, y el choque se anuncia.
{
  const track = buildTrack({ layout: 6, seed: 1, bumps: 0, puddles: 0, rocks: 0, mounds: 0, whoops: 0, hills: 0, ramps: 0, maxLevel: 0 });   // pista lisa
  const up = { tires: 0, shocks: 0, accel: 0, speed: 0 };
  const race = createRace({ track, trucks: [{ ai: false, up }, { ai: false, up }], laps: 3, seed: 1 });
  race.state = 'racing';
  const [a, b] = race.trucks, s0 = track.samples[track.n - 12];
  a.x = s0.x - 20; a.y = s0.y; a.vx = 60; a.vy = 0; a.a = 0; placeIdx(track, a);
  b.x = s0.x + 20; b.y = s0.y; b.vx = -60; b.vy = 0; b.a = Math.PI;
  for (const t of [a, b]) { t.g = t.alt = 0; t.rate = 0; }
  let closest = 99, crashed = false, bounced = false;
  for (let i = 0; i < 40; i++) {
    step(race, 1 / 60, { steer: 0, gas: false, brake: false, nitro: false });
    race.over = false;
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    if (race.events.some(e => e.type === 'crash')) { crashed = true; bounced = a.vx < 0 && b.vx > 0; }
    race.events.length = 0;
  }
  assert.ok(closest < 14.5 && closest > 9, `trucks should overlap about half their length (23 px), got ${closest.toFixed(1)}`);
  assert.ok(crashed, 'a head-on hit must raise a crash event');
  assert.ok(bounced, 'trucks must bounce back');
}

// 2c. Una roca es sólida: la camioneta que va de frente no la atraviesa.
{
  const track = buildTrack({ layout: 6, seed: 3, bumps: 0, puddles: 0, rocks: 1, mounds: 0, whoops: 0, hills: 0, ramps: 0, maxLevel: 0 });
  const up = { tires: 0, shocks: 0, accel: 0, speed: 0 };
  const race = createRace({ track, trucks: [{ ai: false, up }], laps: 3, seed: 1 });
  race.state = 'racing';
  const [a] = race.trucks, r = track.rocks[0];
  a.x = r.x - 26; a.y = r.y; a.vx = 70; a.vy = 0; a.a = 0; placeIdx(track, a);
  let closest = 99;
  for (let i = 0; i < 30; i++) {
    step(race, 1 / 60, { steer: 0, gas: true, brake: false, nitro: false });
    race.over = false;
    closest = Math.min(closest, Math.hypot(a.x - r.x, a.y - r.y));
  }
  assert.ok(closest >= r.r + 6.9, `truck went through a rock (${closest.toFixed(1)} < ${(r.r + 7).toFixed(1)})`);
}

// 2d. Niveles por módulos: la salida va a ras de suelo, hay tramos a uno y dos pisos, el suelo
//     de la pista está a la altura de su módulo, y hay cortes.
{
  let high = 0, twoFloors = 0, withDrop = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const t = buildTrack({ seed: seed * 104729, size: 5 + seed % 3, bumps: 0, puddles: 0, rocks: 0, mounds: 0, whoops: 0, hills: 0, ramps: 0, maxLevel: 2 });
    assert.equal(t.level[0], 0, `gen ${seed}: start line must be at ground level`);
    const top = Math.max(...t.level);
    if (top >= 15) high++;
    if (top >= 30) twoFloors++;
    if (t.drops.length) withDrop++;
    for (let i = 0; i < t.n; i += 7) {
      const q = t.samples[i], h = t.height[Math.round(q.y) * W + Math.round(q.x)];
      const lo = Math.min(t.level[i], t.level[(i + 3) % t.n], t.level[(i + t.n - 3) % t.n]) - 1.5;
      const hi = Math.max(t.level[i], t.level[(i + 3) % t.n], t.level[(i + t.n - 3) % t.n]) + 1.5;
      if (!t.crossed) assert.ok(h >= lo && h <= hi, `gen ${seed}: ground at ${h.toFixed(1)} but module level is ${t.level[i].toFixed(1)}`);
    }
  }
  // Esquinas: en una misma tanda de pistas salen los tres estilos (arco, 45° y cuadrada).
  const styles = new Set();
  for (let seed = 1; seed <= 6; seed++) for (const c of buildTrack({ seed: seed * 104729, size: 5, maxLevel: 0 }).corners) styles.add(c);
  assert.deepEqual([...styles].sort(), [0, 1]);
  // Y ninguna esquina puntiaguda: en todo el contorno de la pista, la valla no dobla 90° de
  // golpe. Se mira el giro de la normal entre dos puntos del borde separados 6 px.
  {
    const t = buildTrack({ seed: 3 * 104729, size: 6, maxLevel: 0 });
    const gradAt = (x, y) => { const gx = distAt(t, x + 2, y) - distAt(t, x - 2, y), gy = distAt(t, x, y + 2) - distAt(t, x, y - 2), l = Math.hypot(gx, gy) || 1; return [gx / l, gy / l]; };
    let worst = 0;
    for (let y = 8; y < H - 8; y += 2) for (let x = 8; x < W - 8; x += 2) {
      if (Math.abs(distAt(t, x, y) - t.half) > 1) continue;
      // La valla entre tramos pegados (fenceSeams) es una franja fina puesta después del
      // limado: sus extremos y sus esquinas con la valla de fuera no se liman. Se salta.
      let nearSeam = false;
      for (let sy = Math.max(0, y - 14); sy <= Math.min(H - 1, y + 14) && !nearSeam; sy++) for (let sx = Math.max(0, x - 14); sx <= Math.min(W - 1, x + 14); sx++) if (t.seam[sy * W + sx]) { nearSeam = true; break; }
      if (nearSeam) continue;
      const [nx, ny] = gradAt(x, y);
      // el siguiente punto del borde, 6 px más allá siguiendo la valla
      const qx = x - ny * 6, qy = y + nx * 6;
      if (Math.abs(distAt(t, qx, qy) - t.half) > 2.5) continue;
      const [mx, my] = gradAt(qx, qy);
      worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, nx * mx + ny * my))));
    }
    assert.ok(worst < 1.15, `a wall turns ${(worst * 57.3).toFixed(0)}° within 6 px: that is a pointed corner`);
  }
  // Ningún desnivel de la pista pasa de 45°: entre dos puntos seguidos de la trazada (4 px) el
  // suelo no cambia más de lo que se avanza. Vale para niveles, rampas, lomas y montículos.
  for (const node of allNodes()) {
    const t = buildTrack(node.race);
    let worst = 0, at = 0;
    for (let i = 0; i < t.n; i++) {
      const p = t.samples[i], q = t.samples[(i + 1) % t.n];
      const run = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const rise = Math.abs(t.height[Math.round(q.y) * W + Math.round(q.x)] - t.height[Math.round(p.y) * W + Math.round(p.x)]);
      if (rise / run > worst) { worst = rise / run; at = i; }
    }
    assert.ok(worst <= 1.15, `${node.id}: a ${(Math.atan(worst) * 57.3).toFixed(0)}° step on the racing line at sample ${at}`);
  }
  // Huecos: los pide la región, caen dentro de la pista y bajan 6 con paredes a 45°.
  {
    const t = buildTrack({ seed: 9 * 104729, size: 5, maxLevel: 0, pits: 3, rocks: 0, mounds: 0, bumps: 0, whoops: 0, hills: 0, ramps: 0, puddles: 0 });
    assert.ok(t.pits.length >= 2, `only ${t.pits.length} pits`);
    for (const pt of t.pits) {
      assert.ok(distAt(t, pt.x, pt.y) < t.half - pt.rx, 'pit outside the track');
      assert.ok(pt.floor > 0, `${pt.type} has no floor at full depth`);
      let deepest = 0;
      for (const v of pt.dep) deepest = Math.max(deepest, v);
      assert.ok(deepest >= pt.d - 0.01, `${pt.type} floor should be ${pt.d} below`);
    }
  }
  assert.ok(high >= 18, `only ${high}/24 tracks have a raised stretch`);
  assert.ok(twoFloors >= 6, `only ${twoFloors}/24 tracks reach the second floor`);
  assert.ok(withDrop >= 8, `only ${withDrop}/24 tracks have a drop`);
  console.log(`levels: ${high}/24 raised · ${twoFloors}/24 two floors · ${withDrop}/24 with a drop`);
}

// 2d'. PIEZAS QUE ENCAJAN: en todo el ancho de la pista (no solo en la trazada) el suelo de los
// módulos no da ningún salto de más de 45° entre píxeles vecinos. Dos piezas solo se tocan
// donde tienen la misma altura; si la pista pasa pegada a sí misma, los dos tramos van al mismo
// piso. Se mide sin obstáculos, que son los únicos con paredes propias (rocas, hoyos).
{
  const noObstacles = { bumps: 0, pits: 0, rocks: 0, mounds: 0, whoops: 0, puddles: 0, hills: 0, ramps: 0 };
  const specs = allNodes().map(nd => ({ id: nd.id, spec: { ...nd.race, ...noObstacles } }));
  for (let seed = 1; seed <= 40; seed++) {
    const nd = randomNode(seed * 7919, { tires: 0, shocks: 0, accel: 0, speed: 0 }, seed % 9);
    specs.push({ id: 'random ' + seed, spec: { ...nd.race, ...noObstacles } });
  }
  for (const { id, spec } of specs) {
    const t = buildTrack(spec);
    let worst = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (t.field[k] > t.half - 2) continue;
      for (const j of [k + 1, k + W]) {
        const step = Math.abs(t.height[k] - t.height[j]);
        // Un borde declarado (muro con valla, pared para la física) sí puede saltar un piso.
        if (step > 1.05 && (t.ledge[k] || t.ledge[j])) continue;
        worst = Math.max(worst, step);
      }
    }
    // 1.2 y no 1.0: donde la franja de una recta toca la cuña de un arco el redondeo a píxel
    // mueve el final de la rampa un píxel; una pared de verdad es un piso entero (15).
    assert.ok(worst <= 1.2, `${id}: a ${worst.toFixed(2)} px step across the track band (a wall between modules)`);
  }
}

// 2e. Física de los huecos: se entra y se sale RODANDO, sin despegar; de una rampa sí se vuela.
{
  const mk = (pits, ramps) => buildTrack({ seed: 9 * 104729, size: 5, maxLevel: 0, pits, rocks: 0, mounds: 0, bumps: 0, whoops: 0, hills: 0, ramps, puddles: 0 });
  const drive = (track, from, dir, secs) => {
    const up = { tires: 2, shocks: 2, accel: 2, speed: 2 };
    const race = createRace({ track, trucks: [{ ai: false, up }], laps: 9, seed: 1 });
    race.state = 'racing';
    const a = race.trucks[0];
    a.x = from.x; a.y = from.y; a.a = dir; a.vx = Math.cos(dir) * 70; a.vy = Math.sin(dir) * 70; a.g = a.alt = 0; placeIdx(track, a);
    let air = 0, minG = 0;
    for (let i = 0; i < secs * 60; i++) { step(race, 1 / 60, { steer: 0, gas: true, brake: false, nitro: false }); race.over = false; if (a.air) air++; minG = Math.min(minG, a.g); }
    return { air, minG };
  };
  const t = mk(3, 0), pt = t.pits.find(p => p.type !== 'trench') || t.pits[0];
  const r = drive(t, { x: pt.x - pt.rx - 14, y: pt.y }, 0, 1);
  // La carrocería descansa sobre sus cuatro ruedas, así que no baja hasta el fondo: las ruedas
  // de delante y de atrás (a ±7) van más arriba que el centro.
  assert.ok(r.minG < -1.5, `the truck never went down into the pit (${r.minG.toFixed(1)})`);
  assert.equal(r.air, 0, `the truck left the ground ${r.air} frames crossing a pit: it must roll through`);
  const t2 = mk(0, 1), rp = t2.ramps[0], s0 = t2.samples[(rp - 14 + t2.n) % t2.n];
  const r2 = drive(t2, { x: s0.x, y: s0.y }, Math.atan2(s0.ty, s0.tx), 1.5);
  assert.ok(r2.air > 20, `a ramp should launch the truck (airborne ${r2.air} frames)`);
}

// 2e2. Un muro entre piezas no se cruza rodando A NINGUNA VELOCIDAD, por ninguno de los dos
//      lados (antes se decidía por el salto de altura y con nitro se colaba); y donde el
//      desnivel es chico (el pie de una rampa pegada a una pieza llana) no hay muro: se cruza.
{
  let walls = 0, tried = 0;
  for (let seed = 1; seed <= 40 && walls < 6; seed++) {
    const nd = randomNode(seed * 7919, { tires: 0, shocks: 0, accel: 0, speed: 0 }, 5);
    const t = buildTrack({ ...nd.race, rocks: 0, pits: 0, bumps: 0, whoops: 0, mounds: 0, puddles: 0 });
    // Un píxel del lado alto con el lado bajo a 3 px en línea recta.
    let found = null;
    for (let y = 6; y < H - 6 && !found; y++) for (let x = 6; x < W - 6 && !found; x++) {
      const k = y * W + x;
      if (t.ledge[k] !== 2 || t.field[k] > t.half - 10) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = k + 3 * dy * W + 3 * dx;
        // Un muro de verdad: llano a los dos lados (no el final de un muro que muere en una cuesta).
        const kk = k - 4 * dy * W - 4 * dx, jj = j + 4 * dy * W + 4 * dx;
        if (t.ledge[j] === 1 && t.field[j] < t.half - 10 && t.height[k] - t.height[j] >= 6 &&
            Math.abs(t.height[kk] - t.height[k]) < 1.5 && Math.abs(t.height[jj] - t.height[j]) < 1.5) { found = { x, y, dx, dy }; break; }
      }
    }
    if (!found) continue;
    walls++;
    for (const from of ['high', 'low']) for (const v of [40, 130]) {
      tried++;
      const sign = from === 'high' ? 1 : -1;                 // high → towards low: +d
      const sx = found.x - found.dx * 10 * sign + (from === 'low' ? found.dx * 3 : 0), sy = found.y - found.dy * 10 * sign + (from === 'low' ? found.dy * 3 : 0);
      const dir = Math.atan2(found.dy * sign, found.dx * sign);
      const race = createRace({ track: t, trucks: [{ ai: false, up: { tires: 0, shocks: 0, accel: 0, speed: 0 } }], laps: 9, seed: 1 });
      race.state = 'racing';
      const a = race.trucks[0];
      a.x = sx; a.y = sy; a.a = dir; a.vx = Math.cos(dir) * v; a.vy = Math.sin(dir) * v; placeIdx(t, a);
      const gr = groundAt(t, a.x, a.y, a.a); a.g = a.alt = gr.h; a.gc = gr.c;
      const h0 = heightAt(t, sx, sy);
      let crossed = false;
      for (let i = 0; i < 40; i++) {
        step(race, 1 / 60, { steer: 0, gas: true, brake: false, nitro: false }); race.over = false;
        // Cruzó si, rodando, acabó al otro nivel (puede deslizarse a lo largo del muro).
        if (!a.air && (from === 'high' ? a.g < h0 - 6 : a.g > h0 + 6)) crossed = true;   // : donde descansa; bajo el centro el muro suavizado ya baja
      }
      assert.ok(!crossed, `seed ${seed}: drove through a wall from the ${from} side at ${v} px/s (h0 ${h0.toFixed(1)})`);
    }
  }
  assert.ok(walls >= 3, `too few walls found to test (${walls})`);
}

// 2f. La camioneta pisa con las cuatro ruedas, no con un punto: al pasar al costado de una
//     montaña (el centro fuera del cono, las ruedas de un lado encima) sube y se ladea, en vez
//     de atravesarla. Y la carrocería nunca queda por debajo de lo que pisa cada rueda.
{
  const t = buildTrack({ layout: 6, seed: 5, mounds: 1, rocks: 0, pits: 0, bumps: 0, whoops: 0, hills: 0, ramps: 0, puddles: 0, maxLevel: 0 });
  const m = t.mounds[0], q = t.samples[m.i], dir = Math.atan2(q.ty, q.tx);
  // Carril a 10 px del centro de la montaña (radio 11): el centro apenas la toca.
  const lat = m.lat + 10 * Math.sign(m.lat || 1) * -1;
  const from = { x: q.x - q.ty * lat - q.tx * 40, y: q.y + q.tx * lat - q.ty * 40 };
  const up = { tires: 0, shocks: 0, accel: 0, speed: 0 };
  const race = createRace({ track: t, trucks: [{ ai: false, up }], laps: 9, seed: 1 });
  race.state = 'racing';
  const a = race.trucks[0];
  a.x = from.x; a.y = from.y; a.a = dir; a.vx = Math.cos(dir) * 50; a.vy = Math.sin(dir) * 50; placeIdx(t, a);
  let maxG = 0, maxRoll = 0, centerMax = 0, sunk = 0;
  for (let i = 0; i < 90; i++) {
    step(race, 1 / 60, { steer: 0, gas: false, brake: false, nitro: false }); race.over = false;
    maxG = Math.max(maxG, a.g); maxRoll = Math.max(maxRoll, Math.abs(a.roll));
    centerMax = Math.max(centerMax, heightAt(t, a.x, a.y));
    // La carrocería va inclinada (plano de las ruedas): cada rueda se compara con su altura en
    // ese plano, no con el centro.
    const fx = Math.cos(a.a), fy = Math.sin(a.a), gr = groundAt(t, a.x, a.y, a.a);
    for (const [dl, dw] of [[7, 5], [7, -5], [-7, 5], [-7, -5]]) {
      const h = heightAt(t, a.x + fx * dl - fy * dw, a.y + fy * dl + fx * dw);
      const body = gr.h + Math.tan(gr.pitch) * dl + Math.tan(gr.roll) * dw;
      if (!a.air && h - body > 0.01) sunk = Math.max(sunk, h - body);
    }
  }
  assert.ok(centerMax < 2, `the lane should pass beside the mound, not over it (center height ${centerMax.toFixed(1)})`);
  assert.ok(maxG > centerMax + 0.5, `the body should ride up on the mound under its wheels (body ${maxG.toFixed(1)}, center ${centerMax.toFixed(1)})`);
  assert.ok(maxRoll > 0.15, `the truck should lean passing beside a mound (roll ${maxRoll.toFixed(2)})`);
  assert.equal(sunk, 0, `a wheel sank ${sunk.toFixed(2)} into the ground`);
}

// 2g. ATAJAR NO ES POSIBLE: una camioneta que aparece bastante por delante en la pista (voló una
//     valla, tomó el otro ramal de un cruce) vuelve a donde iba, y la vuelta no se pierde. Si
//     aparece por detrás, se sincroniza y sigue desde ahí.
{
  const node = allNodes()[0];
  const track = buildTrack(node.race);
  const DT = 1 / 60, n = track.n;
  const mk = () => {
    const race = createRace({ track, trucks: [{ ai: true, color: 'red', up: { tires: 1, shocks: 1, accel: 1, speed: 1 }, skill: 0.95, nitro: 0 }], laps: 3, seed: 1, grip: 1 });
    for (let k = 0; k < 60 * 6; k++) { race.over = false; step(race, DT, null); }
    return race;
  };
  const fwd = mk(), me = fwd.trucks[0];
  const idx0 = me.idx, lap0 = me.lap;
  assert.ok(idx0 > 20, `the truck should have advanced (idx ${idx0})`);
  const q = track.samples[(idx0 + 40) % n];
  me.x = q.x; me.y = q.y;
  let shortcut = 0;
  for (let k = 0; k < 60; k++) { fwd.over = false; step(fwd, DT, null); shortcut += fwd.events.filter(e => e.type === 'shortcut').length; fwd.events.length = 0; }
  assert.equal(shortcut, 1, 'jumping 40 samples ahead must be undone once');
  assert.ok(me.idx < idx0 + 12 && me.idx >= idx0 - 12, `after the shortcut the truck is back where it was (idx ${me.idx}, was ${idx0})`);
  assert.equal(me.lap, lap0, 'no lap is lost by a shortcut');
  // Y en una vuelta entera, ninguna máquina dispara el aviso sin motivo.
  const { race } = run(node, 1);
  assert.equal(race.events.filter(e => e.type === 'shortcut').length, 0);
  assert.ok(race.trucks.every(t => t.finished), 'all trucks finish');
  const back = mk(), me2 = back.trucks[0];
  const i2 = me2.idx, l2 = me2.lap, b = track.samples[(i2 - 40 + n) % n];
  me2.x = b.x; me2.y = b.y; me2.vx = me2.vy = 0;
  for (let k = 0; k < 60; k++) { back.over = false; step(back, DT, null); }
  assert.ok(back.events.every(e => e.type !== 'shortcut'), 'appearing behind is not a shortcut');
  assert.ok(Math.abs(me2.idx - (i2 - 40)) < 14, `the truck re-syncs behind (idx ${me2.idx}, expected ≈ ${i2 - 40})`);
  assert.equal(me2.lap, l2);
}

// 3. Determinista: misma semilla, mismo resultado.
const a = run(allNodes()[3], 1), b = run(allNodes()[3], 1);
assert.equal(a.steps, b.steps);
assert.deepEqual(a.race.trucks.map(t => t.place), b.race.trucks.map(t => t.place));

// 4. Las reglas del mapa: la primera abre sola, el jefe pide estrellas, el 4.º no completa.
const nodes = allNodes();
assert.ok(isUnlocked({ nodes: {} }, nodes[0].id));
assert.ok(!isUnlocked({ nodes: {} }, nodes[1].id));
assert.equal(starsForPlace(1), 3); assert.equal(starsForPlace(4), 0);
const p = { nodes: { n0: { done: true, stars: 1 }, n1: { done: true, stars: 1 }, n3: { done: true, stars: 1 } } };
assert.equal(totalStars(p), 3);
assert.ok(!isUnlocked(p, 'n5'), 'boss must stay locked below its star gate');
p.nodes.n0.stars = 3; p.nodes.n1.stars = 3;
assert.ok(isUnlocked(p, 'n5'));
assert.ok(prizeFor(nodes[5], 1) > prizeFor(nodes[0], 1));

console.log('sim ok');
