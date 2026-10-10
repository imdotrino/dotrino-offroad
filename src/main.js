import './style.css';
import { h, clear } from './dom.js';
import { t, getLang, setLang, fmtMoney } from './i18n.js';
import { loadProgress, saveProgress, onStoreProblem, storeHandle } from './store.js';
import {
  allNodes, nodeById, edges, maxRow, regionKey, regions, totalStars, maxStars, nodeStars, isDone,
  isUnlocked, starsMissing, nextNodeId, followingNodeId, starsForPlace, prizeFor,
  cashPickupValue, rivalsFor, randomNode, randomPrize, UPGRADES, NITRO_PRICE, START, upgradePrice,
} from './levels.js';
import { startRace } from './race.js';
import { makeSprites, truckIcon, paintMap, pixelArt, trackThumb } from './render.js';
import { trackOutline } from './track.js';
import * as audio from './audio.js';
import { getIdentity } from './services/identity.js';
import { getReputation } from './services/reputation.js';
import { createBackNav } from '@dotrino/nav';
import '@dotrino/install';
import '@dotrino/share';
import '@dotrino/topbar';    // barra superior estándar del ecosistema (§5)

const SVG = (p, fill) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="${fill || 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const IC = {
  star: SVG('<path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 9.5l6.9-.6z"/>', 'currentColor'),
  dice: SVG('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  lock: SVG('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'),
  crown: SVG('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>', 'currentColor'),
  share: SVG('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
  wrench: SVG('<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/>'),
};

// ---------- Estado ----------
const app = document.getElementById('app');
const screen = h('div', { class: 'screen' });
const toastEl = h('div', { class: 'toast', role: 'status' });
const sprites = makeSprites();

// El controlador de "volver" se crea ANTES del topbar: el componente instala el suyo solo si
// no hay ninguno, y dos controladores se pelean el botón físico.
const nav = createBackNav();

// ---------- Topbar estándar del ecosistema (§5 / §6 / §6.1 / §9) ----------
const topbar = h('dotrino-topbar', {
  brand: t('brand'), icon: 'icon.svg', 'brand-href': './', lang: getLang(),
  home: 'https://dotrino.com', profile: true,
  'support-href': 'https://ko-fi.com/dotrino',
  'support-repo': 'imdotrino/dotrino-offroad',
  'support-discord': 'https://discord.gg/D648uq7cth',
});
const installBtn = h('dotrino-install', { slot: 'end', class: 'cc-install sm', 'data-testid': 'install-btn', lang: getLang() });
topbar.append(installBtn);
const shareEl = h('dotrino-share', { lang: getLang() });
shareEl.addEventListener('cc-share-close', () => { shareEl.open = false; });
shareEl.addEventListener('cc-share-shared', onShared);
clear(app).append(topbar, screen, toastEl, shareEl);

topbar.profileTheme = {
  '--ccp-bg': '#1d1712', '--ccp-bg-2': '#261e17', '--ccp-bg-3': '#30261d', '--ccp-bg-4': '#3d3024',
  '--ccp-border': '#3d3024', '--ccp-text': '#f6ecdf', '--ccp-muted': '#b09c86',
  '--ccp-accent': '#f08a24', '--ccp-accent-2': '#ffab4d', '--ccp-accent-text': '#1d1712',
  '--ccp-gold': '#fbbf24', '--ccp-derived': '#fcd34d',
  '--ccp-online': '#34d399', '--ccp-affinity': '#ffab4d', '--ccp-input-bg': '#16110d',
  '--ccp-radius': '14px',
};

(async () => {
  const id = await getIdentity();
  if (!id) return;
  topbar.identity = id;
  storeHandle().then(s => { if (s) topbar.store = s; }).catch(e => console.error('[offroad] store handle failed', e));
  const rep = await getReputation();
  if (rep) topbar.reputation = rep;
})();

// El idioma lo manda el topbar (§9): la app solo reacciona.
topbar.addEventListener('dotrino-lang', (e) => {
  const l = e.detail && e.detail.lang === 'en' ? 'en' : 'es';
  setLang(l);
  topbar.setAttribute('lang', l);
  installBtn.setAttribute('lang', l);
  shareEl.lang = l;
  if (view === 'garage') renderGarage(); else if (view === 'map') renderMap();
});

/** Avance: { nodes:{[id]:{done,stars,bestMs,shared}}, money, nitro, up:{tires,shocks,accel,speed} } */
let progress = { nodes: {}, money: START.money, nitro: START.nitro, up: { ...START.up }, endless: { round: 0, best: 0 } };
let view = 'map';              // 'map' | 'garage' | 'race'
let current = null;            // carrera en curso: { node, shared, handle }
let layer = null;              // capa de "volver" abierta (carrera o taller)
let shareNodeId = null;        // carrera que se está compartiendo (para la recompensa)

let toastTimer = 0;
function showToast (msg, ms = 2600) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}
onStoreProblem(() => showToast('⚠ ' + t('storeProblem'), 8000));

