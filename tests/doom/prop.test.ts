import { describe, expect, it } from 'vitest'
import { PROP_DEFS, propFrameLetter, spawnProp, updateProp } from '~/doom/game/prop'

describe('PROP_DEFS', () => {
  it('maps every prop kind to a 4-letter sprite prefix', () => {
    for (const def of Object.values(PROP_DEFS)) {
      expect(def.sprite.length).toBe(4)
    }
  })

  it('flags lamps/torches fullbright and hanging victims ceiling-anchored', () => {
    expect(PROP_DEFS.techLamp.fullbright).toBe(true)
    expect(PROP_DEFS.redTorch.fullbright).toBe(true)
    expect(PROP_DEFS.candle.fullbright).toBe(true)
    expect(PROP_DEFS.hangingVictim.ceiling).toBe(true)
    expect(PROP_DEFS.hangingTorso.ceiling).toBe(true)
    // Sector-lit pillars are neither fullbright nor ceiling-anchored.
    expect(PROP_DEFS.greenPillar.fullbright).toBeUndefined()
    expect(PROP_DEFS.greenPillar.ceiling).toBeUndefined()
  })
})

describe('spawnProp / updateProp', () => {
  it('creates a prop at the position with a zeroed clock and advances it', () => {
    const prop = spawnProp('techLamp', 3.5, 4.5)
    expect(prop.kind).toBe('techLamp')
    expect(prop.pos).toEqual({ x: 3.5, y: 4.5 })
    expect(prop.animTimer).toBe(0)

    updateProp(prop, 0.5)
    expect(prop.animTimer).toBeCloseTo(0.5)
  })
})

describe('propFrameLetter', () => {
  it('holds the single static frame for non-animated props', () => {
    const pillar = spawnProp('greenPillar', 1.5, 1.5)
    expect(propFrameLetter(pillar)).toBe('A')
    updateProp(pillar, 5)
    // Still 'A' — no animLetters means the frame never changes.
    expect(propFrameLetter(pillar)).toBe('A')
  })

  it('uses the per-kind static frame letter where one is set (corpses)', () => {
    const deadImp = spawnProp('deadImp', 2.5, 2.5)
    expect(propFrameLetter(deadImp)).toBe('M')
  })

  it('cycles an animated prop through its letters on the 35Hz clock', () => {
    const lamp = spawnProp('techLamp', 1.5, 1.5) // ABCD @4t
    expect(propFrameLetter(lamp)).toBe('A')
    // 4 tics @35Hz ≈ 0.1143 s advances to the next letter 'B'.
    updateProp(lamp, 4 / 35 + 1e-3)
    expect(propFrameLetter(lamp)).toBe('B')
    updateProp(lamp, 4 / 35)
    expect(propFrameLetter(lamp)).toBe('C')
  })
})
