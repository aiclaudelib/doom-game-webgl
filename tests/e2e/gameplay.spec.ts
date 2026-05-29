import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Drives the game through keyboard only (pointer lock is unavailable headless):
// start a New Game from the menu, then move / turn / fire and prove the rendered
// world responds by comparing frame signatures. Frames are signed from element
// screenshots so the check is identical for the WebGL and Canvas2D presenters and
// is unaffected by preserveDrawingBuffer:false.

/** A perceptual-ish signature: coarse byte buckets of the screenshot PNG. */
function signature(buffer: Buffer): number[] {
  const buckets = new Array<number>(16).fill(0)
  const stride = Math.max(1, Math.floor(buffer.length / 8192))
  for (let i = 0; i < buffer.length; i += stride) {
    const bucket = (buffer[i] ?? 0) >> 4
    buckets[bucket] = (buckets[bucket] ?? 0) + 1
  }
  return buckets
}

/** Fraction of buckets that changed beyond a small epsilon — 0 means identical. */
function divergence(a: number[], b: number[]): number {
  let total = 0
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    total += av + bv
    diff += Math.abs(av - bv)
  }
  return total === 0 ? 0 : diff / total
}

async function frame(canvas: Locator): Promise<Buffer> {
  return canvas.screenshot()
}

async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

test('starting a game and moving/turning/firing changes the rendered world', async ({ page }) => {
  await page.goto('/')

  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()

  // Focus the canvas (also satisfies the first-user-gesture audio resume). Keyboard
  // listeners live on window, so this is belt-and-suspenders, not strictly required.
  await canvas.click({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(400)

  // Artifact: the menu.
  await page.screenshot({ path: 'test-results/gameplay-menu.png' })

  // Enter confirms NEW GAME (cursor defaults to the first row).
  await page.keyboard.press('Enter')
  // Let the world build and render a few frames.
  await page.waitForTimeout(700)

  const before = await frame(canvas)
  const sigBefore = signature(before)

  // Move forward for ~300ms, then turn, then fire.
  await holdKey(page, 'KeyW', 300)
  await page.waitForTimeout(150)
  await holdKey(page, 'ArrowLeft', 300)
  await page.waitForTimeout(150)
  await page.keyboard.press('Space') // fire
  await page.waitForTimeout(400)

  // Artifact: in-game.
  await page.screenshot({ path: 'test-results/gameplay-ingame.png' })

  const after = await frame(canvas)
  const sigAfter = signature(after)

  // The world rendered and responded: the two frames must differ. We never assert
  // exact pixels — only that movement/turning produced a materially different image.
  const moved = divergence(sigBefore, sigAfter)
  expect(moved, `frames did not change enough (divergence=${moved.toFixed(4)})`).toBeGreaterThan(
    0.01,
  )

  // Sanity: both captures are real, non-trivial PNGs.
  expect(before.length).toBeGreaterThan(1000)
  expect(after.length).toBeGreaterThan(1000)
})