function persist () {
  saveProgress(progress).catch(e => { console.error('[offroad] could not save progress', e); showToast('⚠ ' + t('storeProblem'), 6000); });
}
function closeLayer () { if (layer) { const l = layer; layer = null; l.close(); } }
function fmtTime (ms) {
  const s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}
const starRow = (n, cls) => {
  const row = h('div', { class: cls });
  for (let k = 1; k <= 3; k++) row.append(h('span', { class: 'ns' + (k <= n ? ' on' : ''), html: IC.star }));
  return row;
};

// =====================================================================
//  Mapa
// =====================================================================
// El mapa se dibuja como la carrera: terreno de píxeles por región (desierto abajo, bosque,
// nieve y volcán hacia arriba), caminos de tierra entre carreras y una casilla biselada con la
// miniatura del trazado por carrera, como la «start next race» del original.
const MAP_W = 324, ROW_H = 102, PAD_Y = 60, SCALE = 3, T_NORM = 58, T_BOSS = 70;
const PX = {
  lock: { rows: ['.kkk.', 'k...k', 'k...k', 'ggggg', 'gyyyg', 'gyyyg', 'ggggg'], colors: { k: '#1d1206', g: '#8a6a40', y: '#1d1206' } },
  crown: { rows: ['y...y...y', 'yy.yyy.yy', 'yyyyyyyyy', 'yyyyyyyyy', '.yyyyyyy.'], colors: { y: '#fbbf24' } },
};
const thumbs = {};
const thumbFor = (n) => (thumbs[n.id] ||= trackOutline(n.race));

function renderMap () {
  view = 'map';
  closeLayer();
  document.body.classList.remove('mode-race');

  // Las acciones van FIJAS arriba (barra pegajosa): no hay que recorrer el mapa para verlas.
  const bar = h('div', { class: 'map-actions' },
    h('div', { class: 'stats-bar' },
      h('div', { class: 'stat-chip', 'data-testid': 'stars-total', title: t('stars') },
        h('span', { class: 'ic star', html: IC.star }), h('b', {}, String(totalStars(progress))), h('span', { class: 'muted' }, '/ ' + maxStars())),
      h('div', { class: 'stat-chip', title: t('money') }, h('b', { 'data-testid': 'money-total' }, fmtMoney(progress.money))),
      h('div', { class: 'stat-chip', title: t('nitros') }, h('span', { class: 'nitro-tag' }, 'N'), h('b', { 'data-testid': 'nitro-total' }, String(progress.nitro)))),
    h('div', { class: 'stats-bar' },
      h('button', { class: 'btn primary', 'data-testid': 'garage-btn', onclick: () => openGarage() },
        h('span', { class: 'ic', html: IC.wrench }), t('garage')),
      // Sin fin: una pista por piezas nueva en cada ronda, fuera del campeonato; los rivales
      // suben más rápido que el taller. La explicación larga sale como aviso al arrancar.
      h('button', { class: 'btn random', 'data-testid': 'random-btn', title: t('randomHelp'), onclick: () => startRandom() },
        h('span', { class: 'ic', html: IC.dice }),
        h('span', { class: 'card-txt' }, h('b', {}, t('randomTrack') + ' · ' + t('round', { n: progress.endless.round + 1 })),
          progress.endless.best ? h('span', { class: 'muted', 'data-testid': 'endless-best' }, t('bestRound', { n: progress.endless.best })) : null))),
  );
  clear(screen).append(bar, renderMapGraph());

  // El mapa sube: enfocar la próxima carrera.
  requestAnimationFrame(() => {
    const el = screen.querySelector('.node-wrap.next') || screen.querySelector('.node-wrap');
    if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  });
}

