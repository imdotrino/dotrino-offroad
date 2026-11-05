// Mini-helper para construir DOM sin framework. `html:` es solo para nuestros
// propios SVG/íconos de confianza; el texto va siempre como TextNode.
/**
 * @typedef {Node | string | number | boolean | null | undefined} Kid
 */

/**
 * Crea un elemento. `props`: `class`, `style` (objeto), `html` (solo SVG propio), `on…`
 * (manejadores) y el resto como atributos (`true` = atributo vacío; null/false = no se pone).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown>} [props]
 * @param {...(Kid | Kid[])} kids
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = /** @type {any} */ (props[k]); // cada clave lo usa a su manera (texto, objeto, función)
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

/**
 * @template {Node} N
 * @param {N} node
 * @returns {N}
 */
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/**
 * El contexto 2D de un lienzo. Sin él no hay nada que dibujar: se para y se dice, en vez
 * de reventar más adelante con un `null`.
 * @param {HTMLCanvasElement} cv
 * @returns {CanvasRenderingContext2D}
 */
export function ctx2d(cv) {
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('offroad: canvas has no 2d context');
  return ctx;
}
