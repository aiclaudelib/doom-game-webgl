import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAtlas } from '~/doom/engine/sprites/atlasLoader'

describe('loadAtlas (headless safety)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves to null without throwing when the network is unavailable', async () => {
    // jsdom has no canvas 2D backend, so even a successful fetch would dead-end at
    // getContext('2d') === null. Reject fetch to stay deterministic across jsdom builds.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no net')))
    expect(await loadAtlas('x/atlas.json')).toBeNull()
  })

  it('returns null when fetch is undefined', async () => {
    vi.stubGlobal('fetch', undefined)
    expect(await loadAtlas('x/atlas.json')).toBeNull()
  })
})
