// Puente al registro de reputación (@dotrino/reputation). Lo consume el modal de
// perfil del topbar (§6.1); no inventamos score propio: el paquete pondera por
// MI confianza en los emisores (web-of-trust del vault, anti-sybil).
import { createVaultReputation } from '@dotrino/reputation';
import { getIdentity } from './identity.js';

let _rep = null;

/** Instancia compartida de reputación (o null si no hay vault). */
export async function getReputation() {
  if (_rep) return _rep;
  const id = await getIdentity();
  if (!id) return null;
  try { _rep = createVaultReputation(id); } catch (_) { _rep = null; }
  return _rep;
}
