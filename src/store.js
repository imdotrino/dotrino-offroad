// Persistencia OBLIGATORIA vía @dotrino/store (§4): el avance del campeonato (estrellas,
// dinero, nitros y mejoras) vive en el almacén del usuario, atado a su perfil. localStorage
// queda solo para preferencias de UI (idioma, sonido).
//
// SIN REPLIEGUE: si el almacén no abre, la partida sigue EN MEMORIA y se dice en pantalla
// (`onStoreProblem`). No se guarda a escondidas en otro sitio.
const THREAD_PROGRESS = 'offroad.progress';

/**
 * @typedef {import('./types').Progress} Progress
 * @typedef {import('@dotrino/store').ThreadEntry} ThreadEntry
 * @typedef {{
 *   kind: 'memory' | 'store',
 *   store?: import('@dotrino/store').Store,
 *   appendMessage (th: string, e: ThreadEntry): Promise<unknown>,
 *   listThread (th: string, o?: { limit?: number }): Promise<ThreadEntry[]>,
 *   removeThread (th: string): Promise<unknown>,
 * }} Backend
 */

/** @type {Promise<Backend> | null} */
let backendPromise = null;
/** @type {unknown} */
let problem = null;
/** @type {Set<(e: unknown) => void>} */
const problemListeners = new Set();

/**
 * Avisa (también al suscribirse, si ya pasó) de que el almacén no abrió: no se guarda nada.
 * @param {(e: unknown) => void} fn
 * @returns {() => boolean} desuscribe
 */
export function onStoreProblem (fn) {
  problemListeners.add(fn);
  if (problem) fn(problem);
  return () => problemListeners.delete(fn);
}

/** @returns {Backend} */
function memoryBackend () {
  /** @type {Map<string, ThreadEntry[]>} */
  const mem = new Map();
  return {
    kind: 'memory',
    async appendMessage (th, e) { const a = mem.get(th) || []; a.push(e); mem.set(th, a); },
    async listThread (th) { return mem.get(th) || []; },
    async removeThread (th) { mem.delete(th); },
  };
}

/** @returns {Promise<Backend>} */
async function getBackend () {
  if (backendPromise) return backendPromise;
  backendPromise = (/** @returns {Promise<Backend>} */ async () => {
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

/**
 * Avance guardado, o null si todavía no hay ninguno. Un único registro que se sobrescribe.
 * @returns {Promise<Partial<Progress> | null>} lo guardado tal cual: main.js lo completa
 */
export async function loadProgress () {
  const b = await getBackend();
  const entries = await b.listThread(THREAD_PROGRESS, { limit: 1 });
  if (entries && entries.length) {
    const last = entries[entries.length - 1];
    if (last && last.progress) return last.progress;
  }
  return null;
}

/**
 * @param {Progress} progress
 * @returns {Promise<void>}
 */
export async function saveProgress (progress) {
  const b = await getBackend();
  await b.removeThread(THREAD_PROGRESS);
  await b.appendMessage(THREAD_PROGRESS, { id: 'progress', ts: Date.now(), progress });
}

/**
 * El almacén ya atado al perfil, para el punto de respaldo del topbar (null si no abrió).
 * @returns {Promise<import('@dotrino/store').Store | null>}
 */
export async function storeHandle () {
  const b = await getBackend();
  if (b.kind !== 'store') return null;
  return (await import('@dotrino/store')).Store.current();
}
