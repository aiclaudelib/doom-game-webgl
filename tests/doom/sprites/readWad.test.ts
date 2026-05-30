import { describe, expect, it } from 'vitest'
import { findLump, readWad, spriteLumps } from '../../../scripts/wad/readWad'

const HEADER_SIZE = 12
const DIR_ENTRY_SIZE = 16

interface Entry {
  readonly name: string
  readonly bytes: readonly number[]
}

// Build a minimal PWAD: 12-byte header, then a directory of 16-byte entries,
// then each lump's payload appended after the directory.
function buildWad(entries: readonly Entry[]): Uint8Array {
  const dirOfs = HEADER_SIZE
  const dataOfs = dirOfs + entries.length * DIR_ENTRY_SIZE
  const totalData = entries.reduce((sum, e) => sum + e.bytes.length, 0)
  const buf = new Uint8Array(dataOfs + totalData)
  const view = new DataView(buf.buffer)

  for (let i = 0; i < 4; i++) buf[i] = 'PWAD'.charCodeAt(i)
  view.setInt32(4, entries.length, true)
  view.setInt32(8, dirOfs, true)

  let filepos = dataOfs
  entries.forEach((entry, i) => {
    const off = dirOfs + i * DIR_ENTRY_SIZE
    view.setInt32(off, filepos, true)
    view.setInt32(off + 4, entry.bytes.length, true)
    for (let c = 0; c < entry.name.length && c < 8; c++) {
      buf[off + 8 + c] = entry.name.charCodeAt(c)
    }
    buf.set(entry.bytes, filepos)
    filepos += entry.bytes.length
  })

  return buf
}

const trooBytes = [0xde, 0xad, 0xbe, 0xef]
const wad = buildWad([
  { name: 'S_START', bytes: [] },
  { name: 'TROOA1', bytes: trooBytes },
  { name: 'S_END', bytes: [] },
])

describe('readWad', () => {
  it('parses every directory entry with name, size, and data slice', () => {
    const lumps = readWad(wad)
    expect(lumps).toHaveLength(3)
    expect(lumps.map(l => l.name)).toEqual(['S_START', 'TROOA1', 'S_END'])
    expect(lumps.map(l => l.data.length)).toEqual([0, 4, 0])
    expect(Array.from(lumps[1]?.data ?? [])).toEqual(trooBytes)
  })

  describe('findLump', () => {
    it('finds a lump by exact name', () => {
      const lumps = readWad(wad)
      const troo = findLump(lumps, 'TROOA1')
      expect(troo?.name).toBe('TROOA1')
      expect(Array.from(troo?.data ?? [])).toEqual(trooBytes)
    })

    it('returns undefined for an unknown name', () => {
      expect(findLump(readWad(wad), 'NOPE')).toBeUndefined()
    })
  })

  describe('spriteLumps', () => {
    it('returns only the size>0 lumps between S_START and S_END', () => {
      const sprites = spriteLumps(readWad(wad))
      expect(sprites.map(l => l.name)).toEqual(['TROOA1'])
      expect(Array.from(sprites[0]?.data ?? [])).toEqual(trooBytes)
    })

    it('returns nothing when there is no S_START marker', () => {
      const plain = buildWad([{ name: 'TROOA1', bytes: trooBytes }])
      expect(spriteLumps(readWad(plain))).toHaveLength(0)
    })
  })
})