// En pantallas anchas el mapa va APAISADO: las regiones de izquierda a derecha, a todo el
// ancho; en el teléfono, de abajo arriba.
const isWide = () => window.innerWidth >= 900 && window.innerWidth > window.innerHeight;
let mapWide = null;
window.addEventListener('resize', () => { if (view === 'map' && mapWide !== null && mapWide !== isWide()) renderMap(); });

function renderMapGraph () {
  const rows = maxRow();
  const wide = mapWide = isWide();
  const nextId = nextNodeId(progress);
  const nodes = allNodes();
  // Apaisado: el paso entre filas se estira para llenar el ancho de la ventana.
  const step = wide ? Math.max(86, Math.min(140, (window.innerWidth - 56 - PAD_Y * 2) / (rows - 1))) : ROW_H;
  const width = wide ? PAD_Y * 2 + (rows - 1) * step : MAP_W;
  const height = wide ? Math.max(400, Math.min(560, window.innerHeight - 330)) : PAD_Y * 2 + (rows - 1) * step;
  // Posición de cada carrera: la primera queda abajo (o a la izquierda).
  const cx = n => wide ? PAD_Y + n.row * step : n.x * MAP_W;
  const cy = n => wide ? 40 + (1 - n.x) * (height - 110) + 30 : PAD_Y + (rows - 1 - n.row) * step;
  const along = n => wide ? cx(n) : cy(n);

  // Terreno: una franja por región; el borde entre dos queda a medio camino entre el jefe de
  // una y la entrada de la siguiente. Apaisado las franjas van de izquierda a derecha.
  const bands = [];
  const order = wide ? [...regions().keys()] : [...regions().keys()].reverse();
  for (const ri of order) {
    const entry = nodes.find(n => n.region === ri), nextEntry = nodes.find(n => n.region === ri + 1);
    const boss = nodes.findLast(n => n.region === ri), prevBoss = nodes.findLast(n => n.region === ri - 1);
    let end;
    if (wide) end = nextEntry ? (along(boss) + along(nextEntry)) / 2 : width;
    else end = prevBoss ? (along(entry) + along(prevBoss)) / 2 : height;
    bands.push({ key: regionKey(ri), end: end / SCALE });
  }
  const trails = edges().map(([a, b]) => {
    const na = nodeById(a), nb = nodeById(b);
    const on = isDone(progress, a) && (isDone(progress, b) || isUnlocked(progress, b));
    return { x1: cx(na) / SCALE, y1: cy(na) / SCALE, x2: cx(nb) / SCALE, y2: cy(nb) / SCALE, on };
  });
  const pads = nodes.map(n => ({ x: cx(n) / SCALE, y: cy(n) / SCALE, r: (n.type === 'boss' ? T_BOSS : T_NORM) / 2 / SCALE + 2 }));
  const ground = paintMap({ w: Math.round(width / SCALE), h: Math.round(height / SCALE), bands, axis: wide ? 'x' : 'y', trails, pads });
  ground.className = 'map-ground';
  ground.style.width = width + 'px'; ground.style.height = height + 'px';
  const inner = h('div', { class: 'map-inner', style: { width: width + 'px', height: height + 'px' } }, ground);

  for (const n of nodes) {
    const unlocked = isUnlocked(progress, n.id);
    const done = isDone(progress, n.id);
    const isBoss = n.type === 'boss';
    const size = isBoss ? T_BOSS : T_NORM;
    const cls = ['node-wrap', 'reg-' + regionKey(n.region)];
    if (isBoss) cls.push('boss');
    if (done) cls.push('done');
    if (!unlocked) cls.push('locked');
    if (n.id === nextId) cls.push('next');

    // Bloqueada no es deshabilitada: al tocarla dice qué falta.
    const tile = h('button', {
      class: 'node', 'data-testid': 'node-' + n.id, 'data-node': n.id,
      style: { width: size + 'px', height: size + 'px' },
      'data-locked': unlocked ? null : '1',
      'aria-label': (isBoss ? t('boss') : t('race') + ' ' + n.label) + ' · ' + t(regionKey(n.region)),
      onclick: () => startNode(n.id),
    });
    if (!unlocked) tile.append(pixelArt(PX.lock.rows, PX.lock.colors, 3));
    else {
      tile.append(trackThumb(thumbFor(n), regionKey(n.region), isBoss ? 26 : 24));
      tile.append(isBoss ? h('span', { class: 'node-crown' }, pixelArt(PX.crown.rows, PX.crown.colors, 2)) : h('span', { class: 'node-num' }, String(n.label)));
    }
    const wrap = h('div', { class: cls.join(' '), style: { left: cx(n) - 45 + 'px', top: cy(n) - size / 2 + 'px' } }, tile);
    // La camioneta del jugador, parada en la próxima carrera.
    if (n.id === nextId) wrap.prepend(h('span', { class: 'node-truck' }, truckIcon(sprites, 'red', 1, wide ? 0 : 24)));
    if (done) wrap.append(starRow(nodeStars(progress, n.id), 'node-stars'));
    else if (!unlocked) {
      const miss = starsMissing(progress, n.id);
      if (miss > 0) wrap.append(h('div', { class: 'node-gate' }, h('span', { class: 'ic', html: IC.star }), String(miss)));
    }
    inner.appendChild(wrap);
  }
  // El letrero de cada región, donde empieza su terreno: abajo a la izquierda de su franja
  // (apaisado) o a la izquierda de su borde de arriba (el desierto, abajo del todo).
  let from = 0;
  for (const b of bands) {
    const style = wide ? { left: from * SCALE + 8 + 'px', bottom: '8px' }
      : { top: (b.key === 'desert' ? height - 30 : b.end * SCALE - 12) + 'px', left: '8px' };
    inner.appendChild(h('div', { class: 'region-tag', style }, t(b.key)));
    from = b.end;
  }
  return h('div', { class: 'map-scroll' + (wide ? ' wide' : ''), 'data-testid': 'map' }, inner);
}

