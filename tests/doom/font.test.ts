import { describe, expect, it } from 'vitest'
import { GLYPH_H, GLYPH_SPACING, GLYPH_W, glyphRows, textWidth } from '~/doom/engine/font'

describe('font', () => {
  it('exposes the documented glyph metrics', () => {
    expect(GLYPH_W).toBe(5)
    expect(GLYPH_H).toBe(7)
    expect(GLYPH_SPACING).toBe(1)
  })

  describe('glyphRows', () => {
    it('returns GLYPH_H rows for a known glyph', () => {
      expect(glyphRows('A')).toHaveLength(GLYPH_H)
    })

    it('renders the expected non-empty bitmap for A', () => {
      // Patterns from font.ts: top is a peaked cap, with the cross-bar fully lit.
      expect(glyphRows('A')).toEqual([
        0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
      ])
    })

    it('uppercases its input', () => {
      expect(glyphRows('a')).toEqual(glyphRows('A'))
    })

    it('treats space as a fully blank glyph', () => {
      const space = glyphRows(' ')
      expect(space).toHaveLength(GLYPH_H)
      expect(space.every(row => row === 0)).toBe(true)
    })

    it('falls back to a blank glyph for unknown characters', () => {
      const unknown = glyphRows('☃') // snowman, outside the supported set
      expect(unknown.every(row => row === 0)).toBe(true)
    })

    it('keeps every row mask within GLYPH_W bits', () => {
      const max = (1 << GLYPH_W) - 1
      for (const row of glyphRows('R')) {
        expect(row).toBeGreaterThanOrEqual(0)
        expect(row).toBeLessThanOrEqual(max)
      }
    })
  })

  describe('textWidth', () => {
    it('is zero for empty text', () => {
      expect(textWidth('', 1)).toBe(0)
    })

    it('grows with text length', () => {
      const one = textWidth('A', 1)
      const two = textWidth('AB', 1)
      const three = textWidth('ABC', 1)
      expect(two).toBeGreaterThan(one)
      expect(three).toBeGreaterThan(two)
    })

    it('matches the advance formula including inter-glyph spacing', () => {
      // Last glyph carries no trailing spacing.
      const advance = (GLYPH_W + GLYPH_SPACING) * 1
      expect(textWidth('ABC', 1)).toBe(3 * advance - GLYPH_SPACING)
    })

    it('scales linearly with the block scale', () => {
      expect(textWidth('HELLO', 2)).toBe(textWidth('HELLO', 1) * 2)
    })
  })
})
