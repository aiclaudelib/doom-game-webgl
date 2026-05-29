import { expect, test } from '@playwright/test'
import type { ConsoleMessage, Page } from '@playwright/test'

// The engine renders entirely into one <canvas>. A healthy boot means: the canvas
// exists and is sized, nothing logged an error or threw, and the canvas actually
// painted something non-trivial (not a single flat colour).
//
// Robust capture note: WebGL is created with preserveDrawingBuffer:false, so
// canvas.toDataURL() can come back blank. Element screenshots go through the
// browser compositor and always reflect what is on screen — for BOTH the WebGL
// and the Canvas2D fallback — so we sign frames from screenshots, never the
// drawing buffer.

/** Wait until the engine has had a few animation frames to paint. */
async function settle(page: Page, ms = 600): Promise<void> {
  await page.waitForTimeout(ms)
}

/** Count distinct byte values in a PNG buffer — a cheap proxy for "not uniform". */
function byteVariety(buffer: Buffer): number {
  const seen = new Set<number>()
  // Sample across the whole buffer so a large header doesn't dominate.
  const stride = Math.max(1, Math.floor(buffer.length / 4096))
  for (let i = 0; i < buffer.length; i += stride) {
    seen.add(buffer[i] ?? 0)
  }
  return seen.size
}

test('boots cleanly and paints a non-blank canvas with no console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', err => {
    pageErrors.push(err.message)
  })

  await page.goto('/')

  // The canvas must be present and visibly sized.
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()

  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  expect(box?.width ?? 0).toBeGreaterThan(0)
  expect(box?.height ?? 0).toBeGreaterThan(0)

  // The backing store has real resolution (not a 0x0 canvas).
  const backing = await canvas.evaluate((el: HTMLCanvasElement) => ({
    w: el.width,
    h: el.height,
  }))
  expect(backing.w).toBeGreaterThan(0)
  expect(backing.h).toBeGreaterThan(0)

  // Give the loop a moment to render the menu.
  await settle(page)

  // First frame: a real PNG of meaningful size with varied bytes (not flat fill).
  const shotA = await canvas.screenshot()
  expect(shotA.length).toBeGreaterThan(1000)
  // PNG magic number.
  expect(shotA[0]).toBe(0x89)
  expect(shotA[1]).toBe(0x50) // 'P'
  expect(byteVariety(shotA)).toBeGreaterThan(8)

  // Second frame after a short delay: still a valid, non-trivial PNG. The DOOM
  // title menu is mostly static, so we do not require A and B to differ here —
  // only that painting keeps producing real, varied output (no white-out / crash).
  await settle(page, 300)
  const shotB = await canvas.screenshot()
  expect(shotB.length).toBeGreaterThan(1000)
  expect(byteVariety(shotB)).toBeGreaterThan(8)

  // No errors of any kind during boot + first render.
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([])
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
})