// =====================================================================
//  Carrera
// =====================================================================
/** Una ronda del sin fin en la pista de esa semilla (o en una nueva), en la ronda dada o en la tuya. */
function startRandom (seed, round) {
  const s = seed || (1 + Math.floor(Math.random() * 0x7ffffffe));
  if (!startRandom.told) { startRandom.told = true; showToast(t('randomHelp'), 6000); }
  startNode(null, { node: randomNode(s, progress.up, round ?? progress.endless.round) });
}

function startNode (id, opts = {}) {
  const n = opts.node || nodeById(id);
  if (!n) return;
  const loose = n.type === 'random';
  const unlocked = loose || isUnlocked(progress, id);
  if (!unlocked && !opts.shared) {
    const miss = starsMissing(progress, id);
    showToast(miss > 0 ? t('needStars', { n: miss }) : t('needPrev'));
    return;
  }
  // Una carrera compartida que todavía no abriste se corre con una camioneta estándar (la
  // misma para todos) y no toca tu avance.
  const shared = !unlocked;
  audio.unlock();
  const L = n.race.level;
  const player = shared
    ? { ai: false, color: 'red', up: { tires: L, shocks: L, accel: L, speed: L }, nitro: 3 }
    : { ai: false, color: 'red', up: { ...progress.up }, nitro: progress.nitro };
  // De una carrera a otra (repetir, siguiente) se conserva la MISMA capa de "volver": cerrar
  // una y abrir otra seguidas deja el cierre de la primera llegando tarde, sobre la nueva.
  if (view !== 'race') {
    closeLayer();
    layer = nav.open(() => { layer = null; if (view === 'race') { current?.handle.destroy(); current = null; renderMap(); } });
  }
  view = 'race';
  document.body.classList.add('mode-race');
  clear(screen);
  const title = (loose ? t('randomTrack') + ' · ' + t('round', { n: n.round + 1 }) : n.type === 'boss' ? t('boss') : t('race') + ' ' + n.label) + ' · ' + t(regionKey(n.region));
  const handle = startRace({
    host: screen, spec: n.race, region: regionKey(n.region), sprites, title,
    trucks: [player, ...rivalsFor(n)],
    onEnd: (res) => onRaceEnd(n, shared, res),
    onExit: () => { current = null; renderMap(); },
  });
  current = { node: n, shared, handle };
  if (shared) showToast(t('sharedIntro'), 4200);
}

