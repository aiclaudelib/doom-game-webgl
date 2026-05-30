// THE shared draw core: every pixel the engine emits goes through these primitives.
// Pure typed-array work — no GL, no DOM — so it runs identically under jsdom.

import type { Framebuffer, Texture } from '~/doom/types'
import type { Rgb } from '~/doom/core/color'
import { fillRgba, packShade } from '~/doom/core/color'
import { GLYPH_H, GLYPH_W, GLYPH_SPACING, glyphRows, textWidth } from '~/doom/engine/font'

/** Allocate a zeroed RGBA framebuffer (opaque black until cleared/drawn). */
export function createFramebuffer(width: number, height: number): Framebuffer {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }
}

/** Fill the entire buffer with an opaque colour. */
export function clear(fb: Framebuffer, c: Rgb): void {
  fillRgba(fb.data, c)
}

/**
 * Blend RGB into a buffer at byte offset `o`, writing opaque alpha.
 * Fast paths: alpha<=0 is a no-op; alpha>=255 writes the source directly.
 */
function blendInto(
  data: Uint8ClampedArray,
  o: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  if (alpha <= 0) return
  if (alpha >= 255) {
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = 255
    return
  }
  const a = alpha / 255
  const ia = 1 - a
  const dr = data[o] ?? 0
  const dg = data[o + 1] ?? 0
  const db = data[o + 2] ?? 0
  data[o] = r * a + dr * ia
  data[o + 1] = g * a + dg * ia
  data[o + 2] = b * a + db * ia
  data[o + 3] = 255
}

/** Bounds-checked, alpha-blended single pixel write. */
export function setPixel(fb: Framebuffer, x: number, y: number, c: Rgb, alpha = 255): void {
  if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return
  const o = (y * fb.width + x) * 4
  blendInto(fb.data, o, c[0], c[1], c[2], alpha)
}

/** Filled rectangle. Clipped to the buffer; alpha-blended per pixel. */
export function fillRect(
  fb: Framebuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  c: Rgb,
  alpha = 255,
): void {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(fb.width, Math.floor(x + w))
  const y1 = Math.min(fb.height, Math.floor(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      setPixel(fb, px, py, c, alpha)
    }
  }
}

/** 1px rectangle outline. */
export function drawRect(
  fb: Framebuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  c: Rgb,
): void {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.floor(x + w - 1)
  const y1 = Math.floor(y + h - 1)
  for (let px = x0; px <= x1; px++) {
    setPixel(fb, px, y0, c)
    setPixel(fb, px, y1, c)
  }
  for (let py = y0; py <= y1; py++) {
    setPixel(fb, x0, py, c)
    setPixel(fb, x1, py, c)
  }
}

/** Bresenham line. */
export function drawLine(
  fb: Framebuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: Rgb,
): void {
  let px = Math.floor(x0)
  let py = Math.floor(y0)
  const ex = Math.floor(x1)
  const ey = Math.floor(y1)
  const dx = Math.abs(ex - px)
  const dy = -Math.abs(ey - py)
  const sx = px < ex ? 1 : -1
  const sy = py < ey ? 1 : -1
  let err = dx + dy
  for (;;) {
    setPixel(fb, px, py, c)
    if (px === ex && py === ey) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      px += sx
    }
    if (e2 <= dx) {
      err += dx
      py += sy
    }
  }
}

/** Draw one scaled glyph block at (gx, gy). Each font pixel becomes a scale×scale block. */
function drawGlyph(
  fb: Framebuffer,
  rows: readonly number[],
  gx: number,
  gy: number,
  c: Rgb,
  scale: number,
): void {
  for (let ry = 0; ry < GLYPH_H; ry++) {
    const bits = rows[ry] ?? 0
    for (let rx = 0; rx < GLYPH_W; rx++) {
      // Bit (GLYPH_W-1) is the leftmost pixel.
      const on = (bits >> (GLYPH_W - 1 - rx)) & 1
      if (on === 0) continue
      const bx = gx + rx * scale
      const by = gy + ry * scale
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          setPixel(fb, bx + sx, by + sy, c)
        }
      }
    }
  }
}

/** Draw left-aligned text starting at (x, y). Scale is an integer block factor. */
export function drawText(
  fb: Framebuffer,
  text: string,
  x: number,
  y: number,
  c: Rgb,
  scale = 1,
): void {
  const step = Math.max(1, Math.floor(scale))
  const advance = (GLYPH_W + GLYPH_SPACING) * step
  let cursor = Math.floor(x)
  const top = Math.floor(y)
  for (let i = 0; i < text.length; i++) {
    const rows = glyphRows(text.charAt(i))
    drawGlyph(fb, rows, cursor, top, c, step)
    cursor += advance
  }
}

/** Draw text horizontally centred about cx. */
export function drawTextCentered(
  fb: Framebuffer,
  text: string,
  cx: number,
  y: number,
  c: Rgb,
  scale = 1,
): void {
  const step = Math.max(1, Math.floor(scale))
  const w = textWidth(text, step)
  drawText(fb, text, Math.floor(cx - w / 2), y, c, step)
}

/**
 * Shared alpha-test blit core for the first-person viewmodel layers. Walks every texel
 * of `tex` at integer `scale`, culls fully transparent ones (alpha < 128), and hands each
 * surviving texel's colour + destination to `write`. `blitTexture`/`blitTextureBright`
 * differ ONLY in that callback — the loop/scale/cull logic lives here once (no dup).
 */
