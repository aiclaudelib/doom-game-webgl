import { describe, expect, it } from 'vitest'
import { chance, mulberry32, pick, randInt, randRange } from '~/doom/core/rng'

describe('rng', () => {
  describe('mulberry32', () => {
    it('produces the same sequence for the same seed', () => {
      const a = mulberry32(12345)
      const b = mulberry32(12345)
      const seqA = Array.from({ length: 16 }, () => a())
      const seqB = Array.from({ length: 16 }, () => b())
      expect(seqA).toEqual(seqB)
    })

    it('produces different sequences for different seeds', () => {
      const a = mulberry32(1)
      const b = mulberry32(2)
      const seqA = Array.from({ length: 16 }, () => a())
      const seqB = Array.from({ length: 16 }, () => b())
      expect(seqA).not.toEqual(seqB)
    })

    it('emits floats in [0, 1)', () => {
      const r = mulberry32(99)
      for (let i = 0; i < 1000; i++) {
        const v = r()
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
      }
    })
  })

  it('randRange stays within [min, max)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = randRange(r, -3, 9)
      expect(v).toBeGreaterThanOrEqual(-3)
      expect(v).toBeLessThan(9)
    }
  })

  describe('randInt', () => {
    it('returns integers within the inclusive bounds', () => {
      const r = mulberry32(42)
      for (let i = 0; i < 2000; i++) {
        const v = randInt(r, 2, 6)
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(2)
        expect(v).toBeLessThanOrEqual(6)
      }
    })

    it('can reach both endpoints of the range', () => {
      const r = mulberry32(123)
      const seen = new Set<number>()
      for (let i = 0; i < 5000; i++) seen.add(randInt(r, 0, 3))
      expect(seen.has(0)).toBe(true)
      expect(seen.has(3)).toBe(true)
      expect([...seen].every(v => v >= 0 && v <= 3)).toBe(true)
    })
  })

  describe('chance', () => {
    it('is always false at p=0 and always true at p=1', () => {
      const r = mulberry32(5)
      for (let i = 0; i < 100; i++) {
        expect(chance(r, 0)).toBe(false)
        expect(chance(r, 1)).toBe(true)
      }
    })
  })

  describe('pick', () => {
    it('returns a member of the tuple', () => {
      const r = mulberry32(31)
      const items: readonly ['a', 'b', 'c'] = ['a', 'b', 'c']
      for (let i = 0; i < 200; i++) {
        expect(items).toContain(pick(r, items))
      }
    })

    it('always returns the sole element of a one-item tuple', () => {
      const r = mulberry32(8)
      const items: readonly ['only'] = ['only']
      expect(pick(r, items)).toBe('only')
    })
  })
})
