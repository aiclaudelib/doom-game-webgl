import { describe, expect, it } from 'vitest'
import { fbm, hash2, valueNoise } from '~/doom/engine/noise'

const inUnitRange = (v: number): boolean => v >= 0 && v < 1

describe('noise', () => {
  describe('hash2', () => {
    it('is deterministic for identical arguments', () => {
      expect(hash2(3, 7, 99)).toBe(hash2(3, 7, 99))
    })

    it('varies with coordinates and seed', () => {
      expect(hash2(3, 7, 99)).not.toBe(hash2(4, 7, 99))
      expect(hash2(3, 7, 99)).not.toBe(hash2(3, 7, 100))
    })

    it('stays within [0, 1)', () => {
      for (let x = 0; x < 20; x++) {
        for (let y = 0; y < 20; y++) {
          expect(inUnitRange(hash2(x, y, 1234))).toBe(true)
        }
      }
    })
  })

  describe('valueNoise', () => {
    it('is deterministic for identical arguments', () => {
      expect(valueNoise(2.5, 4.25, 7)).toBe(valueNoise(2.5, 4.25, 7))
    })

    it('stays within [0, 1) across a sampled grid', () => {
      for (let i = 0; i < 200; i++) {
        const v = valueNoise(i * 0.37, i * 0.91, 55)
        expect(inUnitRange(v)).toBe(true)
      }
    })

    it('reproduces lattice corner hashes at integer coordinates', () => {
      // At an integer position the bilinear blend collapses to the corner hash.
      expect(valueNoise(5, 9, 3)).toBeCloseTo(hash2(5, 9, 3), 12)
    })
  })

  describe('fbm', () => {
    it('is deterministic for identical arguments', () => {
      expect(fbm(1.5, 2.5, 8, 4)).toBe(fbm(1.5, 2.5, 8, 4))
    })

    it('stays within [0, 1) for varied octave counts', () => {
      for (let oct = 1; oct <= 6; oct++) {
        for (let i = 0; i < 50; i++) {
          const v = fbm(i * 0.23, i * 0.61, 17, oct)
          expect(inUnitRange(v)).toBe(true)
        }
      }
    })

    it('treats a sub-one octave count as a single octave', () => {
      expect(fbm(3.3, 1.1, 4, 0)).toBeCloseTo(fbm(3.3, 1.1, 4, 1), 12)
    })
  })
})
