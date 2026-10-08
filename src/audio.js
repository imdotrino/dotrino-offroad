// Sonido sintetizado con Web Audio (sin archivos). El silencio es una preferencia de UI →
// localStorage (§4). El contexto se crea con el primer gesto del usuario, como exige el navegador.
const KEY = 'offroad.mute';
let ctx = null, engine = null, engineGain = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* modo privado */ }

export const isMuted = () => muted;
export function setMuted (m) {
  muted = !!m;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* modo privado */ }
  if (engineGain) engineGain.gain.value = 0;
}

function ac () {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
/** Llamar desde un gesto del usuario (tocar una carrera) para poder sonar después. */
export const unlock = () => { ac(); };

export function beep (freq = 440, dur = 0.12, type = 'square', vol = 0.06) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}

export function noise (dur = 0.15, vol = 0.08, cutoff = 900) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

/** Motor del jugador: un tono grave que sube con la velocidad. */
export function engineStart () {
  const c = ac(); if (!c || engine) return;
  engine = c.createOscillator(); engine.type = 'sawtooth';
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  engineGain = c.createGain(); engineGain.gain.value = 0;
  engine.connect(f).connect(engineGain).connect(c.destination);
  engine.start();
}
export function engineSet (speed, boost) {
  if (!engine || !ctx) return;
  engine.frequency.setTargetAtTime(48 + speed * 1.1 + (boost ? 40 : 0), ctx.currentTime, 0.05);
  engineGain.gain.setTargetAtTime(muted ? 0 : 0.022, ctx.currentTime, 0.05);
}
export function engineStop () {
  if (!engine) return;
  try { engine.stop(); } catch { /* ya parado */ }
  engine.disconnect(); engine = null; engineGain = null;
}
