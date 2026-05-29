// React host for the engine. React only owns the <canvas> element and its lifecycle;
// the entire game — menu, HUD, and the pseudo-3D world — is rendered into the canvas
// framebuffer by DoomEngine. No other DOM is created.

import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { DoomEngine } from '~/doom/engine'

/** Fullscreen, pixelated, crosshair-cursor host canvas. Styling the host element is allowed. */
const CANVAS_STYLE: CSSProperties = {
  width: '100vw',
  height: '100vh',
  display: 'block',
  background: 'black',
  cursor: 'crosshair',
}

/** Cap the device-pixel ratio so huge displays don't allocate an enormous backing store. */
const MAX_DPR = 2

export function DoomGame(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }

    const engine = new DoomEngine(canvas)

    const resize = (): void => {
      const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1
      const dpr = rawDpr > 0 ? Math.min(rawDpr, MAX_DPR) : 1
      const clientW = canvas.clientWidth
      const clientH = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(clientW * dpr))
      canvas.height = Math.max(1, Math.round(clientH * dpr))
      engine.resize(clientW, clientH)
    }

    resize()
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', resize)
    }
    engine.start()

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resize)
      }
      // StrictMode mounts/unmounts twice in dev — stop() is idempotent.
      engine.stop()
    }
  }, [])

  return <canvas ref={canvasRef} style={CANVAS_STYLE} />
}
