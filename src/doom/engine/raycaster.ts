// Pseudo-3D world renderer: floor/ceiling cast first, then DDA-traced textured walls.
// Writes per-column perpendicular wall depth into `depth` for later sprite occlusion.
// Pure typed-array math — safe under jsdom, no WebGL/canvas access.

import type { Assets, Camera, DepthBuffer, Framebuffer, SceneQuery, Texture } from '~/doom/types'
import { CAMERA_PLANE_SCALE, DOOR_PASSABLE_AT, TEXTURE_SIZE, VIEW_H, VIEW_W } from '~/doom/config'
import type { Rgb } from '~/doom/core/color'
import { fromAngle, rotate } from '~/doom/core/vec'
import { fogIntensity, packShade } from '~/doom/core/color'
import { fillRect, paintColumn } from '~/doom/engine/framebuffer'

/** Shade applied to walls whose hit lies on a y-side (north/south face). */
const Y_SIDE_SHADE = 0.7
/** Largest distance we record before treating a column as effectively open sky. */
const MAX_DEPTH = 1e30
/** Neutral backdrop the viewport is cleared to before the flat/wall passes. */
const VIEW_CLEAR: Rgb = [16, 16, 20]

/**
 * Renders floor + ceiling (floorcast) then distance-shaded textured walls into the
 * viewport [0,VIEW_W)×[0,VIEW_H). The status bar below VIEW_H is left untouched.
 * `fullBright` (Light Amplification Visor) forces shading to intensity 1 everywhere.
 */
export function renderWorld(
  fb: Framebuffer,
  scene: SceneQuery,
  camera: Camera,
  assets: Assets,
  depth: DepthBuffer,
  fullBright = false,
): void {
  const dir = fromAngle(camera.angle)
  const plane = rotate(dir, Math.PI / 2)
  const planeX = plane.x * CAMERA_PLANE_SCALE
  const planeY = plane.y * CAMERA_PLANE_SCALE
  const horizon = VIEW_H / 2

  // Clear the whole viewport up front so rows the floor/ceiling cast happens to skip
  // (e.g. the top ceiling row) never leak a stale 1px line from the previous frame.
  fillRect(fb, 0, 0, VIEW_W, VIEW_H, VIEW_CLEAR)

  renderFlats(fb, scene, camera, assets, dir, planeX, planeY, horizon, fullBright)
  renderWalls(fb, scene, camera, assets, depth, dir, planeX, planeY, fullBright)
}

/** Distance shading, short-circuited to 1 (full bright) under the light visor. */
function shadeAt(distance: number, fullBright: boolean): number {
  return fullBright ? 1 : fogIntensity(distance)
}

/**
 * Per-scanline floor + ceiling cast. For each row below the horizon we reconstruct the
 * world position of the floor seen there, then mirror it to the ceiling above the horizon.
 */
function renderFlats(
  fb: Framebuffer,
  scene: SceneQuery,
  camera: Camera,
  assets: Assets,
  dir: { x: number; y: number },
  planeX: number,
  planeY: number,
  horizon: number,
  fullBright: boolean,
): void {
  const floorTex = pickFlat(assets, scene.floorFlat)
  const ceilTex = pickFlat(assets, scene.ceilingFlat)
  const posX = camera.pos.x
  const posY = camera.pos.y
  const data = fb.data
  const fbW = fb.width

  // Ray directions at the screen edges (cameraX -1 and +1) — interpolate across the row.
  const rayDirX0 = dir.x - planeX
  const rayDirY0 = dir.y - planeY
  const rayDirX1 = dir.x + planeX
  const rayDirY1 = dir.y + planeY

  for (let y = Math.ceil(horizon); y < VIEW_H; y++) {
    // Distance from the camera to the floor row currently scanned.
    const p = y - horizon
    if (p <= 0) {
      continue
    }
    const rowDistance = horizon / p
    const intensity = shadeAt(rowDistance, fullBright)

    // World step per screen column at this row, plus the leftmost world position.
    const stepX = (rowDistance * (rayDirX1 - rayDirX0)) / VIEW_W
    const stepY = (rowDistance * (rayDirY1 - rayDirY0)) / VIEW_W
    let worldX = posX + rowDistance * rayDirX0
    let worldY = posY + rowDistance * rayDirY0

    const ceilY = Math.floor(2 * horizon - y)
    const floorRow = y * fbW
    const ceilRow = ceilY * fbW

    const ceilInView = ceilY >= 0 && ceilY < VIEW_H

    for (let x = 0; x < VIEW_W; x++) {
      const tx = ((worldX - Math.floor(worldX)) * TEXTURE_SIZE) | 0
      const ty = ((worldY - Math.floor(worldY)) * TEXTURE_SIZE) | 0
      const texX = clampTexel(tx)
      const texY = clampTexel(ty)

      writeFlatTexel(data, (floorRow + x) * 4, floorTex, texX, texY, intensity)
      if (ceilInView) {
        writeFlatTexel(data, (ceilRow + x) * 4, ceilTex, texX, texY, intensity)
      }

      worldX += stepX
      worldY += stepY
    }
  }
}