function onRaceEnd (node, shared, res) {
  const place = res.place;
  if (node.type === 'random') {
    // Sin fin: premio y nitros, sin estrellas ni mapa. El podio pasa de ronda (si era la
    // tuya; una ronda compartida más alta no adelanta); el 4.º puesto vuelve a la primera.
    const prize = randomPrize(node, place);
    const picked = res.cash * 5000 * (node.prizeRegion + 1);
    progress.money += prize + picked;
    progress.nitro = res.nitroLeft;
    const e = progress.endless;
    let roundLost = false;
    if (place <= 3) { if (node.round === e.round) e.round++; e.best = Math.max(e.best, node.round + 1); }
    else if (node.round === e.round && e.round > 0) { e.round = 0; roundLost = true; }
    persist();
    showResult(node, false, { ...res, stars: starsForPlace(place), prize, picked, openedRegion: null, roundLost });
    return;
  }
  const stars = starsForPlace(place);
  const prize = shared ? 0 : prizeFor(node, place);
  const picked = shared ? 0 : res.cash * cashPickupValue(node);
  let openedRegion = null;
  if (!shared) {
    const before = allNodes().filter(x => isUnlocked(progress, x.id)).map(x => x.id);
    const prev = progress.nodes[node.id] || {};
    progress.money += prize + picked;
    progress.nitro = res.nitroLeft;
    if (stars > 0) {
      progress.nodes[node.id] = {
        ...prev, done: true, stars: Math.max(prev.stars || 0, stars),
        bestMs: prev.bestMs ? Math.min(prev.bestMs, res.timeMs) : res.timeMs,
      };
    }
    persist();
    // ¿Se abrió una región nueva con esta carrera?
    const fresh = allNodes().find(x => !before.includes(x.id) && isUnlocked(progress, x.id) && x.region !== node.region);
    if (fresh) openedRegion = fresh.region;
  }
  showResult(node, shared, { ...res, stars, prize, picked, openedRegion });
}

