// Browser-side atlas loader: fetch the manifest JSON, decode the companion PNG via a
// canvas, and hand the raw RGBA + manifest to SpriteAtlas. Every failure path (no
// fetch/Image/document, network error, bad image, no 2D context) degrades to null and
// nothing throws — so under jsdom/headless this resolves to null cleanly.

import { SpriteAtlas } from '~/doom/engine/sprites/spriteAtlas'
import type { AtlasManifest } from '~/doom/engine/sprites/atlasTypes'

/** Resolve true on load, false on error, for an <img> already pointed at `url`. */
function awaitImage(img: HTMLImageElement, url: string): Promise<boolean> {
  return new Promise(resolve => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

/** Load + decode a sprite atlas from its manifest URL, or null when unavailable. */
export async function loadAtlas(manifestUrl: string): Promise<SpriteAtlas | null> {
  try {
    if (typeof fetch !== 'function') return null
    if (typeof Image === 'undefined') return null
    if (typeof document === 'undefined') return null
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- runtime feature-detect, not the deprecated overload
    if (typeof document.createElement !== 'function') return null

    const res = await fetch(manifestUrl)
    if (!res.ok) return null
    const manifest = (await res.json()) as AtlasManifest

    const imageUrl = new URL(manifest.image, new URL(manifestUrl, document.baseURI)).href

    const img = new Image()
    const ok = await awaitImage(img, imageUrl)
    if (!ok) return null

    const canvas = document.createElement('canvas')
    canvas.width = manifest.atlas.width
    canvas.height = manifest.atlas.height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    return new SpriteAtlas(manifest, data, canvas.width, canvas.height)
  } catch {
    return null
  }
}
