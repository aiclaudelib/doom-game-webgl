// Procedural asset generator. Builds every wall, flat, enemy, weapon, pickup and
// projectile texture deterministically from a single seed. PURE and reproducible:
// the same seed always yields byte-identical output (all randomness flows through
// the seeded Rng / noise helpers, never wall-clock or Math.random).
//
// Index agreement with game/map.ts is MANDATORY — see the wall/flat tables below.

import { TEXTURE_SIZE } from '~/doom/config'
import type {
  Assets,
  EnemyKind,
  EnemyVisual,
  PickupKind,
  ProjectileKind,
  Rng,
  Texture,
  WeaponKind,
  WeaponVisual,
} from '~/doom/types'
import { mix, pal, shade } from '~/doom/core/color'
import type { Rgb } from '~/doom/core/color'
import { mulberry32, randRange } from '~/doom/core/rng'
import { fbm, hash2 } from '~/doom/engine/noise'
import { createTexture, fillTexture, setTexel } from '~/doom/engine/texture'

// ─────────────────────────────────────────────────────────────────────────────
// Low-level shared primitives (every generator routes through these — never copy)
// ─────────────────────────────────────────────────────────────────────────────

/** Filled axis-aligned rectangle, clipped to the texture, opaque unless alpha given. */
function rect(tex: Texture, x: number, y: number, w: number, h: number, c: Rgb, alpha = 255): void {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(tex.width, Math.floor(x + w))
  const y1 = Math.min(tex.height, Math.floor(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      setTexel(tex, px, py, c, alpha)
    }
  }
}

/** 1px outline rectangle. */
function outline(tex: Texture, x: number, y: number, w: number, h: number, c: Rgb): void {
  rect(tex, x, y, w, 1, c)
  rect(tex, x, y + h - 1, w, 1, c)
  rect(tex, x, y, 1, h, c)
  rect(tex, x + w - 1, y, 1, h, c)
}

/** Horizontal line of width w at (x,y). */
function hline(tex: Texture, x: number, y: number, w: number, c: Rgb, alpha = 255): void {
  rect(tex, x, y, w, 1, c, alpha)
}

/** Vertical line of height h at (x,y). */
function vline(tex: Texture, x: number, y: number, h: number, c: Rgb, alpha = 255): void {
  rect(tex, x, y, 1, h, c, alpha)
}

/** Filled axis-aligned ellipse centred at (cx,cy) with radii (rx,ry). */
function ellipse(
  tex: Texture,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: Rgb,
  alpha = 255,
): void {
  if (rx <= 0 || ry <= 0) return
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(tex.width - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(tex.height - 1, Math.ceil(cy + ry))
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const nx = (px + 0.5 - cx) / rx
      const ny = (py + 0.5 - cy) / ry
      if (nx * nx + ny * ny <= 1) setTexel(tex, px, py, c, alpha)
    }
  }
}

