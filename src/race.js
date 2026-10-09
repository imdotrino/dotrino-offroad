// Pantalla de carrera: lienzo + marcador + mandos (teclado y táctil). La simulación corre a
// paso fijo (sim.js); aquí solo se leen los mandos, se dibuja y se suena.
import { h } from './dom.js';
import { t } from './i18n.js';
import { buildTrack } from './track.js';
import { createRace, step, livePlace } from './sim.js';
import { paintTrack, drawRace, emitParticles, stepParticles, PALETTES, SW as W, SH as H } from './render.js';
import * as audio from './audio.js';

const DT = 1 / 60;
const ordinal = (n) => t('place' + n);

function fmtTime (s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}

/**
 * Arranca una carrera dentro de `host`.
 * @param {object} o
 * @param {HTMLElement} o.host
 * @param {object} o.spec      { layout, reversed, seed, bumps, puddles, grip, laps }
 * @param {string} o.region    clave de la región (paleta)
 * @param {Array} o.trucks     el jugador primero, luego los rivales
 * @param {object} o.sprites
 * @param {string} o.title
 * @param {(result:object)=>void} o.onEnd
 * @param {()=>void} o.onExit
 */
export function startRace ({ host, spec, region, trucks, sprites, title, onEnd, onExit }) {
  const track = buildTrack(spec);
  const bg = paintTrack(track, region);
  const dust = (PALETTES[region] || PALETTES.desert).dust;
  let race = null;
  const fx = { parts: [] };
  const newRace = () => { race = createRace({ track, trucks, laps: spec.laps, seed: spec.seed, grip: spec.grip }); fx.parts.length = 0; };
  newRace();

  // ---------- DOM ----------
  const cv = h('canvas', { class: 'race-canvas', width: W, height: H, 'data-testid': 'race-canvas' });
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const wrap = h('div', { class: 'race-wrap' }, cv);
  const hudPlace = h('b', { 'data-testid': 'hud-place' });
  const hudLap = h('b', { 'data-testid': 'hud-lap' });
  const hudNitro = h('b', { 'data-testid': 'hud-nitro' });
  const hudTime = h('b', { 'data-testid': 'hud-time' });
  const pauseBtn = h('button', { class: 'hud-btn', 'data-testid': 'pause-btn', 'aria-label': t('pause'), title: t('pause'), onclick: () => setPaused(true) }, '❚❚');
  const hud = h('div', { class: 'race-hud' },
    h('span', { class: 'hud-item' }, hudPlace),
    h('span', { class: 'hud-item' }, h('i', {}, t('lap')), hudLap),
    h('span', { class: 'hud-item nitro' }, h('i', {}, 'N'), hudNitro),
    h('span', { class: 'hud-item time' }, hudTime),
    pauseBtn,
  );
  const big = h('div', { class: 'race-big', 'data-testid': 'race-big' });
  const note = h('div', { class: 'race-note' });

  // Mandos táctiles: girar a la izquierda, y gas + nitro a la derecha.
  const input = { steer: 0, gas: false, brake: false, nitro: false };
  const held = { left: false, right: false, gas: false, brake: false, nitro: false };
  // Un toque de nitro más corto que un cuadro no se puede perder: queda apuntado hasta que
  // la simulación da un paso.
  let nitroTap = false;
  const sync = () => {
    input.steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    input.gas = held.gas; input.brake = held.brake; input.nitro = held.nitro || nitroTap;
  };
  const pad = (key, label, cls, aria) => {
    const b = h('button', { class: 'pad ' + cls, 'data-testid': 'pad-' + key, 'aria-label': aria }, label);
    const on = (e) => { e.preventDefault(); held[key] = true; if (key === 'nitro') nitroTap = true; b.classList.add('on'); sync(); try { b.setPointerCapture(e.pointerId); } catch { /* sin captura */ } };
    const off = (e) => { e.preventDefault(); held[key] = false; b.classList.remove('on'); sync(); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
    return b;
  };
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const pads = h('div', { class: 'race-pads' + (touch ? '' : ' hidden') },
    h('div', { class: 'pads-l' }, pad('left', '◀', 'steer', t('steerLeft')), pad('right', '▶', 'steer', t('steerRight'))),
    h('div', { class: 'pads-r' }, pad('nitro', 'N', 'nitro', t('nitro')), pad('gas', t('gas'), 'gas', t('gas'))),
  );

  // Pausa
  const menu = h('div', { class: 'overlay race-menu hidden', 'data-testid': 'pause-menu' },
    h('div', { class: 'modal' },
      h('h2', {}, t('paused')),
      h('p', {}, title),
      h('button', { class: 'btn primary block', 'data-testid': 'resume-btn', onclick: () => setPaused(false) }, t('resume')),
      h('button', { class: 'btn block', 'data-testid': 'restart-btn', onclick: () => { newRace(); ended = false; note.classList.remove('gone'); setPaused(false); } }, t('restart')),
      h('button', { class: 'btn block', 'data-testid': 'mute-btn', onclick: (e) => { audio.setMuted(!audio.isMuted()); e.currentTarget.textContent = audio.isMuted() ? t('soundOff') : t('soundOn'); } }, audio.isMuted() ? t('soundOff') : t('soundOn')),
      h('button', { class: 'btn block', 'data-testid': 'exit-btn', onclick: () => { destroy(); onExit(); } }, t('exitRace')),
    ));

  const stage = h('div', { class: 'race-stage' + (touch ? ' touch' : '') }, hud, wrap, big, note, pads, menu);
  host.append(stage);

  // ---------- Tamaño: la pista siempre entera y sin girar (la perspectiva tiene un "arriba"). ----------
  // En vertical queda a lo ancho, con los mandos DEBAJO; en horizontal, los mandos van encima
  // de sus esquinas.
  function layout () {
    const portrait = stage.clientHeight > stage.clientWidth * 1.1;
    const vw = stage.clientWidth, vh = stage.clientHeight - hud.offsetHeight - (touch && portrait ? 118 : 0);
    const s = Math.min(vw / W, vh / H);
    wrap.style.width = cv.style.width = W * s + 'px';
    wrap.style.height = cv.style.height = H * s + 'px';
    stage.classList.toggle('portrait', portrait);
    if (!race || race.state === 'countdown') note.textContent = (touch ? t('helpTouch') : t('helpKeys')) + (touch && portrait ? ' · ' + t('rotateHint') : '');
  }
  window.addEventListener('resize', layout);
  layout();

  // ---------- Teclado ----------
  const KEYS = {
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake',
    ' ': 'nitro', Shift: 'nitro', n: 'nitro', N: 'nitro',
  };
  const onKey = (down) => (e) => {
    if (down && (e.key === 'Escape' || e.key === 'p' || e.key === 'P')) { if (!ended) setPaused(!paused); return; }
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    held[k] = down; if (down && k === 'nitro') nitroTap = true; sync();
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  const onHide = () => { if (document.hidden && !ended) setPaused(true); };
  document.addEventListener('visibilitychange', onHide);

  // ---------- Bucle ----------
  let paused = false, ended = false, alive = true, raf = 0, last = 0, acc = 0, clock = 0, shownGo = 0;
  function setPaused (p) {
    paused = p;
    menu.classList.toggle('hidden', !p);
    if (p) audio.engineSet(0, false);
    last = 0;
  }
  function sounds () {
    for (const ev of race.events) {
      const mine = ev.k === 0;
      if (ev.type === 'beep') audio.beep(440, 0.14);
      else if (ev.type === 'go') { audio.beep(880, 0.4); shownGo = 0.9; note.classList.add('gone'); }
      else if (ev.type === 'nitro' && mine) audio.noise(0.5, 0.09, 2400);
      else if (ev.type === 'land' && mine) audio.noise(0.1, 0.07, 500);
      else if (ev.type === 'hit' && mine) audio.noise(0.12, 0.08, 800);
      else if (ev.type === 'pickup' && mine) { audio.beep(660, 0.08); setTimeout(() => audio.beep(990, 0.12), 80); }
      else if (ev.type === 'lap' && mine) audio.beep(520, 0.1, 'triangle');
    }
    race.events.length = 0;
  }
  function paintHud () {
    const me = race.trucks[0];
    hudPlace.textContent = ordinal(livePlace(race, 0));
    hudLap.textContent = Math.min(spec.laps, Math.max(1, me.lap + 1)) + '/' + spec.laps;
    hudNitro.textContent = String(me.nitro);
    hudTime.textContent = fmtTime(race.t);
    if (race.state === 'countdown') big.textContent = String(Math.max(1, Math.ceil(race.countdown - 0.2)));
    else if (shownGo > 0) big.textContent = t('go');
    else if (race.over) big.textContent = t('finish');
    else big.textContent = '';
  }
  function finish () {
    ended = true;
    audio.engineStop();
    const me = race.trucks[0];
    setTimeout(() => {
      if (!alive) return;
      big.classList.add('hidden');      // el resultado va encima; el rótulo de meta ya cumplió
      onEnd({ place: me.place, timeMs: Math.round(race.t * 1000), bestLapMs: Math.round(me.bestLap * 1000), nitroLeft: me.nitro, cash: me.cash });
    }, 1300);
  }
  function frame (now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!last) { last = now; return; }
    const el = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      clock += el; acc += el;
      if (shownGo > 0) shownGo -= el;
      while (acc >= DT) {
        if (!race.over) step(race, DT, input);
        if (nitroTap && race.state === 'racing') { nitroTap = false; sync(); }
        stepParticles(fx, DT);
        acc -= DT;
      }
      if (!race.over) emitParticles(race, fx, dust);
      sounds();
      const me = race.trucks[0];
      if (race.state === 'racing') audio.engineSet(Math.hypot(me.vx, me.vy), me.nitroT > 0);
      if (race.over && !ended) finish();
    }
    drawRace(ctx, bg, race, sprites, fx, clock);
    paintHud();
  }
  audio.engineStart();
  raf = requestAnimationFrame(frame);

  function destroy () {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    audio.engineStop();
    window.removeEventListener('resize', layout);
    window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
    document.removeEventListener('visibilitychange', onHide);
    stage.remove();
  }

  return {
    destroy,
    pause: () => setPaused(true),
    // Solo para las pruebas E2E: estado de la carrera y forzar el final.
    get race () { return race; },
    input: held, sync,
    forceFinish (place) {
      const me = race.trucks[0];
      const order = race.trucks.filter(x => x !== me);
      order.splice(place - 1, 0, me);
      order.forEach((x, i) => { x.finished = true; x.place = i + 1; });
      race.over = true; race.state = 'over';
    },
  };
}