function showResult (node, shared, r) {
  const won = r.stars > 0;
  const loose = node.type === 'random';
  const isBoss = node.type === 'boss';
  const nextId = !shared && !loose && won ? followingNodeId(progress, node.id) : null;
  const already = !!progress.nodes[node.id]?.shared;
  const close = () => { overlay.remove(); };
  const again = () => { close(); current?.handle.destroy(); current = null; startNode(node.id, { shared, node: loose ? node : undefined }); };
  const toMap = () => { close(); current?.handle.destroy(); current = null; renderMap(); };

  const meta = h('div', { class: 'win-meta' },
    h('div', { class: 's' }, h('div', { class: 'k' }, t('time')), h('div', { class: 'v' }, fmtTime(r.timeMs))),
    r.bestLapMs ? h('div', { class: 's' }, h('div', { class: 'k' }, t('bestLap')), h('div', { class: 'v' }, fmtTime(r.bestLapMs))) : null,
    !shared ? h('div', { class: 's' }, h('div', { class: 'k' }, t('prize')), h('div', { class: 'v money', 'data-testid': 'result-prize' }, fmtMoney(r.prize + r.picked))) : null,
  );
  const overlay = h('div', { class: 'overlay', 'data-testid': 'result' },
    h('div', { class: 'modal win' },
      h('div', { class: 'win-place place-' + r.place, 'data-testid': 'result-place' }, t('place' + r.place)),
      h('h2', {}, won && isBoss ? t('bossBeaten') : won ? t('youFinished', { p: t('place' + r.place) }) : t('failed')),
      starRow(r.stars, 'win-stars'),
      meta,
      r.openedRegion != null ? h('div', { class: 'region-open' }, t('regionUnlocked', { r: t(regionKey(r.openedRegion)) })) : null,
      loose ? h('div', { class: 'region-open', 'data-testid': 'result-round' }, r.roundLost ? t('roundLost') : won ? t('roundNext', { n: node.round + 2 }) : t('roundKeep', { n: node.round + 1 })) : null,
      // Compartir da algo jugable (§12.3): 3 nitros, una vez por carrera.
      h('div', { class: 'win-share' },
        h('button', { class: 'btn block', 'data-testid': 'result-share', onclick: () => shareNode(loose ? 't' + node.race.seed + '.' + node.round : node.id) },
          h('span', { class: 'ic', html: IC.share }), t('challengeFriend')),
        !shared && !loose ? h('div', { class: 'share-hint', id: 'shareHint' }, already ? t('shareAlready') : t('shareToEarn')) : null),
      h('div', { class: 'win-actions' },
        nextId ? h('button', { class: 'btn primary block', 'data-testid': 'result-next', onclick: () => { close(); current?.handle.destroy(); current = null; startNode(nextId); } }, t('nextRace')) : null,
        loose ? h('button', { class: 'btn primary block', 'data-testid': 'result-another', onclick: () => { close(); current?.handle.destroy(); current = null; startRandom(); } }, t('anotherTrack')) : null,
        h('button', { class: 'btn block' + (nextId || loose ? '' : ' primary'), 'data-testid': 'result-retry', onclick: again }, t('retry')),
        !shared ? h('button', { class: 'btn block', 'data-testid': 'result-garage', onclick: () => { toMap(); openGarage(); } },
          h('span', { class: 'ic', html: IC.wrench }), t('garage')) : null,
        h('button', { class: 'btn block', 'data-testid': 'result-map', onclick: toMap }, t('backToMap')),
      ),
    ));
  app.append(overlay);
}

// ---------- Compartir (§12.3): la misma carrera para el amigo, por #fragment ----------
function shareNode (id) {
  shareNodeId = id;
  // Una carrera del mapa viaja por su nombre (#r=n5); una ronda del sin fin, por su semilla y
  // su ronda (#t=<semilla>.<ronda>).
  shareEl.url = location.origin + location.pathname + (id[0] === 't' ? '#t=' + id.slice(1) : '#r=' + id);
  shareEl.text = t('shareText');
  shareEl.lang = getLang();
  shareEl.open = true;
}
function onShared () {
  const id = shareNodeId;
  if (!id || !isUnlocked(progress, id)) return;
  const p = progress.nodes[id] || {};
  if (p.shared) return;                       // una vez por carrera
  progress.nodes[id] = { ...p, shared: true };
  progress.nitro += 3;
  persist();
  showToast(t('shareReward'));
  const hint = document.getElementById('shareHint');
  if (hint) hint.textContent = t('shareAlready');
}

// =====================================================================
//  Taller
// =====================================================================
function openGarage () {
  if (view === 'garage') return;
  renderGarage();
  layer = nav.open(() => { layer = null; if (view === 'garage') renderMap(); });
}

