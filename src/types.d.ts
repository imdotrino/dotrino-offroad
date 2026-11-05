// Formas de datos que se repiten en Offroad (pista, carrera, campeonato).
// Las de la pista que salen de buildTrack() se derivan de su código: `Track` en track.js.

/** Un punto [x, y] (en el cuadro unidad o en píxeles del mundo, según dónde). */
export type Pt = number[]

/** Muestra del eje de la pista: posición, tangente y curvatura de lo que viene. */
export interface Sample {
  x: number
  y: number
  tx: number
  ty: number
  curv: number
}

/** Un trazado: dibujado a mano (LAYOUTS) o generado por piezas (generateLayout). */
export interface Layout {
  name: string
  pts: Pt[] & { crossed?: boolean, chicanes?: number }
}

export type RampFx = 'gap' | 'gate' | 'whoops' | 'crater'

/** Lo que pide una carrera a buildTrack() y a createRace() (levels.js lo arma por nodo). */
export interface TrackSpec {
  layout?: number
  size?: number
  cross?: number
  chicane?: number
  reversed?: boolean
  seed: number
  bumps?: number
  puddles?: number
  hills?: number
  ramps?: number
  rampObs?: number
  rampMenu?: RampFx[]
  whoops?: number
  mounds?: number
  rocks?: number
  pits?: number
  maxLevel?: number
}

export interface RaceSpec extends TrackSpec {
  grip: number
  laps: number
  /** Nivel de las máquinas (escala de las mejoras). */
  level: number
  boss: boolean
}

export interface Rock { x: number, y: number, r: number, i: number, lat: number, gate?: boolean }
export interface Puddle { x: number, y: number, r: number, i: number }
export interface Hill { i: number, h: number, s: number }
export interface Mound { i: number, lat: number, h: number }

export type PitType = 'trench' | 'crater' | 'hole'
/** Un hueco con su máscara de profundidad por píxel (`dep`, de w×h desde x0,y0). */
export interface Pit {
  type: PitType
  x: number
  y: number
  rx: number
  ry: number
  d: number
  x0: number
  y0: number
  w: number
  h: number
  dep: Float32Array
  /** Píxeles que llegan al fondo: 0 = no le cupo. */
  floor: number
  i: number
  lat: number
}

// ---- Camionetas y carrera (sim.js) ----

export interface Upgrades {
  tires: number
  shocks: number
  accel: number
  speed: number
}

export type TruckColor = 'red' | 'blue' | 'yellow' | 'white' | 'black'

/** Lo que entra en la parrilla: el jugador primero, luego los rivales. */
export interface TruckSetup {
  up: Upgrades
  ai: boolean
  skill?: number
  nitro?: number
  color?: TruckColor
  boss?: boolean
}

export interface TruckStats {
  accel: number
  top: number
  grip: number
  shocks: number
  tires: number
}

export interface Truck {
  k: number
  ai: boolean
  color: TruckColor
  boss: boolean
  stats: TruckStats
  skill: number
  x: number
  y: number
  a: number
  vx: number
  vy: number
  g: number
  gc: number
  alt: number
  z: number
  vz: number
  rate: number
  climb: number
  air: boolean
  airT: number
  airMax: number
  pitch: number
  roll: number
  pitchV: number
  rollV: number
  idx: number
  lap: number
  progress: number
  nitro: number
  nitroT: number
  nitroHeld: boolean
  mud: boolean
  finished: boolean
  finishT: number
  place: number
  cash: number
  lane: number
  laneT: number
  stuckT: number
  offT: number
  bestProgress: number
  lapStart: number
  bestLap: number
  /** Chocó contra un muro entre pisos en este paso (lo pone stepTruck). */
  walled?: boolean
  /** Segundos trabado contra una pared (solo el jugador). */
  jamT?: number
}

/** Los mandos de una camioneta en un paso. */
export interface Controls {
  steer: number
  gas: boolean
  brake: boolean
  nitro: boolean
}

export type RaceEvent =
  | { type: 'nitro' | 'hit' | 'jump' | 'land' | 'shortcut', k: number }
  | { type: 'lap', k: number, lap: number }
  | { type: 'finish', k: number, place: number }
  | { type: 'crash', k: number, j: number, x: number, y: number, z: number, force: number }
  | { type: 'pickup', k: number, what: 'nitro' | 'cash' }
  | { type: 'beep', n: number }
  | { type: 'go' }

export interface Pickup { type: 'nitro' | 'cash', x: number, y: number, ttl: number }

// ---- Campeonato (levels.js) ----

interface NodeBase {
  id: string
  region: number
  requires: string[]
  gate: number
  label: number
  race: RaceSpec
}

/** Una carrera del mapa del campeonato. */
export interface CampaignNode extends NodeBase {
  type: 'normal' | 'boss'
  x: number
  row: number
  requireMode: 'all' | 'any'
}

/** Una ronda del modo sin fin (randomNode). */
export interface EndlessNode extends NodeBase {
  type: 'random'
  round: number
  prizeRegion: number
  skill: number
}

export type MapNode = CampaignNode | EndlessNode

export interface NodeProgress {
  done?: boolean
  stars?: number
  bestMs?: number
  shared?: boolean
}

/** El avance del campeonato tal como se guarda (store.js). */
export interface Progress {
  nodes: Record<string, NodeProgress>
  money: number
  nitro: number
  up: Upgrades
  /** Modo sin fin: ronda en curso y la mejor alcanzada. */
  endless: { round: number, best: number }
}

declare global {
  interface Window {
    /** Safari viejo: el AudioContext con prefijo. */
    webkitAudioContext?: typeof AudioContext
  }
  /** Solo en las pruebas E2E (tests/): una bóveda falsa, porque en localhost id.dotrino.com no contesta. */
  var __TEST_VAULT_PROMISE__: Promise<import('@dotrino/identity').Identity | null> | undefined
}

/** Lo que una carrera le cuenta a quien la arrancó al terminar (race.js → main.js). */
export interface RaceResult {
  place: number
  timeMs: number
  bestLapMs: number
  nitroLeft: number
  cash: number
}

declare global {
  interface Window {
    /** Asidero de las pruebas E2E (src/main.js). */
    __offroad?: {
      readonly progress: Progress
      readonly view: 'map' | 'garage' | 'race'
      readonly race: ReturnType<typeof import('./race.js').startRace> | undefined
      setProgress (p: Progress): void
    }
  }
}
