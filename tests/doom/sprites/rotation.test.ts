import { describe, expect, it } from 'vitest'
import { spriteRotation } from '~/doom/engine/sprites/spriteAtlas'

/** Mirror of the production formula, used to derive expected values independently. */
function expectedRotation(thingAngle: number, vx: number, vy: number, tx: number, ty: number) {
  const ang = Math.atan2(ty - vy, tx - vx)
  const delta = thingAngle - ang
  const idx = ((Math.floor(delta / (Math.PI / 4) + 4.5) % 8) + 8) % 8
  return idx + 1
}

describe('spriteRotation', () => {
  it('returns 1 (front) when the thing faces toward the viewer', () => {
    // Viewer at origin, thing at (1,0) facing -x (toward the viewer).
    expect(spriteRotation(Math.PI, 0, 0, 1, 0)).toBe(1)
  })

  it('returns 5 (back) when the thing faces away from the viewer', () => {
    // Thing at (1,0) facing +x (away from the viewer).
    expect(spriteRotation(0, 0, 0, 1, 0)).toBe(5)
  })

  it('keeps every result within 1..8 across a full facing sweep', () => {
    const results: number[] = []
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4
      const rot = spriteRotation(angle, 0, 0, 1, 0)
      expect(rot).toBe(expectedRotation(angle, 0, 0, 1, 0))
      expect(rot).toBeGreaterThanOrEqual(1)
      expect(rot).toBeLessThanOrEqual(8)
      results.push(rot)
    }
    // Eight distinct facings spread across multiple rotation views (not all the same).
    expect(new Set(results).size).toBeGreaterThan(1)
  })

  it('changes the chosen view as the facing rotates', () => {
    const a = spriteRotation(0, 0, 0, 1, 0)
    const b = spriteRotation(Math.PI / 2, 0, 0, 1, 0)
    expect(a).not.toBe(b)
  })
})