// Iconos de la tienda, en píxeles (como la «Speed Shop» del original).
const SHOP = {
  tires: { rows: ['..kkkkk..', '.kkkkkkk.', 'kkkKKKkkk', 'kkKwwwKkk', 'kkKwKwKkk', 'kkKwwwKkk', 'kkkKKKkkk', '.kkkkkkk.', '..kkkkk..'], colors: { k: '#1e1e22', K: '#44444a', w: '#c0c0c8' } },
  shocks: { rows: ['...yy...', '..yyyy..', '.s....s.', '..ssss..', '.s....s.', '..ssss..', '.s....s.', '..ssss..', '...bb...', '..bbbb..'], colors: { y: '#e0c040', s: '#d0d0d8', b: '#303040' } },
  accel: { rows: ['.p.p.p.p.', 'rrrrrrrrr', 'rRRRRRRRr', 'rRkkkkkRr', 'rRRRRRRRr', 'rrrrrrrrr', '.kk...kk.', '.kk...kk.'], colors: { p: '#c0c0c8', r: '#b02020', R: '#e04040', k: '#202020' } },
  speed: { rows: ['..wwwww..', '.wwwwwww.', 'wwkkkkkww', 'wwk.k.kww', 'wwkk.kkww', 'wwk.n.kww', 'wwkkkkkww', '.wwrrrww.', '..wwwww..'], colors: { w: '#d8d8e0', k: '#202028', n: '#ffe070', r: '#e02020' } },
  nitro: { rows: ['...ww...', '..wwww..', '..ssss..', '.ssssss.', '.sNNNNs.', '.sNNNNs.', '.ssssss.', '.ssssss.', '..ssss..'], colors: { w: '#e8e8e8', s: '#b8c0c8', N: '#d8362c' } },
};
const kfmt = (n) => n >= 1000 ? Math.round(n / 1000) + 'K' : String(n);

