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

function buildEnemies(rng: Rng): Readonly<Record<EnemyKind, EnemyVisual>> {
  return {
    grunt: buildEnemy(ENEMY_PALETTES.grunt, rng),
    imp: buildEnemy(ENEMY_PALETTES.imp, rng),
    demon: buildEnemy(ENEMY_PALETTES.demon, rng),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// First-person weapons — bottom-centre anchored, transparent background
// ─────────────────────────────────────────────────────────────────────────────

const WEAPON_W = 96
const WEAPON_H = 72

/** Shared metallic body builder: a rounded box with a top highlight + bottom shade. */
function gunBody(tex: Texture, x: number, y: number, w: number, h: number, base: Rgb): void {
  rect(tex, x, y, w, h, base)
  hline(tex, x, y, w, shade(base, 1.5))
  hline(tex, x, y + h - 1, w, shade(base, 0.5))
  vline(tex, x, y, h, shade(base, 1.2))
  vline(tex, x + w - 1, y, h, shade(base, 0.6))
}

/** Muzzle flash blob, drawn only on fire frames. */
function muzzleFlash(tex: Texture, cx: number, cy: number, r: number): void {
  disc(tex, cx, cy, r, pal('yellow'))
  disc(tex, cx, cy, r * 0.6, pal('white'))
  disc(tex, cx, cy, r * 1.3, pal('orange'), 120)
}

type WeaponBuilder = (firing: boolean, recoil: number) => Texture

function makeWeapon(build: WeaponBuilder): WeaponVisual {
  return {
    idle: build(false, 0),
    fire: [build(true, 4), build(true, 8), build(false, 3)],
  }
}

function fistTexture(firing: boolean, recoil: number): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const y = WEAPON_H - 26 + (firing ? -recoil * 2 : recoil)
  // A clenched fist + forearm rising from the bottom-right.
  const skin = pal('lightGray')
  const punch = firing ? 14 : 0
  disc(tex, cx + 8, y - punch, 13, skin)
  rect(tex, cx + 2, y - punch + 6, 28, 24, skin)
  // Knuckle dimples.
  for (let i = 0; i < 4; i++) {
    disc(tex, cx + 1 + i * 6, y - punch - 6, 2, shade(skin, 0.75))
  }
  outline(tex, cx + 2, y - punch + 6, 28, 24, shade(skin, 0.6))
  return tex
}

function pistolTexture(firing: boolean, recoil: number): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const baseY = WEAPON_H - 4 + recoil
  const steel = pal('steel')
  // Grip.
  gunBody(tex, cx - 7, baseY - 30, 14, 30, pal('darkSteel'))
  // Slide / body.
  gunBody(tex, cx - 9, baseY - 40, 30, 12, steel)
  // Barrel pointing up-away.
  gunBody(tex, cx + 4, baseY - 44, 6, 8, shade(steel, 0.8))
  if (firing) muzzleFlash(tex, cx + 7, baseY - 46, 8)
  return tex
}

function shotgunTexture(firing: boolean, recoil: number): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const baseY = WEAPON_H - 2 + recoil * 1.5
  const wood = pal('brown')
  const steel = pal('darkSteel')
  // Wooden stock/forend at bottom.
  gunBody(tex, cx - 16, baseY - 22, 40, 20, wood)
  // Twin barrels rising.
  gunBody(tex, cx - 12, baseY - 48, 10, 28, steel)
  gunBody(tex, cx + 2, baseY - 48, 10, 28, steel)
  // Pump.
  gunBody(tex, cx - 14, baseY - 30, 36, 8, shade(wood, 0.8))
  if (firing) {
    muzzleFlash(tex, cx - 7, baseY - 50, 11)
    muzzleFlash(tex, cx + 7, baseY - 50, 11)
  }
  return tex
}

function chaingunTexture(firing: boolean, recoil: number): Texture {
  const tex = createTexture(WEAPON_W, WEAPON_H)
  const cx = WEAPON_W / 2
  const baseY = WEAPON_H - 2 + recoil
  const steel = pal('steel')
  // Receiver block.
  gunBody(tex, cx - 18, baseY - 30, 40, 28, pal('darkSteel'))
  // Rotating barrel cluster.
  for (let i = -2; i <= 2; i++) {
    gunBody(tex, cx + i * 6 - 2, baseY - 52, 5, 24, shade(steel, i === 0 ? 1.2 : 0.85))
  }
  // Spin indicator dot (rotates with recoil phase so it looks alive when firing).
  const spin = (recoil * 1.4) % 5
  disc(tex, cx - 9 + spin * 6, baseY - 40, 2, pal('yellow'))
  if (firing) muzzleFlash(tex, cx, baseY - 54, 10)
  return tex
}

function buildWeapons(_rng: Rng): Readonly<Record<WeaponKind, WeaponVisual>> {
  return {
    fist: makeWeapon(fistTexture),
    pistol: makeWeapon(pistolTexture),
    shotgun: makeWeapon(shotgunTexture),
    chaingun: makeWeapon(chaingunTexture),
  }
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

/** Keycard icon used by all three coloured keys. */
function keycardIcon(color: Rgb): Texture {
  const tex = newIcon()
  rect(tex, 6, 4, 12, ICON - 8, color)
  outline(tex, 6, 4, 12, ICON - 8, shade(color, 0.6))
  // Notch + magnetic stripe so it reads as a keycard.
  rect(tex, 6, 7, 12, 2, pal('black'))
  rect(tex, 9, ICON - 8, 6, 3, shade(color, 1.4))
  return tex
}

function buildPickups(_rng: Rng): Readonly<Record<PickupKind, Texture>> {
  return {
    health: potionIcon(pal('red')),
    medkit: boxIcon(pal('white'), true),
    armor: vestIcon(),
    bullets: clipIcon(),
    shells: shellsIcon(),
    shotgun: gunPickupIcon(pal('brown'), 2),
    chaingun: gunPickupIcon(pal('steel'), 3),
    keyRed: keycardIcon(pal('red')),
    keyBlue: keycardIcon(pal('blue')),
    keyYellow: keycardIcon(pal('yellow')),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Projectiles — glowing fireball frames
// ─────────────────────────────────────────────────────────────────────────────

const BALL = 20

function fireballFrame(phase: number): Texture {
  const tex = createTexture(BALL, BALL)
  const cx = BALL / 2
  const cy = BALL / 2
  const r = BALL / 2 - 1
  // Radial glow: white core → yellow → orange → transparent, wobbling by phase.
  paint(tex, (px, py) => {
    const dx = px + 0.5 - cx
    const dy = py + 0.5 - cy
    const wob = 0.85 + 0.15 * Math.sin(phase + Math.atan2(dy, dx) * 3)
    const d = Math.sqrt(dx * dx + dy * dy) / (r * wob)
    if (d > 1) return null
    if (d < 0.35) return pal('white')
    if (d < 0.65) return mix(pal('yellow'), pal('orange'), (d - 0.35) / 0.3)
    return pal('orange')
  })
  return tex
}

function buildProjectiles(_rng: Rng): Readonly<Record<ProjectileKind, readonly Texture[]>> {
  return {
    fireball: [fireballFrame(0), fireballFrame(Math.PI * 0.66), fireballFrame(Math.PI * 1.33)],
  }
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
