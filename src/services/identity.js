// Identidad = vault id.dotrino.com (única fuente). No reimplementamos nada:
// el pilar @dotrino/identity es quien habla con el vault (CLAUDE.md, regla principal).
import { Identity } from '@dotrino/identity';

/** @type {Identity | null} */
let identity = null;

/**
 * Instancia compartida de identidad (o null si el vault no responde).
 * @returns {Promise<Identity | null>}
 */
export async function getIdentity() {
  // Hook SOLO para E2E: las pruebas corren en localhost, donde id.dotrino.com no contesta
  // (silencio para orígenes de fuera del ecosistema). En producción nunca está puesto.
  const testVault = globalThis.__TEST_VAULT_PROMISE__;
  if (testVault) return testVault;
  if (identity) return identity;
  try {
    identity = await Identity.connect();
  } catch (e) {
    console.warn('[identity] vault unreachable:', e && /** @type {Error} */ (e).message);
    identity = null;
  }
  return identity;
}

/** @returns {string | null} */
export function myPubkey() { return identity?.me?.publickey || null; }
/** @returns {string | null} */
export function myName() { return identity?.me?.nickname || null; }