function renderGarage () {
  view = 'garage';
  document.body.classList.remove('mode-race');
  const money = progress.money;
  // Una casilla por mejora: cabecera con el nombre y el precio, el icono y la barra de nivel.
  // Toda la casilla es el botón de comprar; si no alcanza, se ve deshabilitada y dice cuánto falta.
  const tile = (key, price, lvlEl, can, reason, onBuy) => h('div', { class: 'shop-tile' + (can ? '' : ' off'), 'data-testid': 'up-' + key },
    h('button', { class: 'shop-buy', 'data-testid': 'buy-' + key, disabled: !can, title: t(key + 'Help') + (can ? '' : ' · ' + reason), 'aria-label': t('buy') + ' ' + t(key === 'nitro' ? 'nitroItem' : key) + ' · ' + fmtMoney(price), onclick: onBuy },
      h('div', { class: 'shop-head' }, h('span', {}, t(key === 'nitro' ? 'nitroItem' : key)), h('span', { class: 'shop-price' }, kfmt(price))),
      h('div', { class: 'shop-body' }, pixelArt(SHOP[key].rows, SHOP[key].colors, 4), lvlEl),
      h('div', { class: 'shop-foot' }, can ? t(key + 'Help') : reason),
    ));
  const bar = (lvl) => {
    const b = h('div', { class: 'lvl-bar', 'aria-label': t('level', { n: lvl }) });
    for (let k = Math.max(8, lvl) - 1; k >= 0; k--) b.append(h('i', { class: k < lvl ? 'on' : '' }));
    return h('div', { class: 'lvl-wrap' }, b, h('span', { class: 'lvl' }, String(lvl)));
  };
  const tiles = UPGRADES.map(key => {
    const lvl = progress.up[key], price = upgradePrice(lvl);
    const can = money >= price;
    return tile(key, price, bar(lvl), can, can ? '' : t('notEnough', { n: fmtMoney(price - money) }), () => {
      progress.money -= price; progress.up[key] = lvl + 1;
      persist(); audio.unlock(); audio.beep(660, 0.1); renderGarage();
    });
  });
  const canNitro = money >= NITRO_PRICE;
  tiles.push(tile('nitro', NITRO_PRICE, h('div', { class: 'lvl-wrap' }, h('span', { class: 'lvl big', 'data-testid': 'garage-nitro' }, String(progress.nitro))),
    canNitro, canNitro ? '' : t('notEnough', { n: fmtMoney(NITRO_PRICE - money) }), () => {
      progress.money -= NITRO_PRICE; progress.nitro += 1;
      persist(); audio.unlock(); audio.beep(520, 0.1); renderGarage();
    }));
  // «Siguiente carrera»: la miniatura de la próxima pista, como en el original. Vuelve al mapa.
  const next = nodeById(nextNodeId(progress));
  tiles.push(h('div', { class: 'shop-tile go', 'data-testid': 'up-next' },
    h('button', { class: 'shop-buy', 'data-testid': 'garage-close', onclick: () => closeLayer() },
      h('div', { class: 'shop-head' }, h('span', {}, t('backToMap'))),
      h('div', { class: 'shop-body' }, next ? trackThumb(thumbFor(next), regionKey(next.region), 26) : h('span', { class: 'ic', html: IC.crown })),
      h('div', { class: 'shop-foot' }, next ? (next.type === 'boss' ? t('boss') : t('race') + ' ' + next.label) + ' · ' + t(regionKey(next.region)) : ''),
    )));

  clear(screen).append(
    h('div', { class: 'garage', 'data-testid': 'garage' },
      h('div', { class: 'garage-head' }, truckIcon(sprites, 'red', 3, 3), h('h2', {}, t('garageTitle'))),
      h('div', { class: 'shop' },
        h('div', { class: 'shop-cash' },
          h('div', { class: 'cash-box' }, h('span', {}, t('money')), h('b', { 'data-testid': 'garage-money' }, fmtMoney(money))),
          h('div', { class: 'cash-box' }, h('span', {}, t('nitros')), h('b', {}, String(progress.nitro)))),
        h('div', { class: 'shop-grid' }, ...tiles)),
    ));
}

// =====================================================================
//  Arranque
// =====================================================================
function sharedNodeFromHash () {
  const m = /(?:^#|[#&])r=(n\d+)/.exec(location.hash || '');
  return m && nodeById(m[1]) ? m[1] : null;
}
function consumeHash () {
  const seed = /(?:^#|[#&])t=(\d{1,10})(?:\.(\d{1,4}))?/.exec(location.hash || '');
  if (seed && Number(seed[1]) > 0) {
    history.replaceState(history.state, '', location.pathname + location.search);
    startRandom(Number(seed[1]), seed[2] != null ? Number(seed[2]) : undefined);
    return true;
  }
  const id = sharedNodeFromHash();
  if (!id) return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  startNode(id, { shared: true });
  return true;
}

(async () => {
  renderMap();
  try {
    const saved = await loadProgress();
    if (saved) {
      progress = {
        nodes: saved.nodes || {}, money: saved.money ?? START.money, nitro: saved.nitro ?? START.nitro,
        up: { ...START.up, ...(saved.up || {}) },
        endless: { round: saved.endless?.round || 0, best: saved.endless?.best || 0 },
      };
    }
  } catch (e) {
    console.error('[offroad] could not load progress', e);
    showToast('⚠ ' + t('storeProblem'), 8000);
  }
  if (!consumeHash() && view === 'map') renderMap();
})();
window.addEventListener('hashchange', () => { if (view !== 'race') consumeHash(); });

// Hook SOLO para las pruebas E2E (§5: amigable con Playwright).
window.__offroad = {
  get progress () { return progress; },
  get view () { return view; },
  get race () { return current?.handle; },
  setProgress (p) { progress = p; renderMap(); },
};

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(e => console.error('[offroad] service worker failed', e)); });
}
