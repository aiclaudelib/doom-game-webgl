import { describe, expect, it } from 'vitest'
import type { Lump } from '../../../scripts/wad/types'
import { buildSpriteIndex } from '../../../scripts/wad/spriteIndex'

const lump = (name: string): Lump => ({ name, data: new Uint8Array(0) })

describe('buildSpriteIndex', () => {
  it('groups lumps by actor, expands mirror pairs, and tracks rotation', () => {
    const lumps: readonly Lump[] = [
      lump('TROOA1'),
      lump('TROOA2A8'),
      lump('TROOB1'),
      lump('PISGA0'),
    ]

    const result = buildSpriteIndex(lumps)

    const troo = result.TROO
    expect(troo).toBeDefined()
    expect(troo?.rotated).toBe(true)

    const trooA = troo?.frames.A
    expect(trooA).toHaveLength(8)
    expect(trooA?.[0]).toEqual({ lump: 'TROOA1', flip: false })
    expect(trooA?.[1]).toEqual({ lump: 'TROOA2A8', flip: false })
    expect(trooA?.[7]).toEqual({ lump: 'TROOA2A8', flip: true })
    expect(trooA?.[2]).toBeNull()

    const trooB = troo?.frames.B
    expect(trooB).toHaveLength(8)
    expect(trooB?.[0]).toEqual({ lump: 'TROOB1', flip: false })
    expect(trooB?.[1]).toBeNull()

    const pisg = result.PISG
    expect(pisg).toBeDefined()
    expect(pisg?.rotated).toBe(false)
    expect(pisg?.frames.A).toEqual([{ lump: 'PISGA0', flip: false }])
  })
})
