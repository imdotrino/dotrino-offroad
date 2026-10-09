// Mapa del campeonato (CONVENCIONES-APPS §12): un GRAFO de carreras con caminos que se
// bifurcan y convergen en un JEFE por región; las ESTRELLAS son la llave de jefes y regiones.
// Mismo esquema que el mapa de dotrino-sudoku: entrada → dos ramas paralelas → jefe.
// Cada nodo es determinista (trazado + sentido + semilla): la misma carrera para todos, y por
// eso se puede compartir por #fragment.

// Región: terreno, agarre, obstáculos y puertas de estrellas (entrar / jefe).
// `rows` son las seis carreras [entrada, izq1, der1, izq2, der2, jefe] como [trazado, alRevés].
const REGIONS = [
  { key: 'desert', hills: 1, grip: 1, bumps: 2, puddles: 1, gate: 0, bossGate: 6,
    rows: [[6, 0], [0, 0], [3, 0], [4, 0], [2, 0], [1, 0]] },
  { key: 'forest', hills: 1, grip: 0.95, bumps: 3, puddles: 3, gate: 9, bossGate: 20,
    rows: [[3, 1], [5, 0], [7, 0], [0, 1], [6, 1], [2, 1]] },
  { key: 'snow', hills: 2, grip: 0.7, bumps: 3, puddles: 2, gate: 24, bossGate: 38,
    rows: [[4, 1], [1, 1], [2, 0], [7, 1], [5, 1], [3, 0]] },
  { key: 'volcano', hills: 2, grip: 0.9, bumps: 4, puddles: 4, gate: 44, bossGate: 60,
    rows: [[0, 0], [7, 0], [5, 0], [1, 0], [2, 1], [5, 1]] },
];

const seedFor = (idx) => (200003 + idx * 7919) >>> 0;

function build () {
  const nodes = [];
  let idx = 0, row = 0, prevBoss = null;
  const mk = (type, ri, slot, x, requires, requireMode, gate, depth) => {
    const reg = REGIONS[ri];
    const [layout, reversed] = reg.rows[slot];
    const boss = type === 'boss';
    const n = {
      id: 'n' + idx, type, region: ri, x, row, requires, requireMode, gate,
      label: boss ? 0 : depth + 1,
      race: {
        layout, reversed: !!reversed, seed: seedFor(idx),
        bumps: reg.bumps + (boss ? 1 : 0), puddles: reg.puddles + (boss ? 1 : 0),
        hills: reg.hills, grip: reg.grip, laps: boss ? 4 : 3,
        // Nivel de las máquinas (escala 0..6 de las mejoras).
        level: ri * 1.4 + depth * 0.35 + (boss ? 1.1 : 0),
        boss,
      },
    };
    nodes.push(n); idx++;
    return n;
  };

  REGIONS.forEach((reg, ri) => {
    const entry = mk('normal', ri, 0, 0.5, prevBoss ? [prevBoss] : [], 'all', reg.gate, 0); row++;
    const L1 = mk('normal', ri, 1, 0.24, [entry.id], 'all', 0, 1);
    const R1 = mk('normal', ri, 2, 0.76, [entry.id], 'all', 0, 1); row++;
    const L2 = mk('normal', ri, 3, 0.24, [L1.id], 'all', 0, 2);
    const R2 = mk('normal', ri, 4, 0.76, [R1.id], 'all', 0, 2); row++;
    // El jefe une las dos ramas: basta despejar UNA, pero la otra da más estrellas.
    const boss = mk('boss', ri, 5, 0.5, [L2.id, R2.id], 'any', reg.bossGate, 2); row++;
    prevBoss = boss.id;
  });

  return { nodes, byId: Object.fromEntries(nodes.map(n => [n.id, n])), maxRow: row, regions: REGIONS };
}

const MAP = build();

export const allNodes = () => MAP.nodes;
export const nodeById = (id) => MAP.byId[id] || null;
export const maxRow = () => MAP.maxRow;
export const regions = () => MAP.regions;
export const regionKey = (ri) => MAP.regions[ri]?.key;

export function edges () {
  const out = [];
  for (const n of MAP.nodes) for (const req of n.requires) out.push([req, n.id]);
  return out;
}

// --- Progreso ---
// progress.nodes = { [nodeId]: { done, stars:0..3, bestMs, shared } }

export const nodeStars = (progress, id) => progress?.nodes?.[id]?.stars || 0;
export const isDone = (progress, id) => !!progress?.nodes?.[id]?.done;
export function totalStars (progress) {
  let s = 0;
  for (const n of MAP.nodes) s += nodeStars(progress, n.id);
  return s;
}
export const maxStars = () => MAP.nodes.length * 3;

/** Estrellas por puesto: 1.º → 3, 2.º → 2, 3.º → 1. El 4.º no completa la carrera. */
export const starsForPlace = (place) => (place >= 1 && place <= 3 ? 4 - place : 0);

export function isUnlocked (progress, id) {
  const n = nodeById(id);
  if (!n) return false;
  if (n.gate && totalStars(progress) < n.gate) return false;
  if (!n.requires.length) return true;
  const done = (rid) => isDone(progress, rid);
  return n.requireMode === 'any' ? n.requires.some(done) : n.requires.every(done);
}

export function starsMissing (progress, id) {
  const n = nodeById(id);
  if (!n || !n.gate) return 0;
  return Math.max(0, n.gate - totalStars(progress));
}

export function nextNodeId (progress) {
  for (const n of MAP.nodes) if (!isDone(progress, n.id) && isUnlocked(progress, n.id)) return n.id;
  return null;
}

export function followingNodeId (progress, id) {
  for (const n of MAP.nodes) {
    if (n.requires.includes(id) && isUnlocked(progress, n.id) && !isDone(progress, n.id)) return n.id;
  }
  return nextNodeId(progress);
}

// --- Economía ---
export const UPGRADES = ['tires', 'shocks', 'accel', 'speed'];
export const MAX_UP = 6;
export const NITRO_PRICE = 8000;
export const START = { money: 60000, nitro: 5, up: { tires: 0, shocks: 0, accel: 0, speed: 0 } };

export const upgradePrice = (level) => 40000 + 30000 * level;

/** Premio por puesto en una carrera. */
export function prizeFor (node, place) {
  const base = [0, 100000, 60000, 35000, 10000][place] || 0;
  const mult = (1 + 0.6 * node.region) * (node.type === 'boss' ? 1.5 : 1);
  return Math.round(base * mult / 1000) * 1000;
}
export const cashPickupValue = (node) => 5000 * (node.region + 1);

/** Los tres rivales de una carrera. El jefe corre de negro y casi no falla. */
export function rivalsFor (node) {
  const L = node.race.level;
  const lv = (x) => Math.max(0, Math.min(6.5, x));
  const up = (x) => ({ tires: lv(x), shocks: lv(x), accel: lv(x), speed: lv(x) });
  return [
    { ai: true, color: 'blue', up: up(L - 0.5), skill: 0.93, nitro: 1 + node.region },
    { ai: true, color: 'yellow', up: up(L), skill: 0.94, nitro: 2 + node.region },
    node.race.boss
      ? { ai: true, color: 'black', boss: true, up: up(L + 0.7), skill: 0.98, nitro: 4 + node.region }
      : { ai: true, color: 'white', up: up(L + 0.4), skill: 0.95, nitro: 2 + node.region },
  ];
}
