import { describe, expect, it } from 'vitest'
import { angleDiff, approach, clamp, lerp, normalizeAngle, sign } from '~/doom/core/math'

describe('math', () => {
  it('clamps below, within, and above the range', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(4, 0, 10)).toBe(4)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('lerps between endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.25)).toBe(2.5)
  })

  describe('normalizeAngle', () => {
    it('leaves an in-range angle untouched', () => {
      expect(normalizeAngle(1)).toBeCloseTo(1, 12)
      expect(normalizeAngle(-1)).toBeCloseTo(-1, 12)
    })

    it('wraps into the half-open range (-PI, PI]', () => {
      // +PI is the inclusive boundary and must survive unchanged.
      expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 12)
      // -PI is excluded and must wrap up to +PI.
      expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 12)
    })

    it('wraps angles beyond a full turn back into range', () => {
      const r = normalizeAngle(Math.PI * 3)
      expect(r).toBeGreaterThan(-Math.PI)
      expect(r).toBeLessThanOrEqual(Math.PI)
      expect(r).toBeCloseTo(Math.PI, 12)

      const r2 = normalizeAngle(-Math.PI * 2.5)
      expect(r2).toBeGreaterThan(-Math.PI)
      expect(r2).toBeLessThanOrEqual(Math.PI)
      expect(r2).toBeCloseTo(-Math.PI / 2, 12)
    })
  })

  describe('angleDiff', () => {
    it('returns the shortest signed rotation a -> b', () => {
      // Going from 170deg to -170deg is +20deg the short way, not -340deg.
      const a = (170 * Math.PI) / 180
      const b = (-170 * Math.PI) / 180
      expect(angleDiff(a, b)).toBeCloseTo((20 * Math.PI) / 180, 10)
    })

    it('is zero for equal angles', () => {
      expect(angleDiff(1.5, 1.5)).toBeCloseTo(0, 12)
    })

    it('always lands within (-PI, PI]', () => {
      const d = angleDiff(0, Math.PI * 4 + 0.3)
      expect(d).toBeGreaterThan(-Math.PI)
      expect(d).toBeLessThanOrEqual(Math.PI)
      expect(d).toBeCloseTo(0.3, 10)
    })
  })

  it('reports the sign of a number', () => {
    expect(sign(5)).toBe(1)
    expect(sign(-5)).toBe(-1)
    expect(sign(0)).toBe(0)
  })

  describe('approach', () => {
    it('steps toward the target without overshooting', () => {
      expect(approach(0, 10, 3)).toBe(3)
      expect(approach(0, -10, 3)).toBe(-3)
    })

    it('snaps to the target when within maxDelta', () => {
      expect(approach(8, 10, 5)).toBe(10)
      expect(approach(10, 8, 5)).toBe(8)
    })

    it('does not move past the target on the final step', () => {
      const stepped = approach(9.5, 10, 1)
      expect(stepped).toBe(10)
    })
  })
})
