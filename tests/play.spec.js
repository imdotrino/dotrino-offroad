import { test, expect } from '@playwright/test'

// Sin bóveda de identidad en localhost: el juego corre con el avance en memoria (y lo dice).
async function open (page, hash = '') {
  await page.addInitScript(() => {
    window.__TEST_VAULT_PROMISE__ = Promise.resolve(null)
    try { localStorage.setItem('dotrino.lang', 'es'); localStorage.setItem('offroad.mute', '1') } catch {}
  })
  await page.goto('about:blank')
  await page.goto('/' + hash)
  await page.waitForFunction(() => !!window.__offroad)
}

test('el mapa abre la primera carrera y dice qué falta en una bloqueada', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.getByTestId('money-total')).toHaveText('$60.000')
  await page.getByTestId('node-n1').click()
  await expect(page.locator('.toast')).toContainText('Termina antes')
  await page.getByTestId('node-n5').click()
  await expect(page.locator('.toast')).toContainText('Te faltan 6 estrellas')
  expect(await page.evaluate(() => window.__offroad.view)).toBe('map')
})

test('correr: la camioneta avanza con el teclado, gasta nitro y el podio da estrellas y premio', async ({ page }) => {
  await open(page)
  await page.getByTestId('node-n0').click()
  await expect(page.getByTestId('race-canvas')).toBeVisible()
  await page.waitForFunction(() => window.__offroad.race.race.state === 'racing', null, { timeout: 8000 })
  const before = await page.evaluate(() => window.__offroad.race.race.trucks[0].progress)
  await page.keyboard.down('ArrowUp')
  await page.keyboard.press('Space')
  await page.waitForTimeout(1500)
  await page.keyboard.up('ArrowUp')
  const st = await page.evaluate(() => { const t = window.__offroad.race.race.trucks[0]; return { progress: t.progress, nitro: t.nitro } })
  expect(st.progress).toBeGreaterThan(before + 5)
  expect(st.nitro).toBe(4)
  await expect(page.getByTestId('hud-lap')).toHaveText('1/3')

  // Pausa y seguir
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pause-menu')).toBeVisible()
  await page.getByTestId('resume-btn').click()
  await expect(page.getByTestId('pause-menu')).toBeHidden()

  await page.evaluate(() => window.__offroad.race.forceFinish(1))
  await expect(page.getByTestId('result')).toBeVisible()
  await expect(page.getByTestId('result-place')).toHaveText('1.º')
  await expect(page.getByTestId('result-prize')).toHaveText('$100.000')
  // Las tres estrellas del primer puesto se ven encendidas (doradas), no grises.
  await expect(page.locator('.win-stars .ns.on')).toHaveCount(3)
  expect(await page.locator('.win-stars .ns.on').first().evaluate(el => getComputedStyle(el).color)).toBe('rgb(251, 191, 36)')
  const p = await page.evaluate(() => window.__offroad.progress)
  expect(p.nodes.n0).toMatchObject({ done: true, stars: 3 })
  expect(p.money).toBe(160000)
  expect(p.nitro).toBe(4)

  // Del resultado al taller: comprar llantas baja el dinero y sube el nivel.
  await page.getByTestId('result-garage').click()
  await expect(page.getByTestId('garage')).toBeVisible()
  await page.getByTestId('buy-tires').click()
  await expect(page.getByTestId('garage-money')).toHaveText('$120.000')
  expect(await page.evaluate(() => window.__offroad.progress.up.tires)).toBe(1)
  await page.getByTestId('garage-close').click()
  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.locator('[data-testid="node-n1"]')).not.toHaveAttribute('data-locked', '1')
})

test('llegar cuarto no completa la carrera', async ({ page }) => {
  await open(page)
  await page.getByTestId('node-n0').click()
  await page.waitForFunction(() => !!window.__offroad.race)
  await page.evaluate(() => window.__offroad.race.forceFinish(4))
  await expect(page.getByTestId('result-place')).toHaveText('4.º')
  const p = await page.evaluate(() => window.__offroad.progress)
  expect(p.nodes.n0).toBeUndefined()
  expect(p.money).toBe(70000)
  await expect(page.getByTestId('result-next')).toHaveCount(0)
})

