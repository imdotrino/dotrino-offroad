// Persistencia OBLIGATORIA vía @dotrino/store (§4): el avance del campeonato (estrellas,
// dinero, nitros y mejoras) vive en el almacén del usuario, atado a su perfil. localStorage
// queda solo para preferencias de UI (idioma, sonido).
//
// SIN REPLIEGUE: si el almacén no abre, la partida sigue EN MEMORIA y se dice en pantalla
// (`onStoreProblem`). No se guarda a escondidas en otro sitio.
const THREAD_PROGRESS = 'offroad.progress';

let backendPromise = null;
let problem = null;
const problemListeners = new Set();

/** Avisa (también al suscribirse, si ya pasó) de que el almacén no abrió: no se guarda nada. */
export function onStoreProblem (fn) {
  problemListeners.add(fn);
  if (problem) fn(problem);
  return () => problemListeners.delete(fn);
}

function memoryBackend () {
  const mem = new Map();
  return {
    kind: 'memory',
    async appendMessage (th, e) { const a = mem.get(th) || []; a.push(e); mem.set(th, a); },
    async listThread (th) { return mem.get(th) || []; },
    async removeThread (th) { mem.delete(th); },
  };
}

async function getBackend () {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    try {
      const mod = await import('@dotrino/store');
      const { getIdentity } = await import('./services/identity.js');
      const identity = await getIdentity();
      if (!identity) throw Object.assign(new Error('identity not available'), { code: 'no-identity' });
      const store = await mod.Store.connect({ identity, adoptCommon: ['offroad.'] });
      if (!store || typeof store.appendMessage !== 'function' || typeof store.listThread !== 'function') throw new Error('store API mismatch');
      return {
        kind: 'store', store,
        appendMessage: (th, e) => store.appendMessage(th, e),
        listThread: (th, o) => store.listThread(th, o),
        removeThread: th => store.removeThread(th),
      };
    } catch (e) {
      console.error('[offroad] store unavailable: progress is NOT being saved', e);
      problem = e;
      for (const fn of problemListeners) fn(e);
      return memoryBackend();
    }
  })();
  return backendPromise;
}

/** Avance guardado, o null si todavía no hay ninguno. Un único registro que se sobrescribe. */
export async function loadProgress () {
  const b = await getBackend();
  const entries = await b.listThread(THREAD_PROGRESS, { limit: 1 });
  if (entries && entries.length) {
    const last = entries[entries.length - 1];
    if (last && last.progress) return last.progress;
  }
  return null;
}

export async function saveProgress (progress) {
  const b = await getBackend();
  await b.removeThread(THREAD_PROGRESS);
  await b.appendMessage(THREAD_PROGRESS, { id: 'progress', ts: Date.now(), progress });
}

/** El almacén ya atado al perfil, para el punto de respaldo del topbar (null si no abrió). */
export async function storeHandle () {
  const b = await getBackend();
  if (b.kind !== 'store') return null;
  return (await import('@dotrino/store')).Store.current();
}
