import './style.css';
import { h, clear } from './dom.js';
import { t, getLang, setLang, fmtMoney } from './i18n.js';
import { loadProgress, saveProgress, onStoreProblem, storeHandle } from './store.js';
import {
  allNodes, nodeById, edges, maxRow, regionKey, totalStars, maxStars, nodeStars, isDone,
  isUnlocked, starsMissing, nextNodeId, followingNodeId, starsForPlace, prizeFor,
  cashPickupValue, rivalsFor, randomNode, randomPrize, UPGRADES, MAX_UP, NITRO_PRICE, START, upgradePrice,
} from './levels.js';
import { startRace } from './race.js';
import { makeSprites, truckIcon } from './render.js';
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
let progress = { nodes: {}, money: START.money, nitro: START.nitro, up: { ...START.up } };
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
const MAP_W = 320, ROW_H = 100, PAD_Y = 52, R_NORM = 27, R_BOSS = 33;

function renderMap () {
  view = 'map';
  closeLayer();
  document.body.classList.remove('mode-race');

  const bar = h('div', { class: 'stats-bar' },
    h('div', { class: 'stat-chip', 'data-testid': 'stars-total', title: t('stars') },
      h('span', { class: 'ic star', html: IC.star }), h('b', {}, String(totalStars(progress))), h('span', { class: 'muted' }, '/ ' + maxStars())),
    h('div', { class: 'stat-chip', title: t('money') }, h('b', { 'data-testid': 'money-total' }, fmtMoney(progress.money))),
    h('div', { class: 'stat-chip', title: t('nitros') }, h('span', { class: 'nitro-tag' }, 'N'), h('b', { 'data-testid': 'nitro-total' }, String(progress.nitro))),
    h('button', { class: 'btn primary', 'data-testid': 'garage-btn', onclick: () => openGarage() },
      h('span', { class: 'ic', html: IC.wrench }), t('garage')),
  );
  // Pista al azar: una pista por piezas nueva cada vez (sin fin), fuera del campeonato.
  const random = h('button', { class: 'card random', 'data-testid': 'random-btn', onclick: () => startRandom() },
    h('span', { class: 'ic', html: IC.dice }),
    h('span', { class: 'card-txt' }, h('b', {}, t('randomTrack')), h('span', { class: 'muted' }, t('randomHelp'))));
  clear(screen).append(bar, random, renderMapGraph());

  // El mapa sube: enfocar la próxima carrera.
  requestAnimationFrame(() => {
    const el = screen.querySelector('.node-wrap.next') || screen.querySelector('.node-wrap');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
}

function renderMapGraph () {
  const rows = maxRow();
  const height = PAD_Y * 2 + (rows - 1) * ROW_H;
  const nextId = nextNodeId(progress);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'map-edges');
  svg.setAttribute('width', String(MAP_W)); svg.setAttribute('height', String(height));
  const cx = n => n.x * MAP_W;
  const cy = n => PAD_Y + (rows - 1 - n.row) * ROW_H;   // la primera carrera queda abajo
  for (const [a, b] of edges()) {
    const na = nodeById(a), nb = nodeById(b);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(cx(na))); line.setAttribute('y1', String(cy(na)));
    line.setAttribute('x2', String(cx(nb))); line.setAttribute('y2', String(cy(nb)));
    const travelled = isDone(progress, a) && (isDone(progress, b) || isUnlocked(progress, b));
    line.setAttribute('class', 'edge' + (travelled ? ' on' : ''));
    svg.appendChild(line);
  }
  const inner = h('div', { class: 'map-inner', style: { width: MAP_W + 'px', height: height + 'px' } }, svg);

  for (const n of allNodes()) {
    const unlocked = isUnlocked(progress, n.id);
    const done = isDone(progress, n.id);
    const isBoss = n.type === 'boss';
    const r = isBoss ? R_BOSS : R_NORM;
    const cls = ['node-wrap', 'reg-' + regionKey(n.region)];
    if (isBoss) cls.push('boss');
    if (done) cls.push('done');
    if (!unlocked) cls.push('locked');
    if (n.id === nextId) cls.push('next');

    // Bloqueada no es deshabilitada: al tocarla dice qué falta.
    const circle = h('button', {
      class: 'node', 'data-testid': 'node-' + n.id, 'data-node': n.id,
      style: { width: r * 2 + 'px', height: r * 2 + 'px' },
      'data-locked': unlocked ? null : '1',
      'aria-label': (isBoss ? t('boss') : t('race') + ' ' + n.label) + ' · ' + t(regionKey(n.region)),
      onclick: () => startNode(n.id),
    },
      !unlocked ? h('span', { class: 'ic lock', html: IC.lock })
        : isBoss ? h('span', { class: 'ic crown', html: IC.crown })
          : h('span', { class: 'node-num' }, String(n.label)),
    );
    const wrap = h('div', { class: cls.join(' '), style: { left: cx(n) - 45 + 'px', top: cy(n) - r + 'px' } }, circle);
    if (done) wrap.append(starRow(nodeStars(progress, n.id), 'node-stars'));
    else if (!unlocked) {
      const miss = starsMissing(progress, n.id);
      if (miss > 0) wrap.append(h('div', { class: 'node-gate' }, h('span', { class: 'ic', html: IC.star }), String(miss)));
    }
    // El nombre de la región, en la carrera que la abre.
    if (!n.requires.length || nodeById(n.requires[0]).type === 'boss') {
      wrap.append(h('div', { class: 'region-tag' }, t(regionKey(n.region))));
    }
    inner.appendChild(wrap);
  }
  return h('div', { class: 'map-scroll', 'data-testid': 'map' }, inner);
}

