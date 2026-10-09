// Prueba de la lógica pura: en CADA carrera del mapa las cuatro camionetas (todas llevadas
// por la máquina) tienen que completar las vueltas sin atascarse, y la carrera tiene que ser
// determinista. Es lo que comprueba que un trazado nuevo se puede correr.
import assert from 'node:assert/strict';
import { buildTrack, distAt, LAYOUTS } from '../src/track.js';
import { createRace, step } from '../src/sim.js';
import { allNodes, rivalsFor, isUnlocked, totalStars, starsForPlace, prizeFor } from '../src/levels.js';

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
    const t = buildTrack({ layout: i, reversed, seed: 7 + i, bumps: 3, puddles: 3 });
    assert.ok(t.n > 120, `${t.name}: too short (${t.n})`);
    for (const s of t.samples) assert.ok(distAt(t, s.x, s.y) < 1.5, `${t.name}: sample off its own axis`);
    assert.equal(t.bumps.length, 3, `${t.name}: bumps`);
    assert.ok(t.ramps.length >= 1, `${t.name}${reversed ? ' rev' : ''}: no straight long enough for a ramp`);
    assert.ok(t.samples[0].curv < 0.45, `${t.name}: start line is not on a straight (${t.samples[0].curv.toFixed(2)})`);
  }
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
  console.log(`${node.id.padEnd(4)} ${race.track.name.padEnd(9)} ${node.race.reversed ? 'rev' : '   '} laps=${node.race.laps} total=${secs.toFixed(1)}s lap≈${lap.toFixed(1)}s resets=${resets} ramps=${race.track.ramps.length} air=${air.toFixed(2)}s order=${race.trucks.slice().sort((a, b) => a.place - b.place).map(t => t.color).join('>')}`);
}
assert.ok(worst < 26, `a lap takes too long (${worst.toFixed(1)}s)`);

// 2b. Entre camionetas la caja de choque es la mitad del dibujo (13 de largo): se solapan al
//     rozarse, pero no se atraviesan, y el choque se anuncia.
{
  const track = buildTrack(allNodes()[0].race);
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