test('pista al azar: cada semilla es una pista, da premio sin estrellas y se comparte por su semilla', async ({ page }) => {
  await open(page)
  await page.getByTestId('random-btn').click()
  await expect(page.getByTestId('race-canvas')).toBeVisible()
  const a = await page.evaluate(() => ({ seed: window.__offroad.race.race.track.spec.seed, n: window.__offroad.race.race.track.n }))
  await page.evaluate(() => window.__offroad.race.forceFinish(1))
  await expect(page.getByTestId('result-prize')).toHaveText('$50.000')
  const p = await page.evaluate(() => window.__offroad.progress)
  expect(p.money).toBe(110000)
  expect(Object.keys(p.nodes)).toHaveLength(0)
  // Otra pista: semilla distinta.
  await page.getByTestId('result-another').click()
  await page.waitForFunction((old) => window.__offroad.race && window.__offroad.race.race.track.spec.seed !== old, a.seed)
  // El enlace de la primera vuelve a dar exactamente esa pista.
  await open(page, '#t=' + a.seed)
  await expect(page.getByTestId('race-canvas')).toBeVisible()
  const b = await page.evaluate(() => ({ seed: window.__offroad.race.race.track.spec.seed, n: window.__offroad.race.race.track.n }))
  expect(b).toEqual(a)
})

test('un enlace compartido abre esa carrera sin tocar el avance', async ({ page }) => {
  await open(page, '#r=n7')
  await expect(page.getByTestId('race-canvas')).toBeVisible()
  expect(page.url()).not.toContain('#r=')
  await page.evaluate(() => window.__offroad.race.forceFinish(1))
  await expect(page.getByTestId('result')).toBeVisible()
  await expect(page.getByTestId('result-prize')).toHaveCount(0)
  const p = await page.evaluate(() => window.__offroad.progress)
  expect(p.money).toBe(60000)
  expect(p.nodes.n7).toBeUndefined()
})

test('en un teléfono: pista a lo ancho, pedales debajo y volante analógico', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await open(page)
  await page.getByTestId('node-n0').tap()
  await expect(page.getByTestId('pad-gas')).toBeVisible()
  const box = await page.getByTestId('race-canvas').boundingBox()
  expect(box.width).toBeGreaterThan(box.height)
  expect(box.width).toBeGreaterThan(380)
  const pad = await page.getByTestId('pad-gas').boundingBox()
  expect(pad.y).toBeGreaterThan(box.y + box.height)
  expect(box.x).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width).toBeLessThanOrEqual(391)
  // El volante es analógico: cuanto más lejos del centro, más gira.
  await page.waitForFunction(() => window.__offroad.race.race.state === 'racing', null, { timeout: 8000 })
  const w = await page.getByTestId('wheel').boundingBox()
  const cx = w.x + w.width / 2, cy = w.y + w.height / 2
  expect(w.width * w.height).toBeGreaterThan(2 * 168 * 150)      // la zona del volante, el doble que la primera
  await expect(page.getByTestId('pad-brake')).toHaveCount(0)
  expect((await page.getByTestId('pad-gas').boundingBox()).width).toBeGreaterThan(100)
  expect(w.x + w.width).toBeLessThan((await page.getByTestId('pad-gas').boundingBox()).x)
  const steerAt = async (dx) => {
    await page.getByTestId('wheel').dispatchEvent('pointermove', { pointerId: 1, clientX: cx + dx, clientY: cy })
    await page.waitForTimeout(80)
    return page.evaluate(() => window.__offroad.race.input.steer)
  }
  await page.getByTestId('wheel').dispatchEvent('pointerdown', { pointerId: 1, clientX: cx, clientY: cy })
  const half = await steerAt(w.width * 0.2)
  expect(half).toBeGreaterThan(0.3); expect(half).toBeLessThan(0.7)
  expect(await steerAt(w.width * 0.45)).toBe(1)
  expect(await steerAt(-w.width * 0.45)).toBe(-1)
  await page.getByTestId('wheel').dispatchEvent('pointerup', { pointerId: 1, clientX: cx, clientY: cy })
  await page.waitForTimeout(80)
  expect(await page.evaluate(() => window.__offroad.race.input.steer)).toBe(0)
  await ctx.close()
})