// =====================================================================
//  Carrera
// =====================================================================
/** Una carrera suelta en la pista de esa semilla (o en una nueva). */
function startRandom (seed) {
  const s = seed || (1 + Math.floor(Math.random() * 0x7ffffffe));
  startNode(null, { node: randomNode(s, progress.up) });
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
  const title = (loose ? t('randomTrack') : n.type === 'boss' ? t('boss') : t('race') + ' ' + n.label) + ' · ' + t(regionKey(n.region));
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
    // Carrera suelta: premio y nitros, sin estrellas ni mapa.
    const prize = randomPrize(node, place);
    const picked = res.cash * 5000 * (node.prizeRegion + 1);
    progress.money += prize + picked;
    progress.nitro = res.nitroLeft;
    persist();
    showResult(node, false, { ...res, stars: starsForPlace(place), prize, picked, openedRegion: null });
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
      // Compartir da algo jugable (§12.3): 3 nitros, una vez por carrera.
      h('div', { class: 'win-share' },
        h('button', { class: 'btn block', 'data-testid': 'result-share', onclick: () => shareNode(loose ? 't' + node.race.seed : node.id) },
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
  // Una carrera del mapa viaja por su nombre (#r=n5); una pista al azar, por su semilla (#t=…).
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

function renderGarage () {
  view = 'garage';
  document.body.classList.remove('mode-race');
  const money = progress.money;
  // Un botón que no aplica se ve deshabilitado y dice por qué; no se esconde.
  const buyBtn = (key, price, can, reason, onBuy) => h('button', {
    class: 'btn primary buy', 'data-testid': 'buy-' + key, disabled: !can, title: can ? null : reason, onclick: onBuy,
  }, can || !reason ? t('buy') + ' · ' + fmtMoney(price) : reason);

  const rows = UPGRADES.map(key => {
    const lvl = progress.up[key];
    const price = upgradePrice(lvl);
    const maxed = lvl >= MAX_UP;
    const can = !maxed && money >= price;
    const reason = maxed ? t('maxed') : money < price ? t('notEnough', { n: fmtMoney(price - money) }) : '';
    const pips = h('div', { class: 'pips', 'aria-label': t('level', { n: lvl, m: MAX_UP }) });
    for (let k = 0; k < MAX_UP; k++) pips.append(h('i', { class: k < lvl ? 'on' : '' }));
    return h('div', { class: 'up-row', 'data-testid': 'up-' + key },
      h('div', { class: 'up-txt' }, h('b', {}, t(key)), h('span', { class: 'muted' }, t(key + 'Help')), pips),
      buyBtn(key, price, can, reason, () => {
        progress.money -= price; progress.up[key] = lvl + 1;
        persist(); audio.unlock(); audio.beep(660, 0.1); renderGarage();
      }),
    );
  });
  const canNitro = money >= NITRO_PRICE;
  rows.push(h('div', { class: 'up-row', 'data-testid': 'up-nitro' },
    h('div', { class: 'up-txt' }, h('b', {}, t('nitroItem')), h('span', { class: 'muted' }, t('nitroHelp')),
      h('span', { class: 'have' }, t('youHave', { n: progress.nitro }))),
    buyBtn('nitro', NITRO_PRICE, canNitro, canNitro ? '' : t('notEnough', { n: fmtMoney(NITRO_PRICE - money) }), () => {
      progress.money -= NITRO_PRICE; progress.nitro += 1;
      persist(); audio.unlock(); audio.beep(520, 0.1); renderGarage();
    }),
  ));

  clear(screen).append(
    h('div', { class: 'garage', 'data-testid': 'garage' },
      h('div', { class: 'garage-head' },
        truckIcon(sprites, 'red', 5, 3),
        h('div', {}, h('h2', {}, t('garageTitle')), h('div', { class: 'garage-money', 'data-testid': 'garage-money' }, fmtMoney(money))),
      ),
      ...rows,
      h('button', { class: 'btn block', 'data-testid': 'garage-close', onclick: () => closeLayer() }, t('backToMap')),
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
  const seed = /(?:^#|[#&])t=(\d{1,10})/.exec(location.hash || '');
  if (seed && Number(seed[1]) > 0) {
    history.replaceState(history.state, '', location.pathname + location.search);
    startRandom(Number(seed[1]));
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
