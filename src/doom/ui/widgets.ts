// Shared canvas-UI building blocks reused by hud.ts and menu.ts.
// No game-logic imports — pure drawing on the framebuffer.

import type { Framebuffer } from '~/doom/types'
import type { Rgb } from '~/doom/core/color'
import { mix, pal, shade } from '~/doom/core/color'
import { drawRect, drawText, drawTextCentered, fillRect } from '~/doom/engine/framebuffer'

/**
 * Structural mirror of `game/world.ts`'s `WorldStats`, declared here so the UI layer stays
 * within its import allowlist (types/config/core-color/framebuffer) and typechecks without a
 * forward dependency on the simulation. The shapes are identical, so the engine can pass the
 * live `World.stats` straight into the HUD/menu renderers.
 */
export interface WorldStats {
  readonly kills: number
  readonly totalEnemies: number
  readonly level: string
}

/** Dark filled panel with a lighter 1px border — the chrome behind every UI block. */
export function drawPanel(fb: Framebuffer, x: number, y: number, w: number, h: number): void {
  fillRect(fb, x, y, w, h, shade(pal('black'), 1.4), 220)
  drawRect(fb, x, y, w, h, pal('steel'))
}

/** Horizontal gauge: bg track with an fg fill spanning `fill` (0..1) of the width. */
export function drawBar(
  fb: Framebuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  fg: Rgb,
  bg: Rgb,
): void {
  const frac = fill < 0 ? 0 : fill > 1 ? 1 : fill
  fillRect(fb, x, y, w, h, bg)
  const fillW = Math.round((w - 2) * frac)
  if (fillW > 0) {
    fillRect(fb, x + 1, y + 1, fillW, h - 2, fg)
  }
  drawRect(fb, x, y, w, h, shade(bg, 1.6))
}

/** A labelled slider row: label, track + knob, numeric value. Highlighted when selected. */
export function drawSlider(
  fb: Framebuffer,
  label: string,
  value: number,
  x: number,
  y: number,
  w: number,
  selected: boolean,
): void {
  const frac = value < 0 ? 0 : value > 1 ? 1 : value
  const labelColor = selected ? pal('yellow') : pal('lightGray')
  drawText(fb, label, x, y, labelColor)

  const trackY = y + 9
  const trackH = 4
  fillRect(fb, x, trackY, w, trackH, pal('darkSteel'))
  drawRect(fb, x, trackY, w, trackH, pal('steel'))

  const fillW = Math.round((w - 2) * frac)
  if (fillW > 0) {
    fillRect(fb, x + 1, trackY + 1, fillW, trackH - 2, selected ? pal('orange') : pal('gray'))
  }

  const knobX = x + Math.round((w - 5) * frac)
  fillRect(fb, knobX, trackY - 2, 5, trackH + 4, selected ? pal('white') : pal('lightGray'))

  const pct = `${Math.round(frac * 100)}`
  drawText(fb, pct, x + w + 6, y, labelColor)
}

/** Vertically stacked, horizontally centred menu items with a `>` cursor marker. */
export function drawMenuList(
  fb: Framebuffer,
  items: readonly string[],
  cursor: number,
  cx: number,
  y: number,
  lineH: number,
): void {
  for (let i = 0; i < items.length; i++) {
    const label = items[i] ?? ''
    const active = i === cursor
    const rowY = y + i * lineH
    const color = active ? pal('yellow') : pal('lightGray')
    drawTextCentered(fb, active ? `> ${label} <` : label, cx, rowY, color)
  }
}

/** Big scaled red title rendered through the bitmap font (uses drawTextCentered). */
export function drawTitle(fb: Framebuffer, text: string, cx: number, y: number): void {
  const scale = 6
  const shadow = mix(pal('darkRed'), pal('black'), 0.4)
  drawTextCentered(fb, text, cx + scale, y + scale, shadow, scale)
  drawTextCentered(fb, text, cx, y, pal('red'), scale)
}

/** Inclusive-left, exclusive-right rectangle hit-test for mouse interaction. */
export function pointInRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  return px >= x && px < x + w && py >= y && py < y + h
}
