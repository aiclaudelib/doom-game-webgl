// Billboarded world sprites (enemies, pickups, projectiles) drawn after the walls.
// Each is transformed into camera space, depth-tested per column against the wall
// buffer, and painted far-to-near with alpha testing. Floor-anchored by default;
// a sprite's optional zOffset lifts it off the floor (e.g. fireballs).

import type { Camera, DepthBuffer, Framebuffer, SpriteInstance } from '~/doom/types'
import { CAMERA_PLANE_SCALE, SPRITE_PX_PER_TILE, VIEW_H, VIEW_W } from '~/doom/config'
import { fromAngle, rotate } from '~/doom/core/vec'
import { paintColumn } from '~/doom/engine/framebuffer'

/** Sprites nearer than this (camera-space depth) are culled to avoid divide blowups. */
const MIN_DEPTH = 0.05

interface ProjectedSprite {
  readonly sprite: SpriteInstance
  readonly distance: number
}

/**
 * Draws billboards back-to-front, occluded by walls via the per-column depth buffer.
 * Anchors each sprite to the floor unless it carries a zOffset, which lifts it upward.
 */
export function renderSprites(
  fb: Framebuffer,
  sprites: readonly SpriteInstance[],
  camera: Camera,
  depth: DepthBuffer,
): void {
  if (sprites.length === 0) {
    return
  }

  const dir = fromAngle(camera.angle)
  const plane = rotate(dir, Math.PI / 2)
  const planeX = plane.x * CAMERA_PLANE_SCALE
  const planeY = plane.y * CAMERA_PLANE_SCALE

  // Inverse of the camera matrix [planeX dirX; planeY dirY] for camera-space transform.
  const invDet = 1 / (planeX * dir.y - dir.x * planeY)

  // Sort far-to-near so nearer billboards paint over distant ones.
  const ordered = sortByDistanceDesc(sprites, camera)
  const horizon = VIEW_H / 2

  for (const { sprite } of ordered) {
    const relX = sprite.pos.x - camera.pos.x
    const relY = sprite.pos.y - camera.pos.y

    // transformY = depth along the view direction; transformX = lateral offset.
    const transformX = invDet * (dir.y * relX - dir.x * relY)
    const transformY = invDet * (-planeY * relX + planeX * relY)

    // Cull anything at or behind the camera plane.
    if (transformY < MIN_DEPTH) {
      continue
    }

    const screenCenterX = Math.floor((VIEW_W / 2) * (1 + transformX / transformY))

    const tex = sprite.texture

    // Pixels per world tile at this depth — the shared projection scale.
    const projScale = VIEW_H / transformY

    // Doom-offset path: authentic sprites carry pixel dimensions + leftoffset/topoffset,
    // so we anchor by those offsets and scale in atlas pixels (with optional mirror)
    // instead of the legacy bottom-centre aspect-fit below.
    if (sprite.pxH !== undefined && sprite.pxH > 0) {
      const pixelScale = projScale / SPRITE_PX_PER_TILE
      const pxW = sprite.pxW ?? tex.width
      const pxH = sprite.pxH
      const ox = sprite.ox ?? pxW / 2
      const oy = sprite.oy ?? pxH
      const spriteHeight = Math.max(1, Math.round(pxH * pixelScale))
      const spriteWidth = Math.max(1, Math.round(pxW * pixelScale))
      const zo = sprite.zOffset ?? 0
      const groundY = horizon + projScale / 2 - zo * projScale
      const left = Math.round(screenCenterX - ox * pixelScale)
      const spanTop = groundY - oy * pixelScale
      const drawStartY = Math.max(0, Math.ceil(spanTop))
      const drawEndY = Math.min(VIEW_H - 1, Math.floor(spanTop + spriteHeight))
      if (drawEndY < drawStartY) {
        continue
      }
      const startX = Math.max(0, left)
      const endX = Math.min(VIEW_W - 1, left + spriteWidth - 1)
      if (endX < startX) {
        continue
      }
      for (let sx = startX; sx <= endX; sx++) {
        const wallDepth = depth[sx] ?? Number.POSITIVE_INFINITY
        if (transformY >= wallDepth) {
          continue
        }
        const localX = sx - left
        let texX = Math.floor((localX / spriteWidth) * tex.width)
        if (texX < 0) {
          texX = 0
        } else if (texX >= tex.width) {
          texX = tex.width - 1
        }
        if (sprite.flip === true) {
          texX = tex.width - 1 - texX
        }
        paintColumn(fb, sx, drawStartY, drawEndY, spanTop, spriteHeight, tex, texX, 1, true)
      }
      continue
    }

    // Height comes from the projection/scale; width is derived from the texture aspect
    // ratio so non-square sprites (e.g. 48×56) are not horizontally stretched.
    const spriteHeight = Math.abs(Math.floor(projScale * sprite.scale))
    if (spriteHeight <= 0) {
      continue
    }
    const texH = tex.height > 0 ? tex.height : 1
    const spriteWidth = Math.abs(Math.floor((spriteHeight * tex.width) / texH))
    if (spriteWidth <= 0) {
      continue
    }

    // Anchor to the floor: the ground line at this depth is below the horizon by half a
    // full-height slice; the sprite hangs upward from there. A positive zOffset lifts the
    // sprite off the floor by that many tiles (fireballs etc.); pickups/enemies use 0.
    const zo = sprite.zOffset ?? 0
    const groundY = horizon + projScale / 2 - zo * projScale
    const spanTop = groundY - spriteHeight
    const spanHeight = spriteHeight

    const drawStartY = Math.max(0, Math.ceil(spanTop))
    const drawEndY = Math.min(VIEW_H - 1, Math.floor(spanTop + spriteHeight))
    if (drawEndY < drawStartY) {
      continue
    }

    const halfWidth = spriteWidth / 2
    const startX = Math.max(0, Math.ceil(screenCenterX - halfWidth))
    const endX = Math.min(VIEW_W - 1, Math.floor(screenCenterX + halfWidth))
    if (endX < startX) {
      continue
    }

    for (let sx = startX; sx <= endX; sx++) {
      // Depth-test against the wall buffer: skip columns the wall hides.
      const wallDepth = depth[sx] ?? Number.POSITIVE_INFINITY
      if (transformY >= wallDepth) {
        continue
      }

      // Map screen column → sprite texture column across the projected width.
      const localX = sx - (screenCenterX - halfWidth)
      let texX = Math.floor((localX / spriteWidth) * tex.width)
      if (texX < 0) {
        texX = 0
      } else if (texX >= tex.width) {
        texX = tex.width - 1
      }

      paintColumn(fb, sx, drawStartY, drawEndY, spanTop, spanHeight, tex, texX, 1, true)
    }
  }
}

/** Returns the sprites sorted by squared distance from the camera, farthest first. */
function sortByDistanceDesc(
  sprites: readonly SpriteInstance[],
  camera: Camera,
): readonly ProjectedSprite[] {
  const projected: ProjectedSprite[] = sprites.map(sprite => {
    const dx = sprite.pos.x - camera.pos.x
    const dy = sprite.pos.y - camera.pos.y
    return { sprite, distance: dx * dx + dy * dy }
  })
  projected.sort((a, b) => b.distance - a.distance)
  return projected
}
