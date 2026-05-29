// Circle-vs-grid collision. Pure: works against any SceneQuery (incl. test stubs).

import type { SceneQuery, Vec2 } from '~/doom/types'
import { vec } from '~/doom/core/vec'
import { clamp } from '~/doom/core/math'

/** True if the circle at `pos` of `radius` overlaps any solid cell. */
export function isBlocked(scene: SceneQuery, pos: Vec2, radius: number): boolean {
  const minTx = Math.floor(pos.x - radius)
  const maxTx = Math.floor(pos.x + radius)
  const minTy = Math.floor(pos.y - radius)
  const maxTy = Math.floor(pos.y + radius)

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!scene.isSolid(tx, ty)) {
        continue
      }
      // Closest point on the cell's AABB to the circle centre.
      const nearestX = clamp(pos.x, tx, tx + 1)
      const nearestY = clamp(pos.y, ty, ty + 1)
      const dx = pos.x - nearestX
      const dy = pos.y - nearestY
      if (dx * dx + dy * dy < radius * radius) {
        return true
      }
    }
  }
  return false
}

/** Axis-separated slide: attempt x then y independently so motion grazes walls. */
export function moveWithCollision(scene: SceneQuery, pos: Vec2, delta: Vec2, radius: number): Vec2 {
  let nx = pos.x
  let ny = pos.y

  const tryX = vec(nx + delta.x, ny)
  if (!isBlocked(scene, tryX, radius)) {
    nx = tryX.x
  }

  const tryY = vec(nx, ny + delta.y)
  if (!isBlocked(scene, tryY, radius)) {
    ny = tryY.y
  }

  return vec(nx, ny)
}
