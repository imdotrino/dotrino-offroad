// Bilingüe es/en (§9). El idioma es una preferencia de UI → localStorage, en la clave del
// ecosistema (la misma que escribe <dotrino-topbar>). Español neutro: TUTEO, nunca voseo.
const DICT = {
  es: {
    brand: 'Offroad',
    storeProblem: 'No se pudo abrir tu almacén: tu avance no se guardará.',

    // Mapa
    stars: 'estrellas', money: 'Dinero', nitros: 'Nitros', garage: 'Taller',
    race: 'Carrera', boss: 'Jefe', laps: '{n} vueltas',
    desert: 'Desierto', forest: 'Bosque', snow: 'Nieve', volcano: 'Volcán',
    needStars: 'Te faltan {n} estrellas para abrir esta carrera',
    needPrev: 'Termina antes la carrera anterior del camino',
    sharedRace: 'Carrera compartida',
    sharedIntro: 'Te retaron a esta carrera. Corres con una camioneta estándar.',

    // Carrera
    lap: 'Vuelta', go: '¡YA!', finish: '¡META!',
    place1: '1.º', place2: '2.º', place3: '3.º', place4: '4.º',
    pause: 'Pausa', paused: 'En pausa', resume: 'Seguir', restart: 'Reiniciar carrera',
    exitRace: 'Salir de la carrera', soundOn: 'Sonido: activado', soundOff: 'Sonido: apagado',
    gas: 'GAS', nitro: 'Nitro', steerLeft: 'Girar a la izquierda', steerRight: 'Girar a la derecha',
    helpKeys: '← → girar · ↑ acelerar · ↓ frenar · Espacio nitro',
    helpTouch: '◀ ▶ girar · GAS acelerar · N nitro',

    // Resultado
    youFinished: 'Llegaste {p}', bossBeaten: '¡Jefe vencido!',
    failed: 'Llegaste 4.º: necesitas el podio para avanzar',
    prize: 'Premio', time: 'Tiempo', bestLap: 'Mejor vuelta', pickedUp: 'Recogido en pista',
    nextRace: 'Siguiente carrera', retry: 'Repetir', backToMap: 'Volver al mapa',
    challengeFriend: 'Reta a un amigo',
    shareToEarn: 'Comparte esta carrera y gana 3 nitros',
    shareReward: '¡+3 nitros por compartir!',
    shareAlready: 'Ya ganaste los nitros de esta carrera',
    shareText: 'Te reto a ganarme en esta carrera de Offroad',
    regionUnlocked: '¡Se abrió la región {r}!',

    // Taller
    garageTitle: 'Taller', yourTruck: 'Tu camioneta',
    tires: 'Llantas', tiresHelp: 'Más agarre en las curvas y en el barro',
    shocks: 'Amortiguadores', shocksHelp: 'Pierdes menos velocidad al caer de una loma',
    accel: 'Aceleración', accelHelp: 'Llegas antes a tu velocidad máxima',
    speed: 'Velocidad', speedHelp: 'Más velocidad máxima',
    nitroItem: 'Nitro', nitroHelp: 'Un empujón corto de velocidad. Se gasta al usarlo',
    buy: 'Comprar', maxed: 'Al máximo', notEnough: 'Te faltan {n}',
    level: 'Nivel {n}/{m}', youHave: 'Tienes {n}',
    close: 'Cerrar',
  },
  en: {
    brand: 'Offroad',
    storeProblem: 'Your storage could not be opened: your progress will not be saved.',

    stars: 'stars', money: 'Money', nitros: 'Nitros', garage: 'Garage',
    race: 'Race', boss: 'Boss', laps: '{n} laps',
    desert: 'Desert', forest: 'Forest', snow: 'Snow', volcano: 'Volcano',
    needStars: 'You need {n} more stars to open this race',
    needPrev: 'Finish the previous race on this path first',
    sharedRace: 'Shared race',
    sharedIntro: 'You were challenged to this race. You drive a standard truck.',

    lap: 'Lap', go: 'GO!', finish: 'FINISH!',
    place1: '1st', place2: '2nd', place3: '3rd', place4: '4th',
    pause: 'Pause', paused: 'Paused', resume: 'Resume', restart: 'Restart race',
    exitRace: 'Leave race', soundOn: 'Sound: on', soundOff: 'Sound: off',
    gas: 'GAS', nitro: 'Nitro', steerLeft: 'Steer left', steerRight: 'Steer right',
    helpKeys: '← → steer · ↑ gas · ↓ brake · Space nitro',
    helpTouch: '◀ ▶ steer · GAS to accelerate · N nitro',

    youFinished: 'You finished {p}', bossBeaten: 'Boss beaten!',
    failed: 'You finished 4th: you need the podium to move on',
    prize: 'Prize', time: 'Time', bestLap: 'Best lap', pickedUp: 'Picked up on track',
    nextRace: 'Next race', retry: 'Retry', backToMap: 'Back to map',
    challengeFriend: 'Challenge a friend',
    shareToEarn: 'Share this race and earn 3 nitros',
    shareReward: '+3 nitros for sharing!',
    shareAlready: 'You already earned the nitros for this race',
    shareText: 'I dare you to beat me in this Offroad race',
    regionUnlocked: 'The {r} region is now open!',

    garageTitle: 'Garage', yourTruck: 'Your truck',
    tires: 'Tires', tiresHelp: 'More grip in corners and in mud',
    shocks: 'Shocks', shocksHelp: 'You lose less speed when landing a jump',
    accel: 'Acceleration', accelHelp: 'You reach your top speed sooner',
    speed: 'Top speed', speedHelp: 'Higher top speed',
    nitroItem: 'Nitro', nitroHelp: 'A short burst of speed. Used up when fired',
    buy: 'Buy', maxed: 'Maxed out', notEnough: 'You need {n} more',
    level: 'Level {n}/{m}', youHave: 'You have {n}',
    close: 'Close',
  },
};

const LS_LANG = 'dotrino.lang';

let lang = (() => {
  try { const s = localStorage.getItem(LS_LANG); if (s === 'es' || s === 'en') return s; } catch { /* modo privado */ }
  return (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
})();
try { document.documentElement.lang = lang; } catch { /* sin DOM */ }

export function getLang () { return lang; }
export function setLang (l) {
  lang = l === 'en' ? 'en' : 'es';
  try { localStorage.setItem(LS_LANG, lang); } catch { /* modo privado */ }
  try { document.documentElement.lang = lang; } catch { /* sin DOM */ }
}

export function t (key, params) {
  let s = (DICT[lang] && DICT[lang][key]) ?? DICT.es[key] ?? key;
  if (params) for (const k in params) s = s.replaceAll('{' + k + '}', params[k]);
  return s;
}

/** Dinero con separador de miles: $60.000 / $60,000. */
export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString(lang === 'en' ? 'en-US' : 'es-EC');