/** Filled circle — ellipse with equal radii. */
function disc(tex: Texture, cx: number, cy: number, r: number, c: Rgb, alpha = 255): void {
  ellipse(tex, cx, cy, r, r, c, alpha)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fill routines for walls & flats
// ─────────────────────────────────────────────────────────────────────────────

/** Per-pixel callback returning the colour for a texel, or null to leave transparent. */
type ShaderFn = (px: number, py: number) => Rgb | null

/** Run a per-pixel shader across the whole texture — the one noise-fill routine. */
function paint(tex: Texture, fn: ShaderFn): void {
  for (let py = 0; py < tex.height; py++) {
    for (let px = 0; px < tex.width; px++) {
      const c = fn(px, py)
      if (c !== null) setTexel(tex, px, py, c)
    }
  }
}

/**
 * Mottled noise-fill: blends base→accent by fbm and adds a little per-texel grit.
 * The single shared body behind stone, metal and tech surfaces.
 */
function noiseFill(
  tex: Texture,
  base: Rgb,
  accent: Rgb,
  seed: number,
  scale: number,
  octaves: number,
  grit: number,
): void {
  paint(tex, (px, py) => {
    const n = fbm(px / scale, py / scale, seed, octaves)
    const g = (hash2(px, py, seed ^ 0x5151) - 0.5) * grit
    return shade(mix(base, accent, n), 1 + g)
  })
}

/**
 * One parametrized brick/panel routine for the masonry-style walls.
 * Draws offset courses of bricks separated by mortar, each brick noise-textured.
 */
interface BrickParams {
  brick: Rgb
  brickAlt: Rgb
  mortar: Rgb
  rows: number
  cols: number
  seed: number
}

function brickWall(tex: Texture, p: BrickParams): void {
  fillTexture(tex, p.mortar)
  const rowH = tex.height / p.rows
  const colW = tex.width / p.cols
  const mortarPx = Math.max(1, Math.round(tex.width / 64))
  for (let r = 0; r < p.rows; r++) {
    const y = Math.round(r * rowH)
    const h = Math.round((r + 1) * rowH) - y - mortarPx
    const offset = r % 2 === 0 ? 0 : colW / 2
    for (let c = -1; c < p.cols; c++) {
      const x = Math.round(c * colW + offset)
      const w = Math.round(colW) - mortarPx
      const tone = hash2(r, c, p.seed) > 0.5 ? p.brick : p.brickAlt
      // Per-brick noise so masonry never looks flat.
      for (let by = 0; by < h; by++) {
        for (let bx = 0; bx < w; bx++) {
          const sx = x + bx
          const sy = y + by
          if (sx < 0 || sx >= tex.width || sy < 0 || sy >= tex.height) continue
          const n = fbm(sx / 6, sy / 6, p.seed ^ 0x77, 3)
          const edge = bx < 2 || by < 2 || bx > w - 3 || by > h - 3 ? 0.82 : 1
          setTexel(tex, sx, sy, shade(tone, (0.78 + n * 0.34) * edge))
        }
      }
    }
  }
}

/**
 * One parametrized metal/tech panel routine: noise base, riveted border, and
 * optional inner detail lines. Drives metal, door and tech-panel surfaces.
 */
interface PanelParams {
  base: Rgb
  accent: Rgb
  trim: Rgb
  rivet: Rgb
  seed: number
  rows: number
  cols: number
  scanlines: boolean
}

function panelWall(tex: Texture, p: PanelParams): void {
  noiseFill(tex, p.base, p.accent, p.seed, 9, 3, 0.1)
  const cellW = tex.width / p.cols
  const cellH = tex.height / p.rows
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const x = Math.round(c * cellW)
      const y = Math.round(r * cellH)
      const w = Math.round((c + 1) * cellW) - x
      const h = Math.round((r + 1) * cellH) - y
      outline(tex, x + 1, y + 1, w - 2, h - 2, p.trim)
      // Bevel: light top/left, dark bottom/right.
      hline(tex, x + 1, y + 1, w - 2, shade(p.trim, 1.4))
      vline(tex, x + 1, y + 1, h - 2, shade(p.trim, 1.4))
      hline(tex, x + 1, y + h - 2, w - 2, shade(p.trim, 0.55))
      vline(tex, x + w - 2, y + 1, h - 2, shade(p.trim, 0.55))
      // Corner rivets.
      const rv = Math.max(1, Math.round(tex.width / 32))
      disc(tex, x + 4, y + 4, rv, p.rivet)
      disc(tex, x + w - 4, y + 4, rv, p.rivet)
      disc(tex, x + 4, y + h - 4, rv, p.rivet)
      disc(tex, x + w - 4, y + h - 4, rv, p.rivet)
      if (p.scanlines) {
        for (let sy = y + 6; sy < y + h - 6; sy += 4) {
          hline(tex, x + 5, sy, w - 10, p.accent, 70)
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Walls — index agreement with game/map.ts (DO NOT reorder)
// ─────────────────────────────────────────────────────────────────────────────

function placeholderWall(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  const a = pal('darkGray')
  const b = pal('red')
  const cell = TEXTURE_SIZE / 8
  paint(tex, (px, py) => {
    const cx = Math.floor(px / cell)
    const cy = Math.floor(py / cell)
    return (cx + cy) % 2 === 0 ? a : b
  })
  // A little grit so it is not perfectly flat even as a placeholder.
  void seed
  return tex
}

function brickTexture(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  brickWall(tex, {
    brick: pal('brown'),
    brickAlt: pal('darkBrown'),
    mortar: shade(pal('darkBrown'), 0.55),
    rows: 8,
    cols: 4,
    seed,
  })
  return tex
}

function metalTexture(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  panelWall(tex, {
    base: pal('steel'),
    accent: pal('darkSteel'),
    trim: pal('darkSteel'),
    rivet: pal('lightGray'),
    seed,
    rows: 2,
    cols: 2,
    scanlines: false,
  })
  return tex
}

function techTexture(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  panelWall(tex, {
    base: shade(pal('darkSteel'), 0.85),
    accent: pal('black'),
    trim: pal('cyan'),
    rivet: pal('cyan'),
    seed,
    rows: 3,
    cols: 2,
    scanlines: true,
  })
  return tex
}

/** Door face: a tech panel with a central vertical seam + warning trim. */
function doorTexture(seed: number, trim: Rgb): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  panelWall(tex, {
    base: pal('darkSteel'),
    accent: pal('black'),
    trim: shade(trim, 0.7),
    rivet: pal('steel'),
    seed,
    rows: 2,
    cols: 1,
    scanlines: false,
  })
  const mid = Math.round(TEXTURE_SIZE / 2)
  // Central seam where the two leaves meet.
  vline(tex, mid - 1, 0, TEXTURE_SIZE, pal('black'))
  vline(tex, mid, 0, TEXTURE_SIZE, shade(pal('steel'), 1.2))
  // Warning trim bands top & bottom.
  const bandH = Math.max(3, Math.round(TEXTURE_SIZE / 12))
  for (let px = 0; px < TEXTURE_SIZE; px++) {
    const stripe = Math.floor(px / 4) % 2 === 0 ? trim : pal('black')
    vline(tex, px, 1, bandH, stripe)
    vline(tex, px, TEXTURE_SIZE - bandH - 1, bandH, stripe)
  }
  return tex
}

/** Exit switch wall: metal panel with a large glowing button. */
function exitTexture(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  panelWall(tex, {
    base: pal('darkSteel'),
    accent: pal('black'),
    trim: pal('steel'),
    rivet: pal('lightGray'),
    seed,
    rows: 1,
    cols: 1,
    scanlines: false,
  })
  const cx = TEXTURE_SIZE / 2
  const cy = TEXTURE_SIZE / 2
  // Recessed housing.
  rect(tex, cx - 14, cy - 14, 28, 28, pal('black'))
  outline(tex, cx - 14, cy - 14, 28, 28, pal('steel'))
  // Glowing button — radial green falloff for a lit look.
  paint(tex, (px, py) => {
    const dx = px + 0.5 - cx
    const dy = py + 0.5 - cy
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d > 11) return null
    const glow = 1 - d / 11
    return mix(pal('darkGreen'), pal('green'), glow)
  })
  disc(tex, cx, cy, 3, shade(pal('green'), 1.6))
  return tex
}

/** Secret wall: deliberately identical brick look (a different seed keeps it subtle). */
function secretTexture(seed: number): Texture {
  return brickTexture(seed ^ 0x9e37)
}

function buildWalls(rng: Rng): readonly Texture[] {
  const s = () => Math.floor(randRange(rng, 1, 0x7fffffff))
  return [
    placeholderWall(s()),
    brickTexture(s()),
    metalTexture(s()),
    techTexture(s()),
    doorTexture(s(), pal('yellow')),
    exitTexture(s()),
    secretTexture(s()),
    doorTexture(s(), pal('red')),
    doorTexture(s(), pal('blue')),
    doorTexture(s(), pal('yellow')),
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Flats (floor / ceiling)
// ─────────────────────────────────────────────────────────────────────────────

function stoneFloor(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  noiseFill(tex, pal('gray'), pal('darkGray'), seed, 7, 4, 0.16)
  // Subtle flagstone grid.
  for (let i = 1; i < 4; i++) {
    const p = Math.round((TEXTURE_SIZE / 4) * i)
    hline(tex, 0, p, TEXTURE_SIZE, pal('black'), 60)
    vline(tex, p, 0, TEXTURE_SIZE, pal('black'), 60)
  }
  return tex
}

function metalFloor(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  noiseFill(tex, pal('darkSteel'), pal('steel'), seed, 11, 3, 0.08)
  // Diamond-plate hatching.
  paint(tex, (px, py) => {
    return (px + py) % 8 === 0 || (px - py + TEXTURE_SIZE) % 8 === 0
      ? shade(pal('steel'), 1.25)
      : null
  })
  return tex
}

function darkCeiling(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  noiseFill(tex, shade(pal('darkGray'), 0.7), pal('black'), seed, 13, 3, 0.1)
  return tex
}

function techCeiling(seed: number): Texture {
  const tex = createTexture(TEXTURE_SIZE, TEXTURE_SIZE)
  noiseFill(tex, pal('darkSteel'), pal('black'), seed, 10, 3, 0.06)
  // Inset light fixtures.
  const step = TEXTURE_SIZE / 2
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 2; gx++) {
      const cx = Math.round(gx * step + step / 2)
      const cy = Math.round(gy * step + step / 2)
      rect(tex, cx - 6, cy - 3, 12, 6, pal('black'))
      rect(tex, cx - 5, cy - 2, 10, 4, shade(pal('yellow'), 0.9))
      rect(tex, cx - 5, cy - 2, 10, 1, pal('white'))
    }
  }
  return tex
}

function buildFlats(rng: Rng): readonly Texture[] {
  const s = () => Math.floor(randRange(rng, 1, 0x7fffffff))
  return [stoneFloor(s()), metalFloor(s()), darkCeiling(s()), techCeiling(s())]
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy sprites — one parametrized humanoid-blob routine reused per palette/pose
// ─────────────────────────────────────────────────────────────────────────────

const SPRITE_W = 48
const SPRITE_H = 56

/** Pose parameters fed into the shared humanoid routine. */
interface HumanoidParams {
  body: Rgb
  bodyDark: Rgb
  limb: Rgb
  eye: Rgb
  seed: number
  legSwing: number // -1..1 leg stride phase
  armRaise: number // 0 = down, 1 = raised (attack)
  lean: number // -1..1 body lean
  horns: boolean
  bulky: boolean
}

/** Texture-mottle helper so big flat blobs of skin get internal shading. */
function mottle(c: Rgb, px: number, py: number, seed: number): Rgb {
  const n = fbm(px / 7, py / 7, seed, 2)
  return shade(c, 0.82 + n * 0.32)
}

/**
 * THE single humanoid-blob sprite routine. Builds a recognizable front-facing
 * silhouette (head, torso, two arms, two legs) on a transparent background.
 * Reused for grunt/imp/demon by varying palette, proportions and pose.
 */
function humanoid(p: HumanoidParams): Texture {
  const tex = createTexture(SPRITE_W, SPRITE_H)
  const cx = SPRITE_W / 2 + p.lean * 3
  const widthMul = p.bulky ? 1.35 : 1
  // Geometry anchored to the bottom of the frame (feet on the floor).
  const headR = (p.bulky ? 9 : 7) * 1
  const headCy = 9
  const torsoTop = headCy + headR - 1
  const torsoBottom = SPRITE_H - 16
  const torsoHalf = (p.bulky ? 13 : 9) * widthMul

  // Legs (stride driven by legSwing).
  const legTop = torsoBottom - 2
  const legBottom = SPRITE_H - 2
  const legHalf = (p.bulky ? 6 : 4) * widthMul
  const stride = p.legSwing * 4
  rect(tex, cx - torsoHalf * 0.7 - stride, legTop, legHalf, legBottom - legTop, p.limb)
  rect(tex, cx + torsoHalf * 0.7 - legHalf + stride, legTop, legHalf, legBottom - legTop, p.limb)
  // Feet.
  rect(tex, cx - torsoHalf * 0.7 - stride - 1, legBottom - 2, legHalf + 3, 3, p.bodyDark)
  rect(tex, cx + torsoHalf * 0.7 - legHalf + stride - 1, legBottom - 2, legHalf + 3, 3, p.bodyDark)

  // Torso — mottled ellipse.
  for (let py = torsoTop; py < torsoBottom; py++) {
    const t = (py - torsoTop) / (torsoBottom - torsoTop)
    const half = torsoHalf * (0.85 + 0.25 * Math.sin(t * Math.PI))
    for (let px = Math.round(cx - half); px <= Math.round(cx + half); px++) {
      if (px < 0 || px >= SPRITE_W) continue
      setTexel(tex, px, py, mottle(p.body, px, py, p.seed))
    }
  }

  // Arms — raised toward the player on attack frames.
  const shoulderY = torsoTop + 3
  const armLen = torsoBottom - shoulderY - 2
  const armW = (p.bulky ? 5 : 4) * widthMul
  const raise = p.armRaise
  const armDropL = Math.round(armLen * (1 - raise * 0.8))
  const lx = Math.round(cx - torsoHalf - armW + 1)
  const rx = Math.round(cx + torsoHalf - 1)
  rect(tex, lx, shoulderY - Math.round(raise * 6), armW, armDropL + 4, p.limb)
  rect(tex, rx, shoulderY - Math.round(raise * 6), armW, armDropL + 4, p.limb)
  if (raise > 0.5) {
    // Clawed/fisted hands thrust forward (centred) when attacking.
    disc(tex, cx - torsoHalf - 1, shoulderY - 5, 3, p.bodyDark)
    disc(tex, cx + torsoHalf + 1, shoulderY - 5, 3, p.bodyDark)
  }

  // Head.
  ellipse(tex, cx, headCy, headR, headR + 1, p.body)
  for (let py = headCy - headR; py <= headCy + headR; py++) {
    for (let px = Math.round(cx - headR); px <= Math.round(cx + headR); px++) {
      const dx = (px + 0.5 - cx) / headR
      const dy = (py + 0.5 - headCy) / (headR + 1)
      if (dx * dx + dy * dy <= 1 && px >= 0 && px < SPRITE_W) {
        setTexel(tex, px, py, mottle(p.body, px, py, p.seed ^ 0x33))
      }
    }
  }
  // Eyes — glowing.
  disc(tex, cx - headR * 0.45, headCy, 1.6, p.eye)
  disc(tex, cx + headR * 0.45, headCy, 1.6, p.eye)
  if (p.horns) {
    // Brown-imp horns sweeping up from the temples.
    for (let i = 0; i < headR; i++) {
      setTexel(tex, Math.round(cx - headR + i * 0.3), headCy - headR - i, p.bodyDark)
      setTexel(tex, Math.round(cx + headR - i * 0.3), headCy - headR - i, p.bodyDark)
    }
  }
  return tex
}

/** A flattened corpse blob for the final death frame. */
function corpse(body: Rgb, bodyDark: Rgb, seed: number): Texture {
  const tex = createTexture(SPRITE_W, SPRITE_H)
  const cy = SPRITE_H - 6
  ellipse(tex, SPRITE_W / 2, cy, 18, 5, body)
  ellipse(tex, SPRITE_W / 2 - 6, cy + 1, 8, 3, bodyDark)
  // Blood pool.
  ellipse(tex, SPRITE_W / 2 + 8, cy + 3, 12, 3, shade(pal('darkRed'), 1.1))
  void seed
  return tex
}

interface EnemyPalette {
  body: Rgb
  bodyDark: Rgb
  limb: Rgb
  eye: Rgb
  horns: boolean
  bulky: boolean
}

const ENEMY_PALETTES: Readonly<Record<EnemyKind, EnemyPalette>> = {
  grunt: {
    body: pal('darkGreen'),
    bodyDark: shade(pal('darkGreen'), 0.6),
    limb: shade(pal('darkGreen'), 0.8),
    eye: pal('yellow'),
    horns: false,
    bulky: false,
  },
  shotgunGuy: {
    body: pal('brown'),
    bodyDark: shade(pal('brown'), 0.55),
    limb: shade(pal('brown'), 0.75),
    eye: pal('yellow'),
    horns: false,
    bulky: false,
  },
  chaingunner: {
    body: pal('darkRed'),
    bodyDark: shade(pal('darkRed'), 0.6),
    limb: shade(pal('darkRed'), 0.8),
    eye: pal('orange'),
    horns: false,
    bulky: false,
  },
  imp: {
    body: pal('brown'),
    bodyDark: pal('darkBrown'),
    limb: shade(pal('brown'), 0.85),
    eye: pal('orange'),
    horns: true,
    bulky: false,
  },
  demon: {
    body: mix(pal('red'), pal('white'), 0.45),
    bodyDark: pal('darkRed'),
    limb: mix(pal('red'), pal('white'), 0.3),
    eye: pal('white'),
    horns: true,
    bulky: true,
  },
  spectre: {
    body: shade(pal('darkSteel'), 0.7),
    bodyDark: shade(pal('black'), 1.2),
    limb: shade(pal('darkSteel'), 0.55),
    eye: pal('cyan'),
    horns: true,
    bulky: true,
  },
  lostSoul: {
    body: shade(pal('lightGray'), 1.05),
    bodyDark: pal('gray'),
    limb: pal('orange'),
    eye: pal('red'),
    horns: true,
    bulky: false,
  },
  cacodemon: {
    body: shade(pal('blue'), 0.85),
    bodyDark: shade(pal('blue'), 0.5),
    limb: shade(pal('blue'), 0.7),
    eye: pal('red'),
    horns: true,
    bulky: true,
  },
  hellKnight: {
    body: mix(pal('brown'), pal('lightGray'), 0.35),
    bodyDark: pal('darkBrown'),
    limb: shade(pal('brown'), 0.7),
    eye: pal('green'),
    horns: true,
    bulky: true,
  },
  baron: {
    body: mix(pal('brown'), pal('red'), 0.3),
    bodyDark: shade(pal('darkRed'), 0.9),
    limb: shade(pal('brown'), 0.6),
    eye: pal('green'),
    horns: true,
    bulky: true,
  },
  mancubus: {
    body: mix(pal('brown'), pal('orange'), 0.4),
    bodyDark: pal('darkBrown'),
    limb: shade(pal('orange'), 0.7),
    eye: pal('yellow'),
    horns: false,
    bulky: true,
  },
  arachnotron: {
    body: shade(pal('steel'), 0.9),
    bodyDark: pal('darkSteel'),
    limb: pal('darkRed'),
    eye: pal('green'),
    horns: false,
    bulky: true,
  },
  revenant: {
    body: shade(pal('white'), 0.95),
    bodyDark: pal('lightGray'),
    limb: pal('gray'),
    eye: pal('orange'),
    horns: false,
    bulky: false,
  },
  // Pain Elemental — a bloated floating maw: pale fleshy body, dark underside, red eye.
  painElemental: {
    body: mix(pal('brown'), pal('lightGray'), 0.5),
    bodyDark: shade(pal('darkBrown'), 0.9),
    limb: shade(pal('brown'), 0.7),
    eye: pal('red'),
    horns: true,
    bulky: true,
  },
  // Arch-vile — gaunt and PALE with burning-orange eyes (the flame-caster necromancer).
  archvile: {
    body: shade(pal('white'), 0.9),
    bodyDark: pal('lightGray'),
    limb: shade(pal('lightGray'), 0.75),
    eye: pal('orange'),
    horns: false,
    bulky: false,
  },
  // Cyberdemon — a towering BULKY brown-steel cyborg with glowing-red eyes.
  cyberdemon: {
    body: mix(pal('brown'), pal('steel'), 0.45),
    bodyDark: shade(pal('darkBrown'), 0.85),
    limb: pal('darkSteel'),
    eye: pal('red'),
    horns: true,
    bulky: true,
  },
  // Spider Mastermind — a vast BULKY steel brain-on-legs with cold cyan eyes.
  spiderMastermind: {
    body: shade(pal('steel'), 0.95),
    bodyDark: shade(pal('darkSteel'), 0.85),
    limb: pal('gray'),
    eye: pal('cyan'),
    horns: false,
    bulky: true,
  },
  // Explosive barrel — a green-grey metal drum with red warning trim (eye colour).
  // Reuses the humanoid generator so headless still renders a barrel-ish billboard.
  barrel: {
    body: shade(pal('darkGreen'), 0.9),
    bodyDark: shade(pal('darkSteel'), 0.8),
    limb: pal('red'),
    eye: pal('orange'),
    horns: false,
    bulky: true,
  },
}

function buildEnemy(ep: EnemyPalette, rng: Rng): EnemyVisual {
  const seed = Math.floor(randRange(rng, 1, 0x7fffffff))
  const base = {
    body: ep.body,
    bodyDark: ep.bodyDark,
    limb: ep.limb,
    eye: ep.eye,
    seed,
    horns: ep.horns,
    bulky: ep.bulky,
  }
  const walk = [
    humanoid({ ...base, legSwing: 1, armRaise: 0, lean: 0.2 }),
    humanoid({ ...base, legSwing: -1, armRaise: 0, lean: -0.2 }),
  ]
  const attack = [
    humanoid({ ...base, legSwing: 0, armRaise: 0.6, lean: 0 }),
    humanoid({ ...base, legSwing: 0, armRaise: 1, lean: 0.1 }),
  ]
  const hurt = [humanoid({ ...base, legSwing: 0, armRaise: 0.2, lean: -0.6 })]
  // Death sequence: stagger → collapse → corpse.
  const die = [
    humanoid({ ...base, legSwing: 0.5, armRaise: 0.4, lean: -0.9 }),
    humanoid({ ...base, legSwing: -0.5, armRaise: 0.1, lean: -1 }),
    corpse(ep.body, ep.bodyDark, seed),
  ]
  return { walk, attack, hurt, die }
}

/**
 * Build a visual for every kind by walking the palette table — one call per kind,
 * no copied per-kind blocks. The kinds are visited in the table's declaration order
 * so the seed stream stays deterministic across the whole roster.
 */
function buildEnemies(rng: Rng): Readonly<Record<EnemyKind, EnemyVisual>> {
  const out = {} as Record<EnemyKind, EnemyVisual>
  for (const kind of Object.keys(ENEMY_PALETTES) as EnemyKind[]) {
    out[kind] = buildEnemy(ENEMY_PALETTES[kind], rng)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// First-person weapons — bottom-centre anchored, transparent background
// ─────────────────────────────────────────────────────────────────────────────

// Drawn in first person: a gloved hand + forearm rises from the BOTTOM edge of the
// canvas (nearest the player) gripping the weapon, and the gun recedes UP-AND-AWAY
// with a stepped taper — the muzzle ends up small and HIGH (far), while the receiver
// and the gripping hand are large and LOW (near). The forearm/fist deliberately
// dominate the lower third so the "I am holding this" read is unmistakable.
// Coordinate system: high y = near / low-on-screen (hands), low y = far / high-on-
// screen (muzzle). W*2 = 280 <= 320 wide and H*2 = 160 fills VIEW_H exactly (no clip).
const WEAPON_W = 140
const WEAPON_H = 80

/** Shared metallic body builder: a rounded box with a top highlight + bottom shade. */
function gunBody(tex: Texture, x: number, y: number, w: number, h: number, base: Rgb): void {
  rect(tex, x, y, w, h, base)
  hline(tex, x, y, w, shade(base, 1.5))
  hline(tex, x, y + h - 1, w, shade(base, 0.5))
  vline(tex, x, y, h, shade(base, 1.2))
  vline(tex, x + w - 1, y, h, shade(base, 0.6))
}

/**
 * Muzzle flash blob, drawn only on fire frames. IMPORTANT: blitTexture culls every
 * texel with alpha < 128 and setTexel OVERWRITES (no compositing), so the hot core
 * MUST be drawn LAST at full opacity and the coloured rings kept at alpha >= 128 —
 * otherwise the flash is silently dropped at blit time. Largest → smallest, opaque.
 */
function muzzleFlash(tex: Texture, cx: number, cy: number, r: number): void {
  disc(tex, cx, cy, r * 1.25, pal('orange'), 200) // outer corona (opaque enough to land)
  disc(tex, cx, cy, r, pal('yellow')) // bright body
  disc(tex, cx, cy, r * 0.55, pal('white')) // hot core drawn LAST, fully opaque
}

// ── First-person hand + foreshortening helpers ───────────────────────────────
// Every weapon roots its arm at the very bottom edge so the model belongs to the
// player. Foreshortening is faked with stacked 1px rows: parts are WIDEST + LOWEST
// near the viewer (high y) and narrow + recede as they rise (low y).

/**
 * A foreshortened gloved forearm running from the very bottom edge of the canvas up
 * to wrist height `topY`, centred on `cx`. Widest at the bottom (nearest the viewer),
 * tapering to `topW` at the wrist via width-stepped horizontal lines, with a lit left
 * rim, a shaded right rim and two leather cuff straps near the wrist.
 */
function forearm(
  tex: Texture,
  cx: number,
  topY: number,
  botW: number,
  topW: number,
  base: Rgb,
): void {
  const botY = WEAPON_H // run off the bottom edge → no gap up to the HUD bar
  const span = Math.max(1, botY - topY)
  const hi = shade(base, 1.25)
  const lo = shade(base, 0.6)
  for (let py = topY; py < botY; py++) {
    const t = (py - topY) / span // 0 at wrist (far), 1 at the bottom (near)
    const w = Math.round(topW + (botW - topW) * t)
    const x = Math.round(cx - w / 2)
    hline(tex, x, py, w, base)
    hline(tex, x, py, 2, hi) // left rim catches light
    hline(tex, x + w - 2, py, 2, lo) // right rim falls into shadow
  }
  // Two leather cuff straps wrapping the wrist/forearm.
  for (let s = 0; s < 2; s++) {
    const py = topY + 5 + s * 8
    const t = (py - topY) / span
    const w = Math.round(topW + (botW - topW) * t) + 2
    const x = Math.round(cx - w / 2)
    rect(tex, x, py, w, 3, shade(base, 0.5))
    hline(tex, x, py, w, shade(base, 0.85))
  }
}

/**
 * A gloved fist / gripping hand centred at (cx,cy): a rounded knuckle mass with a lit
 * highlight, four finger ridges across the top (the knuckles facing the muzzle) and a
 * thumb wad on the leading side (`dir` = +1 right / -1 left). Used both as the hand
 * that grips a gun and — for the fist weapon — as the punching knuckles themselves.
 * All shading is opaque so nothing is dropped by the alpha-test blit, and the body
 * rim is an ellipse (not a rect outline) so no square corner-ticks poke into the air.
 */
function glovedFist(
  tex: Texture,
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  base: Rgb,
  dir: number,
): void {
  const hi = shade(base, 1.25)
  const lo = shade(base, 0.55)
  // Palm / knuckle mass: a shaded ring (slightly larger ellipse) then the lit body.
  ellipse(tex, cx, cy, rw + 1, rh + 1, lo)
  ellipse(tex, cx, cy, rw, rh, base)
  ellipse(tex, cx - rw * 0.35, cy - rh * 0.2, rw * 0.55, rh * 0.6, hi)
  ellipse(tex, cx + rw * 0.4, cy + rh * 0.35, rw * 0.45, rh * 0.45, lo) // under-curl shadow
  // Four finger ridges across the top (knuckles facing the muzzle direction).
  const fw = (rw * 1.5) / 4
  for (let i = 0; i < 4; i++) {
    const fx = cx - rw * 0.72 + i * fw + fw / 2
    disc(tex, fx, cy - rh * 0.7, fw * 0.55, base)
    disc(tex, fx - 1, cy - rh * 0.78, fw * 0.3, hi)
    vline(tex, Math.round(fx + fw / 2), Math.round(cy - rh * 0.9), Math.round(rh * 0.7), lo)
  }
  // Thumb wad wrapping the leading side of the grip.
  ellipse(tex, cx + dir * rw * 0.95, cy + rh * 0.1, rw * 0.4, rh * 0.55, base)
  ellipse(tex, cx + dir * rw * 0.95, cy + rh * 0.1, rw * 0.22, rh * 0.32, hi)
}

/**
 * A stepped tapering barrel / gun body running upward from the near end (botY, wide)
 * to the far muzzle (topY, narrow) centred on `cx`. Width shrinks with height to fake
 * perspective; a bright central spine sells the cylindrical tube. Returns the muzzle
 * centre {mx,my} so callers can cap it and place flashes exactly at the far end.
 */
function taperBarrel(
  tex: Texture,
  cx: number,
  topY: number,
  botY: number,
  botW: number,
  topW: number,
  base: Rgb,
): { mx: number; my: number } {
  const span = Math.max(1, botY - topY)
  const hi = shade(base, 1.4)
  const lo = shade(base, 0.5)
  for (let py = topY; py < botY; py++) {
    const t = (py - topY) / span // 0 at the muzzle (far), 1 at the near end
    const w = Math.max(1, Math.round(topW + (botW - topW) * t))
    const x = Math.round(cx - w / 2)
    hline(tex, x, py, w, base)
    if (w >= 3) {
      vline(tex, x, py, 1, hi)
      vline(tex, x + w - 1, py, 1, lo)
    }
  }
  // Cylindrical spine highlight down the centre (opaque so it survives the blit).
  vline(tex, Math.round(cx) - 1, topY, span, hi)
  return { mx: Math.round(cx), my: topY }
}

type WeaponBuilder = (firing: boolean, recoil: number, spec: GunSpec) => Texture

/** Recolour/relabel knobs so one builder family serves several weapons (DRY). */
interface GunSpec {
  metal: Rgb // primary body / barrel metal
  glove: Rgb // gripping hand + forearm
  accent: Rgb // wood / secondary mass (shotgun receiver)
  blade?: boolean // fist variant grows a chainsaw blade
  twin?: boolean // shotgun variant widens to super-shotgun twin barrels
}

function makeWeapon(build: WeaponBuilder, spec: GunSpec): WeaponVisual {
  return {
    idle: build(false, 0, spec),
    fire: [build(true, 4, spec), build(true, 8, spec), build(false, 3, spec)],
  }
}

function fistTexture(firing: boolean, recoil: number, spec: GunSpec): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2 + 10 // brawler stance: fist cocked to the right
  const glove = spec.glove
  // Punching thrust drives the whole arm UP-AND-AWAY (toward the far end) on fire.
  const punch = firing ? recoil * 3 : 0
  const wristY = WEAPON_H - 30 - punch
  // Beefy gloved forearm anchored to the bottom edge — the dominant near element.
  forearm(tex, cx - 4, wristY, 44, 30, glove)
  // Clenched fist on top of the wrist, knuckles facing the muzzle direction.
  const fy = wristY - 8
  glovedFist(tex, cx, fy, 22, 18, glove, 1)
  // Studded gauntlet plate across the knuckles for a meaner read.
  rect(tex, cx - 18, fy - 7, 36, 4, shade(glove, 0.5))
  for (let i = 0; i < 4; i++) {
    disc(tex, cx - 14 + i * 9, fy - 13, 2, pal('steel'))
  }
  // Chainsaw variant: a toothed blade rising from the fist toward the muzzle end.
  if (spec.blade === true) {
    const bx = cx - 4
    rect(tex, bx, 6, 9, fy - 12, spec.metal)
    hline(tex, bx, 6, 9, shade(spec.metal, 1.4))
    for (let ty = 8; ty < fy - 12; ty += 4) {
      rect(tex, bx + 9, ty, 3, 2, shade(spec.metal, 1.2)) // saw teeth
    }
    rect(tex, bx + 2, fy - 16, 5, 8, shade(spec.metal, 0.6)) // motor housing
  }
  return tex
}

function pistolTexture(firing: boolean, recoil: number, spec: GunSpec): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const steel = spec.metal
  const glove = spec.glove
  const lift = recoil // whole model kicks down toward the player as one unit
  // Slide + receiver tapering up to a small, high muzzle (foreshortened).
  gunBody(tex, cx - 12, 32 + lift, 26, 18, steel) // wide rear receiver (near-ish)
  const m = taperBarrel(tex, cx, 14 + lift, 34 + lift, 14, 6, shade(steel, 0.85)) // slide → muzzle
  rect(tex, cx + 8, 32 + lift, 5, 7, pal('darkSteel')) // hammer / rear sight nub
  // Tiny muzzle cap at the far end (smallest, highest element).
  disc(tex, m.mx, m.my, 3, pal('darkSteel'))
  disc(tex, m.mx, m.my, 1, pal('black'))
  // Gloved hand wrapping the grip — the NEAREST element, so it is the widest. Forearm
  // and hand both ride `lift` so the grip never shears away from the gun.
  const wristY = WEAPON_H - 24 + lift
  forearm(tex, cx - 2, wristY, 46, 28, glove)
  glovedFist(tex, cx - 1, wristY - 4, 21, 16, glove, -1)
  ellipse(tex, cx - 11, wristY - 11, 4, 7, glove) // trigger finger curling up
  if (firing) muzzleFlash(tex, m.mx, m.my, 9)
  return tex
}

function shotgunTexture(firing: boolean, recoil: number, spec: GunSpec): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const wood = spec.accent
  const steel = spec.metal
  const glove = spec.glove
  const lift = Math.round(recoil * 1.5)
  // Twin barrels: wide+low near pair converging narrower toward the high muzzle.
  // The super-shotgun (twin) splays them wider with fatter bores.
  const sep = spec.twin === true ? 14 : 9
  const bw = spec.twin === true ? 16 : 12
  const mL = taperBarrel(tex, cx - sep, 14 + lift, 42 + lift, bw, 7, steel)
  const mR = taperBarrel(tex, cx + sep, 14 + lift, 42 + lift, bw, 7, steel)
  disc(tex, mL.mx, mL.my, 3, pal('black')) // muzzle bores (small, far)
  disc(tex, mR.mx, mR.my, 3, pal('black'))
  // Wooden receiver bridging the barrels just above the hand.
  gunBody(tex, cx - 20, 40 + lift, 40, 16, wood)
  hline(tex, cx - 20, 46 + lift, 40, shade(wood, 0.6))
  gunBody(tex, cx - 16, 52 + lift, 32, 8, shade(wood, 0.85)) // pump the hand rides on
  // Big gloved fist + forearm gripping the pump — dominates the foreground.
  const wristY = WEAPON_H - 22 + lift
  forearm(tex, cx + 4, wristY, 52, 34, glove)
  glovedFist(tex, cx, wristY - 2, 25, 19, glove, 1)
  if (firing) {
    muzzleFlash(tex, mL.mx, mL.my, 10)
    muzzleFlash(tex, mR.mx, mR.my, 10)
  }
  return tex
}

function chaingunTexture(firing: boolean, recoil: number, spec: GunSpec): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const steel = spec.metal
  const glove = spec.glove
  const lift = recoil // whole model kicks as a unit
  // Rotating barrel cluster: five tightly-packed tubes converging toward a tight high
  // muzzle ring. Central tubes read nearer/longer; outer ones recede (start higher).
  for (let i = -2; i <= 2; i++) {
    const near = 2 - Math.abs(i)
    taperBarrel(
      tex,
      cx + i * 6,
      16 + lift + (2 - near) * 3,
      40 + lift,
      11,
      6,
      shade(steel, i === 0 ? 1.15 : 0.8),
    )
  }
  // Mid-length shroud band ties the tubes into one solid rotary mass (no comb gaps).
  gunBody(tex, cx - 16, 30 + lift, 32, 6, pal('darkSteel'))
  // Front muzzle hub: small + far + high, clearly the smallest element.
  ellipse(tex, cx, 14 + lift, 11, 4, pal('darkSteel'))
  ellipse(tex, cx, 14 + lift, 7, 2, pal('black'))
  // Wide receiver housing just above the hand (near, large).
  gunBody(tex, cx - 24, 40 + lift, 48, 18, pal('darkSteel'))
  // Spin indicator dot rotating with recoil phase so the cluster looks alive on fire.
  const spin = (recoil * 1.4) % 5
  disc(tex, cx - 12 + spin * 6, 48 + lift, 2, pal('yellow'))
  // Gloved fist + forearm on the grip handle, rooted at the bottom edge.
  const wristY = WEAPON_H - 22 + lift
  forearm(tex, cx + 2, wristY, 50, 32, glove)
  glovedFist(tex, cx, wristY - 2, 23, 18, glove, 1)
  if (firing) muzzleFlash(tex, cx, 14 + lift, 10)
  return tex
}

/** Map each weapon to a builder + recolour spec — one table, no copied blocks. The
 *  new arsenal (chainsaw/SSG/rocket/plasma/bfg) reuses the four base builders with
 *  distinct palettes (chainsaw = fist+blade, SSG = wide twin shotgun, rocket/plasma/
 *  bfg = chaingun-ish bodies in their signature colours). */
const WEAPON_SPECS: Readonly<Record<WeaponKind, { build: WeaponBuilder; spec: GunSpec }>> = {
  fist: {
    build: fistTexture,
    spec: { metal: pal('steel'), glove: pal('brown'), accent: pal('darkBrown') },
  },
  chainsaw: {
    build: fistTexture,
    spec: { metal: pal('steel'), glove: pal('darkGray'), accent: pal('yellow'), blade: true },
  },
  pistol: {
    build: pistolTexture,
    spec: { metal: pal('steel'), glove: pal('darkGreen'), accent: pal('darkSteel') },
  },
  shotgun: {
    build: shotgunTexture,
    spec: { metal: pal('darkSteel'), glove: pal('darkBrown'), accent: pal('brown') },
  },
  superShotgun: {
    build: shotgunTexture,
    spec: { metal: pal('steel'), glove: pal('darkBrown'), accent: pal('brown'), twin: true },
  },
  chaingun: {
    build: chaingunTexture,
    spec: { metal: pal('steel'), glove: pal('darkGreen'), accent: pal('darkSteel') },
  },
  rocket: {
    build: chaingunTexture,
    spec: { metal: pal('darkGreen'), glove: pal('darkBrown'), accent: pal('green') },
  },
  plasma: {
    build: chaingunTexture,
    spec: { metal: pal('cyan'), glove: pal('darkSteel'), accent: pal('blue') },
  },
  bfg: {
    build: chaingunTexture,
    spec: { metal: pal('green'), glove: pal('darkSteel'), accent: pal('blue') },
  },
}

function buildWeapons(_rng: Rng): Readonly<Record<WeaponKind, WeaponVisual>> {
  const out = {} as Record<WeaponKind, WeaponVisual>
  for (const kind of Object.keys(WEAPON_SPECS) as WeaponKind[]) {
    const entry = WEAPON_SPECS[kind]
    out[kind] = makeWeapon(entry.build, entry.spec)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Pickup icons — one shared icon canvas + small parametrized shapes
// ─────────────────────────────────────────────────────────────────────────────

const ICON = 24

function newIcon(): Texture {
  return createTexture(ICON, ICON)
}

/** Glossy bottle/potion used by health & armor-style pickups. */
function potionIcon(liquid: Rgb): Texture {
  const tex = newIcon()
  const cx = ICON / 2
  // Glass body.
  rect(tex, cx - 5, 7, 10, 14, mix(liquid, pal('white'), 0.15))
  ellipse(tex, cx, 7, 5, 4, mix(liquid, pal('white'), 0.15))
  // Liquid level + neck + stopper.
  rect(tex, cx - 4, 11, 8, 9, liquid)
  rect(tex, cx - 2, 2, 4, 6, pal('lightGray'))
  rect(tex, cx - 2, 1, 4, 2, pal('white'))
  // Highlight.
  vline(tex, cx - 3, 9, 9, mix(liquid, pal('white'), 0.6))
  return tex
}

function boxIcon(box: Rgb, cross: boolean): Texture {
  const tex = newIcon()
  rect(tex, 3, 6, ICON - 6, ICON - 10, box)
  outline(tex, 3, 6, ICON - 6, ICON - 10, shade(box, 0.6))
  hline(tex, 3, 7, ICON - 6, shade(box, 1.5))
  if (cross) {
    const cx = ICON / 2
    const cy = ICON / 2 + 1
    rect(tex, cx - 4, cy - 1, 8, 3, pal('red'))
    rect(tex, cx - 1, cy - 4, 3, 8, pal('red'))
  }
  return tex
}

function vestIcon(): Texture {
  const tex = newIcon()
  const c = pal('green')
  // Shoulder yoke + body of a vest.
  rect(tex, 5, 4, ICON - 10, 4, shade(c, 1.2))
  rect(tex, 4, 7, 6, ICON - 11, c)
  rect(tex, ICON - 10, 7, 6, ICON - 11, c)
  rect(tex, 9, 9, ICON - 18, ICON - 13, shade(c, 0.85))
  outline(tex, 4, 4, ICON - 8, ICON - 8, pal('darkGreen'))
  return tex
}

function clipIcon(): Texture {
  const tex = newIcon()
  const c = pal('yellow')
  rect(tex, 8, 4, 8, ICON - 8, c)
  outline(tex, 8, 4, 8, ICON - 8, shade(c, 0.6))
  // Stacked rounds peeking out the top.
  for (let i = 0; i < 3; i++) disc(tex, 10 + i * 2, 4, 1.5, pal('orange'))
  return tex
}

function shellsIcon(): Texture {
  const tex = newIcon()
  // Two red shotgun shells with brass bases.
  for (let i = 0; i < 2; i++) {
    const x = 6 + i * 8
    rect(tex, x, 5, 6, ICON - 12, pal('red'))
    rect(tex, x, ICON - 8, 6, 3, pal('yellow'))
    vline(tex, x + 1, 6, ICON - 14, mix(pal('red'), pal('white'), 0.5))
  }
  return tex
}

/** Shared mini weapon icon (top-down gun silhouette) for shotgun/chaingun pickups. */
function gunPickupIcon(body: Rgb, barrels: number): Texture {
  const tex = newIcon()
  rect(tex, 4, 12, ICON - 8, 6, body)
  rect(tex, 5, 16, 5, 5, shade(body, 0.7)) // grip
  for (let i = 0; i < barrels; i++) {
    rect(tex, ICON - 8, 12 + i * 3, 6, 2, shade(body, 1.2))
  }
  outline(tex, 4, 12, ICON - 8, 6, shade(body, 0.5))
  return tex
}

/** Keycard / skull-key icon used by all three coloured keys. `skull` swaps the
 *  card body for a small bony skull so card vs skull keys read apart. */
function keycardIcon(color: Rgb, skull = false): Texture {
  const tex = newIcon()
  if (skull) {
    const cx = ICON / 2
    disc(tex, cx, 10, 6, color) // cranium
    rect(tex, cx - 4, 13, 8, 6, shade(color, 0.9)) // jaw block
    disc(tex, cx - 2.5, 9, 1.4, pal('black')) // eye sockets
    disc(tex, cx + 2.5, 9, 1.4, pal('black'))
    rect(tex, cx - 1, 11, 2, 3, pal('black')) // nasal cavity
    for (let i = 0; i < 3; i++) vline(tex, cx - 3 + i * 3, 16, 3, pal('black')) // teeth gaps
    return tex
  }
  rect(tex, 6, 4, 12, ICON - 8, color)
  outline(tex, 6, 4, 12, ICON - 8, shade(color, 0.6))
  // Notch + magnetic stripe so it reads as a keycard.
  rect(tex, 6, 7, 12, 2, pal('black'))
  rect(tex, 9, ICON - 8, 6, 3, shade(color, 1.4))
  return tex
}

/** Glowing power sphere (soul/mega/invuln/blur/light): radial core→rim with a sheen. */
function sphereIcon(mid: Rgb, rim: Rgb): Texture {
  const tex = newIcon()
  const cx = ICON / 2
  const cy = ICON / 2
  const r = ICON / 2 - 2
  paint(tex, (px, py) => {
    const dx = px + 0.5 - cx
    const dy = py + 0.5 - cy
    const d = Math.sqrt(dx * dx + dy * dy) / r
    if (d > 1) return null
    if (d < 0.32) return pal('white')
    if (d < 0.68) return mix(mid, rim, (d - 0.32) / 0.36)
    return rim
  })
  disc(tex, cx - r * 0.32, cy - r * 0.32, 2, mix(pal('white'), mid, 0.4)) // sheen
  return tex
}

/** A backpack icon: a satchel body with two pouch flaps. */
function backpackIcon(): Texture {
  const tex = newIcon()
  const c = pal('brown')
  rect(tex, 4, 8, ICON - 8, ICON - 11, c)
  outline(tex, 4, 8, ICON - 8, ICON - 11, shade(c, 0.55))
  rect(tex, 7, 4, ICON - 14, 5, shade(c, 1.15)) // top handle block
  rect(tex, 6, 12, 5, 6, shade(c, 0.8)) // left pouch
  rect(tex, ICON - 11, 12, 5, 6, shade(c, 0.8)) // right pouch
  return tex
}

/**
 * One per-kind icon spec: pick a generator. Builders stay DRY — the few icon
 * primitives above are recoloured per kind through this single table.
 */
type IconBuilder = () => Texture

const PICKUP_ICONS: Readonly<Record<PickupKind, IconBuilder>> = {
  // Health (potions / box / spheres).
  health: () => potionIcon(pal('red')),
  medkit: () => boxIcon(pal('white'), true),
  healthBonus: () => potionIcon(pal('blue')),
  soulsphere: () => sphereIcon(pal('blue'), pal('cyan')),
  megasphere: () => sphereIcon(pal('orange'), pal('yellow')),
  // Armor (vests / bonus / set).
  armor: () => vestIcon(),
  greenArmor: () => vestIcon(),
  blueArmor: () => potionIcon(pal('blue')),
  armorBonus: () => potionIcon(pal('green')),
  // Powerups (spheres / recoloured shapes).
  berserk: () => potionIcon(pal('darkRed')),
  invuln: () => sphereIcon(pal('lightGray'), pal('darkGray')),
  radsuit: () => vestIcon(),
  lightAmp: () => sphereIcon(pal('green'), pal('darkGreen')),
  allMap: () => boxIcon(pal('steel'), false),
  blur: () => sphereIcon(pal('darkSteel'), pal('steel')),
  backpack: () => backpackIcon(),
  // Ammo (clips / boxes / shells).
  bullets: () => clipIcon(),
  // Dropped half-clip — same clip icon as a full clip (just grants 5 bullets).
  clipDropped: () => clipIcon(),
  bulletBox: () => boxIcon(pal('yellow'), false),
  shells: () => shellsIcon(),
  shellBox: () => boxIcon(pal('red'), false),
  rockets: () => clipIcon(),
  rocketBox: () => boxIcon(pal('darkGreen'), false),
  cells: () => boxIcon(pal('cyan'), false),
  cellPack: () => boxIcon(pal('blue'), false),
  // Weapons (mini gun silhouettes / saw).
  shotgun: () => gunPickupIcon(pal('brown'), 2),
  chaingun: () => gunPickupIcon(pal('steel'), 3),
  superShotgun: () => gunPickupIcon(pal('darkBrown'), 2),
  rocketLauncher: () => gunPickupIcon(pal('darkGreen'), 1),
  plasmaGun: () => gunPickupIcon(pal('cyan'), 1),
  bfg: () => gunPickupIcon(pal('green'), 2),
  chainsaw: () => gunPickupIcon(pal('darkGray'), 1),
  // Keys (cards + skulls).
  keyRed: () => keycardIcon(pal('red')),
  keyBlue: () => keycardIcon(pal('blue')),
  keyYellow: () => keycardIcon(pal('yellow')),
  keySkullRed: () => keycardIcon(pal('red'), true),
  keySkullBlue: () => keycardIcon(pal('blue'), true),
  keySkullYellow: () => keycardIcon(pal('yellow'), true),
}

function buildPickups(_rng: Rng): Readonly<Record<PickupKind, Texture>> {
  const out = {} as Record<PickupKind, Texture>
  for (const kind of Object.keys(PICKUP_ICONS) as PickupKind[]) {
    out[kind] = PICKUP_ICONS[kind]()
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Projectiles — glowing fireball frames
// ─────────────────────────────────────────────────────────────────────────────

const BALL = 20

/** A glowing radial ball: white core → mid → rim, wobbling by phase. The single
 *  generator behind every projectile, recoloured per kind (mid/rim palette). */
function ballFrame(phase: number, mid: Rgb, rim: Rgb): Texture {
  const tex = createTexture(BALL, BALL)
  const cx = BALL / 2
  const cy = BALL / 2
  const r = BALL / 2 - 1
  paint(tex, (px, py) => {
    const dx = px + 0.5 - cx
    const dy = py + 0.5 - cy
    const wob = 0.85 + 0.15 * Math.sin(phase + Math.atan2(dy, dx) * 3)
    const d = Math.sqrt(dx * dx + dy * dy) / (r * wob)
    if (d > 1) return null
    if (d < 0.35) return pal('white')
    if (d < 0.65) return mix(mid, rim, (d - 0.35) / 0.3)
    return rim
  })
  return tex
}

/** Three spin frames for a projectile of the given mid/rim colours. */
function ballFrames(mid: Rgb, rim: Rgb): readonly Texture[] {
  return [
    ballFrame(0, mid, rim),
    ballFrame(Math.PI * 0.66, mid, rim),
    ballFrame(Math.PI * 1.33, mid, rim),
  ]
}

/** Per-kind glow palette (mid → rim). DRY — drives the total projectile Record. */
const PROJECTILE_COLORS: Readonly<Record<ProjectileKind, readonly [Rgb, Rgb]>> = {
  fireball: [pal('yellow'), pal('orange')],
  cacoball: [pal('orange'), pal('red')],
  baronball: [pal('green'), pal('darkGreen')],
  fatshot: [pal('yellow'), pal('red')],
  tracer: [pal('lightGray'), pal('cyan')],
  aplasma: [pal('cyan'), pal('blue')],
  rocket: [pal('lightGray'), pal('gray')],
  plasma: [pal('cyan'), pal('blue')],
  bfg: [pal('green'), pal('blue')],
}

function buildProjectiles(_rng: Rng): Readonly<Record<ProjectileKind, readonly Texture[]>> {
  const out = {} as Record<ProjectileKind, readonly Texture[]>
  for (const kind of Object.keys(PROJECTILE_COLORS) as ProjectileKind[]) {
    const colors = PROJECTILE_COLORS[kind]
    out[kind] = ballFrames(colors[0], colors[1])
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full deterministic asset set for a seed. Pure: no side effects, no
 * global state, no clock/Math.random — identical seed ⇒ identical bytes.
 */
export function createAssets(seed: number): Assets {
  const rng = mulberry32(seed)
  // Fixed call order keeps the seed stream deterministic across the whole set.
  const wall = buildWalls(rng)
  const flat = buildFlats(rng)
  const enemy = buildEnemies(rng)
  const weapon = buildWeapons(rng)
  const pickup = buildPickups(rng)
  const projectile = buildProjectiles(rng)
  return { wall, flat, enemy, weapon, pickup, projectile }
}