/** DDA-traced textured walls; one vertical strip per screen column. */
function renderWalls(
  fb: Framebuffer,
  scene: SceneQuery,
  camera: Camera,
  assets: Assets,
  depth: DepthBuffer,
  dir: { x: number; y: number },
  planeX: number,
  planeY: number,
  fullBright: boolean,
): void {
  const posX = camera.pos.x
  const posY = camera.pos.y

  for (let x = 0; x < VIEW_W; x++) {
    const cameraX = (2 * x) / VIEW_W - 1
    const rayDirX = dir.x + planeX * cameraX
    const rayDirY = dir.y + planeY * cameraX

    let mapX = Math.floor(posX)
    let mapY = Math.floor(posY)

    const deltaDistX = rayDirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirX)
    const deltaDistY = rayDirY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirY)

    let stepX: number
    let sideDistX: number
    if (rayDirX < 0) {
      stepX = -1
      sideDistX = (posX - mapX) * deltaDistX
    } else {
      stepX = 1
      sideDistX = (mapX + 1 - posX) * deltaDistX
    }

    let stepY: number
    let sideDistY: number
    if (rayDirY < 0) {
      stepY = -1
      sideDistY = (posY - mapY) * deltaDistY
    } else {
      stepY = 1
      sideDistY = (mapY + 1 - posY) * deltaDistY
    }

    // Walk the grid until a solid (or closed-enough door) cell is struck.
    let side = 0
    let hit = false
    let wallTex = -1
    let openness = 0
    for (let guard = 0; guard < VIEW_W * 4 && !hit; guard++) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX
        mapX += stepX
        side = 0
      } else {
        sideDistY += deltaDistY
        mapY += stepY
        side = 1
      }

      if (!scene.isSolid(mapX, mapY)) {
        continue
      }
      const cellOpenness = scene.doorOpennessAt(mapX, mapY)
      if (cellOpenness >= DOOR_PASSABLE_AT) {
        // A fully-open door is non-solid: keep walking through the gap.
        continue
      }
      wallTex = scene.wallTextureAt(mapX, mapY)
      openness = cellOpenness
      hit = true
    }

    if (!hit) {
      depth[x] = MAX_DEPTH
      continue
    }

    // Perpendicular distance avoids the fisheye of euclidean distance.
    const perpDist = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY
    const safeDist = perpDist <= 0 ? 1e-4 : perpDist
    depth[x] = safeDist

    const sliceHeight = VIEW_H / safeDist

    // Where the ray crossed the wall, in [0,1) along the struck face → texture column.
    let wallHit = side === 0 ? posY + perpDist * rayDirY : posX + perpDist * rayDirX
    wallHit -= Math.floor(wallHit)
    let texX = (wallHit * TEXTURE_SIZE) | 0
    // Mirror so textures don't appear reversed on the back faces.
    if (side === 0 && rayDirX > 0) {
      texX = TEXTURE_SIZE - 1 - texX
    }
    if (side === 1 && rayDirY < 0) {
      texX = TEXTURE_SIZE - 1 - texX
    }
    texX = clampTexel(texX)

    const intensity = shadeAt(safeDist, fullBright) * (side === 1 ? Y_SIDE_SHADE : 1)
    const tex = pickWall(assets, wallTex)

    // Door slides UP into the ceiling: as openness grows the visible slice retracts
    // from the bottom toward the top (its lower edge rises). Texture mapping still uses
    // the full (unclipped) span so the retracted portion is simply clipped away, and at
    // openness 1 the whole slice is gone. (A fully-open door is non-solid and never hit.)
    const slideOffset = openness * sliceHeight
    const spanTop = -sliceHeight / 2 + VIEW_H / 2
    const spanHeight = sliceHeight
    const drawStart = Math.max(0, Math.ceil(spanTop))
    const drawEnd = Math.min(VIEW_H - 1, Math.floor(spanTop + sliceHeight - slideOffset))

    if (drawEnd >= drawStart) {
      paintColumn(fb, x, drawStart, drawEnd, spanTop, spanHeight, tex, texX, intensity, false)
    }
  }
}

/** Writes a shaded floor/ceiling texel straight into the RGBA framebuffer bytes. */
function writeFlatTexel(
  data: Uint8ClampedArray,
  offset: number,
  tex: Texture,
  texX: number,
  texY: number,
  intensity: number,
): void {
  const src = (texY * tex.width + texX) * 4
  const r = tex.data[src] ?? 0
  const g = tex.data[src + 1] ?? 0
  const b = tex.data[src + 2] ?? 0
  const [sr, sg, sb] = packShade([r, g, b], intensity)
  data[offset] = sr
  data[offset + 1] = sg
  data[offset + 2] = sb
  data[offset + 3] = 255
}

/** Bounds a raw texel coordinate into [0, TEXTURE_SIZE). */
function clampTexel(v: number): number {
  if (v < 0) {
    return 0
  }
  if (v >= TEXTURE_SIZE) {
    return TEXTURE_SIZE - 1
  }
  return v
}

/** Returns the wall texture for an index, falling back to the placeholder at 0. */
function pickWall(assets: Assets, index: number): Texture {
  const tex = index >= 0 ? assets.wall[index] : undefined
  return tex ?? fallbackWall(assets)
}

function fallbackWall(assets: Assets): Texture {
  const first = assets.wall[0]
  return first ?? EMPTY_TEXTURE
}

/** Returns the flat (floor/ceiling) texture for an index with a safe fallback. */
function pickFlat(assets: Assets, index: number): Texture {
  const tex = assets.flat[index]
  if (tex !== undefined) {
    return tex
  }
  const first = assets.flat[0]
  return first ?? EMPTY_TEXTURE
}

/** A 1×1 opaque-black texture so sampling never indexes undefined under degenerate assets. */
const EMPTY_TEXTURE: Texture = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([0, 0, 0, 255]),
}
