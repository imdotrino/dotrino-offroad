// Mapa del campeonato (CONVENCIONES-APPS §12): un GRAFO de carreras con caminos que se
// bifurcan y convergen en un JEFE por región; las ESTRELLAS son la llave de jefes y regiones.
// Mismo esquema que el mapa de dotrino-sudoku: entrada → dos ramas paralelas → jefe.
// Cada nodo es determinista (trazado + sentido + semilla): la misma carrera para todos, y por
// eso se puede compartir por #fragment.

// Región: terreno, agarre, obstáculos y puertas de estrellas (entrar / jefe).
// `rows` son las seis carreras [entrada, izq1, der1, izq2, der2, jefe] como [trazado, alRevés].
const REGIONS = [
  { key: 'desert', hills: 1, grip: 1, ramps: 1, bumps: 1, puddles: 1, gate: 0, bossGate: 6,
    rows: [[6, 0], [0, 0], [3, 0], [4, 0], [2, 0], [1, 0]] },
  { key: 'forest', hills: 1, grip: 0.95, ramps: 1, bumps: 2, puddles: 3, gate: 9, bossGate: 20,
    rows: [[3, 1], [5, 0], [7, 0], [0, 1], [6, 1], [5, 0]] },
  { key: 'snow', hills: 2, grip: 0.7, ramps: 2, bumps: 2, puddles: 2, gate: 24, bossGate: 38,
    rows: [[4, 1], [1, 1], [2, 0], [7, 1], [5, 1], [1, 1]] },
  { key: 'volcano', hills: 2, grip: 0.9, ramps: 2, bumps: 2, puddles: 4, gate: 44, bossGate: 60,
    rows: [[0, 0], [7, 0], [5, 0], [1, 0], [2, 1], [5, 1]] },
];

// Obstáculos por región: cada una añade más que la anterior.
// `rampObs`: cuántos obstáculos lleva cada rampa (zanja tras el borde, puerta de rocas en la
// subida, ondulado antes, cráter en el aterrizaje; ver RAMP_MENU en track.js).
const OBSTACLES = {
  desert: { pits: 2, maxLevel: 1, rocks: 4, mounds: 4, whoops: 1, puddles: 4, rampObs: 1 },
  forest: { pits: 3, maxLevel: 2, rocks: 5, mounds: 4, whoops: 2, puddles: 5, rampObs: 1 },
  snow: { pits: 2, maxLevel: 3, rocks: 5, mounds: 5, whoops: 2, puddles: 5, rampObs: 2 },
  volcano: { pits: 3, maxLevel: 3, rocks: 7, mounds: 5, whoops: 3, puddles: 7, rampObs: 2 },
};

const seedFor = (idx) => (200003 + idx * 7919) >>> 0;

function build () {
  const nodes = [];
  let idx = 0, row = 0, prevBoss = null;
  const mk = (type, ri, slot, x, requires, requireMode, gate, depth) => {
    const reg = REGIONS[ri];
    const [layout, reversed] = reg.rows[slot];
    const boss = type === 'boss';
    // La primera carrera es un óvalo y los jefes corren en trazados con cruce; el resto son
    // pistas por piezas, cada vez con más casillas (más curvas).
    const made = !boss && idx !== 0;
    const n = {
      id: 'n' + idx, type, region: ri, x, row, requires, requireMode, gate,
      label: boss ? 0 : depth + 1,
      race: {
        layout: made ? undefined : layout, size: 3 + ri + (idx % 2),
        // La primera región va sin cruces; las chicanas aparecen desde el principio.
        cross: ri === 0 ? 0 : 0.6, chicane: 0.35 + ri * 0.1, reversed: made ? idx % 3 === 0 : !!reversed, seed: seedFor(idx),
        bumps: reg.bumps + (boss ? 1 : 0), ...OBSTACLES[reg.key],
        hills: reg.hills, ramps: reg.ramps, grip: reg.grip, laps: boss ? 4 : 3,
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

/**
 * El modo SIN FIN: una carrera por ronda en una pista por piezas (cada semilla es una pista
 * distinta). Los rivales salen por DELANTE del taller del jugador, y cada ronda más: el
 * taller no tiene tope, pero la dificultad sube en mayor proporción. El podio pasa de ronda;
 * el 4.º puesto vuelve a la primera. No da estrellas; sí premio, que crece con la ronda.
 */
export const ENDLESS_LEAD = 1.15;    // los rivales van un 15 % por delante del taller…
export const ENDLESS_STEP = 0.45;    // …y cada ronda suma esto (una mejora cuesta 40.000 + 30.000·nivel)
export function randomNode (seed, up, round = 0) {
  const s = seed >>> 0, r = Math.max(0, round | 0);
  // Las primeras rondas recorren las regiones en orden (cada una con más obstáculos); después
  // la decide la semilla.
  const ri = r < 8 ? Math.min(REGIONS.length - 1, r >> 1) : s % REGIONS.length, reg = REGIONS[ri];
  const level = (up.tires + up.shocks + up.accel + up.speed) / 4;
  const rivalLevel = level * ENDLESS_LEAD + r * ENDLESS_STEP;
  return {
    id: 't' + s, type: 'random', region: ri, round: r, label: 0, requires: [], gate: 0,
    prizeRegion: Math.min(REGIONS.length - 1, r >> 1),
    skill: Math.min(0.99, 0.9 + r * 0.006),
    race: {
      layout: undefined, size: 3 + (s >>> 3) % 5, reversed: !!((s >>> 2) & 1), seed: s,
      bumps: reg.bumps + (r >> 2), ...OBSTACLES[reg.key],
      hills: reg.hills, ramps: reg.ramps, grip: reg.grip, laps: 3, level: rivalLevel, boss: false,
    },
  };
}
/** Premio de una ronda sin fin: la mitad del de una carrera del mapa, y un 35 % más por ronda. */
export const randomPrize = (node, place) => Math.round(([0, 100000, 60000, 35000, 10000][place] || 0) * 0.5 * (1 + 0.35 * node.round) / 1000) * 1000;

// --- Economía ---
export const UPGRADES = ['tires', 'shocks', 'accel', 'speed'];
// Las mejoras no tienen tope: cada nivel cuesta más (upgradePrice) y suma lo mismo.
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
  const endless = node.type === 'random';
  // En el campeonato las máquinas tienen techo; en el sin fin, no.
  const lv = (x) => Math.max(0, endless ? x : Math.min(6.5, x));
  const up = (x) => ({ tires: lv(x), shocks: lv(x), accel: lv(x), speed: lv(x) });
  // La primera carrera es para aprender a manejar, y la primera región va con calma.
  const ease = node.id === 'n0' ? 0.09 : node.region === 0 && !node.race.boss && !endless ? 0.04 : 0;
  const base = endless ? node.skill : 0.94;
  const nitro = endless ? 1 + (node.round >> 1) : node.region;
  return [
    { ai: true, color: 'blue', up: up(L - 0.5), skill: base - 0.01 - ease, nitro: 1 + nitro },
    { ai: true, color: 'yellow', up: up(L), skill: base - ease, nitro: 2 + nitro },
    node.race.boss
      ? { ai: true, color: 'black', boss: true, up: up(L + 0.7), skill: 0.98, nitro: 4 + nitro }
      : { ai: true, color: 'white', up: up(L + 0.4), skill: base + 0.01 - ease, nitro: 2 + nitro },
  ];
}