function blitTexels(
  fb: Framebuffer,
  tex: Texture,
  dx: number,
  dy: number,
  scale: number,
  write: (fb: Framebuffer, px: number, py: number, c: Rgb, alpha: number) => void,
): void {
  const step = Math.max(1, Math.floor(scale))
  const data = tex.data
  const x0 = Math.floor(dx)
  const y0 = Math.floor(dy)
  for (let ty = 0; ty < tex.height; ty++) {
    for (let tx = 0; tx < tex.width; tx++) {
      const o = (ty * tex.width + tx) * 4
      const alpha = data[o + 3] ?? 0
      if (alpha < 128) continue
      const c: Rgb = [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0]
      const px = x0 + tx * step
      const py = y0 + ty * step
      for (let sy = 0; sy < step; sy++) {
        for (let sx = 0; sx < step; sx++) {
          write(fb, px + sx, py + sy, c, alpha)
        }
      }
    }
  }
}

/** Bounds-checked additive write: accumulate `c * boost` toward white over the destination. */
function addPixel(fb: Framebuffer, x: number, y: number, c: Rgb, boost: number): void {
  if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return
  const o = (y * fb.width + x) * 4
  const data = fb.data
  data[o] = Math.min(255, (data[o] ?? 0) + c[0] * boost)
  data[o + 1] = Math.min(255, (data[o + 1] ?? 0) + c[1] * boost)
  data[o + 2] = Math.min(255, (data[o + 2] ?? 0) + c[2] * boost)
  data[o + 3] = 255
}

/** Blit a texture at integer scale with alpha-test (skip fully transparent texels). */
export function blitTexture(
  fb: Framebuffer,
  tex: Texture,
  dx: number,
  dy: number,
  scale = 1,
): void {
  blitTexels(fb, tex, dx, dy, scale, setPixel)
}

/**
 * Additive muzzle-flash blit: same alpha-test loop as `blitTexture`, but each surviving
 * texel is ADDED to the destination (clamped to white) instead of overwriting it, so the
 * flash brightens whatever sits behind the gun. `boost` scales the added light (1 = raw add).
 * A transparent texel (alpha < 128) is culled, leaving the background untouched.
 */
export function blitTextureBright(
  fb: Framebuffer,
  tex: Texture,
  dx: number,
  dy: number,
  scale = 1,
  boost = 1,
): void {
  blitTexels(fb, tex, dx, dy, scale, (b, px, py, c) => addPixel(b, px, py, c, boost))
}

/**
 * One vertical textured strip — the shared primitive for walls AND sprites.
 *
 * Draws screen column `sx` over the clipped y-range [drawStart, drawEnd] —
 * inclusive of the last row (callers pass drawEnd as an inclusive bottom row
 * clamped to VIEW_H - 1). The texture row is mapped from the UNCLIPPED projected
 * span (spanTop, spanHeight) so clipping at the viewport edges never distorts the
 * texture mapping. RGB is shaded by `intensity`; with `alphaTest`, texels whose
 * alpha < 128 are skipped.
 *
 * `fuzz` paints the Spectre partial-invisibility shimmer: a DETERMINISTIC checkerboard
 * dither keyed off the screen coordinates (`(sx + y) & 1`) drops every other texel so
 * the billboard reads as a flickering shadow. Derived purely from coordinates — no RNG,
 * no clock — so the render stays headless-safe and reproducible.
 */
export function paintColumn(
  fb: Framebuffer,
  sx: number,
  drawStart: number,
  drawEnd: number,
  spanTop: number,
  spanHeight: number,
  tex: Texture,
  texX: number,
  intensity: number,
  alphaTest: boolean,
  fuzz = false,
): void {
  if (sx < 0 || sx >= fb.width) return
  if (spanHeight <= 0) return
  // Clamp the visible range into the buffer. drawEnd is the INCLUSIVE last row.
  let y0 = Math.floor(drawStart)
  let y1 = Math.floor(drawEnd)
  if (y0 < 0) y0 = 0
  if (y1 > fb.height - 1) y1 = fb.height - 1
  if (y0 > y1) return

  const texW = tex.width
  const texH = tex.height
  if (texW <= 0 || texH <= 0) return
  let tx = Math.floor(texX)
  if (tx < 0) tx = 0
  else if (tx >= texW) tx = texW - 1

  const data = fb.data
  const tdata = tex.data
  const fbWidth = fb.width
  const invSpan = texH / spanHeight

  for (let y = y0; y <= y1; y++) {
    // Fuzz: a deterministic screen-coord checkerboard hides half the texels so the
    // Spectre shimmers as a partial shadow. Stable per (sx, y) — no RNG, no clock.
    if (fuzz && ((sx + y) & 1) === 0) continue
    // Map screen-y back through the unclipped span to a texture row.
    let v = Math.floor((y - spanTop) * invSpan)
    if (v < 0) v = 0
    else if (v >= texH) v = texH - 1
    const to = (v * texW + tx) * 4
    const alpha = tdata[to + 3] ?? 0
    if (alphaTest && alpha < 128) continue
    const src: Rgb = [tdata[to] ?? 0, tdata[to + 1] ?? 0, tdata[to + 2] ?? 0]
    const shaded = packShade(src, intensity)
    const o = (y * fbWidth + sx) * 4
    blendInto(data, o, shaded[0], shaded[1], shaded[2], alpha)
  }
}
