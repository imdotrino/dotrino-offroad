// Prueba de la lógica pura: en CADA carrera del mapa las cuatro camionetas (todas llevadas
// por la máquina) tienen que completar las vueltas sin atascarse, y la carrera tiene que ser
// determinista. Es lo que comprueba que un trazado nuevo se puede correr.
import assert from 'node:assert/strict';
import { buildTrack, distAt, generateLayout, LAYOUTS, W, H } from '../src/track.js';
import { createRace, step } from '../src/sim.js';
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
    for (const s of t.samples) assert.ok(distAt(t, s.x, s.y) < 14, `${t.name}: racing line strays from the track axis`);
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
  const track = buildTrack({ layout: 6, seed: 1, bumps: 0, puddles: 0, rocks: 0, mounds: 0, whoops: 0, hills: 0, ramps: 0 });   // pista lisa
  const up = { tires: 0, shocks: 0, accel: 0, speed: 0 };
  const race = createRace({ track, trucks: [{ ai: false, up }, { ai: false, up }], laps: 3, seed: 1 });
  race.state = 'racing';
  const [a, b] = race.trucks, s0 = track.samples[track.n - 12];
  a.x = s0.x - 12; a.y = s0.y; a.vx = 60; a.vy = 0; a.a = 0;
  b.x = s0.x + 12; b.y = s0.y; b.vx = -60; b.vy = 0; b.a = Math.PI;
  for (const t of [a, b]) { t.g = t.alt = 0; t.rate = 0; }
  let closest = 99, crashed = false, bounced = false;
  for (let i = 0; i < 40; i++) {
    step(race, 1 / 60, { steer: 0, gas: false, brake: false, nitro: false });
    race.over = false;
    closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    if (race.events.some(e => e.type === 'crash')) { crashed = true; bounced = a.vx < 0 && b.vx > 0; }
    race.events.length = 0;
  }
  assert.ok(closest < 9 && closest > 5, `trucks should overlap about half their length, got ${closest.toFixed(1)}`);
  assert.ok(crashed, 'a head-on hit must raise a crash event');
  assert.ok(bounced, 'trucks must bounce back');
}

// 2c. Una roca es sólida: la camioneta que va de frente no la atraviesa.
{
  const track = buildTrack({ layout: 6, seed: 3, bumps: 0, puddles: 0, rocks: 1, mounds: 0, whoops: 0, hills: 0, ramps: 0 });
  const up = { tires: 0, shocks: 0, accel: 0, speed: 0 };
  const race = createRace({ track, trucks: [{ ai: false, up }], laps: 3, seed: 1 });
  race.state = 'racing';
  const [a] = race.trucks, r = track.rocks[0];
  a.x = r.x - 20; a.y = r.y; a.vx = 70; a.vy = 0; a.a = 0;
  let closest = 99;
  for (let i = 0; i < 30; i++) {
    step(race, 1 / 60, { steer: 0, gas: true, brake: false, nitro: false });
    race.over = false;
    closest = Math.min(closest, Math.hypot(a.x - r.x, a.y - r.y));
  }
  assert.ok(closest >= r.r + 2.9, `truck went through a rock (${closest.toFixed(1)} < ${(r.r + 3).toFixed(1)})`);
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
