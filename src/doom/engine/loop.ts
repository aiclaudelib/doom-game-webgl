// Fixed-timestep game loop. update() is driven at a constant TIMESTEP via an
// accumulator so simulation stays deterministic regardless of display refresh; render()
// runs once per animation frame. Fully headless-safe: start() is a no-op when
// requestAnimationFrame is unavailable (jsdom), and performance.now() is guarded.

import { MAX_FRAME_TIME, TIMESTEP } from '~/doom/config'

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return 0
}

export class GameLoop {
  private isRunning = false
  private rafId = 0
  private lastTime = 0
  private accumulator = 0

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: () => void,
  ) {}

  get running(): boolean {
    return this.isRunning
  }

  start(): void {
    if (this.isRunning) {
      return
    }
    if (typeof requestAnimationFrame === 'undefined') {
      return
    }
    this.isRunning = true
    this.lastTime = now()
    this.accumulator = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    if (!this.isRunning) {
      return
    }
    this.isRunning = false
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId)
    }
    this.rafId = 0
    this.accumulator = 0
  }

  private readonly frame = (): void => {
    if (!this.isRunning) {
      return
    }
    const current = now()
    let delta = (current - this.lastTime) / 1000
    this.lastTime = current
    // Clamp to dodge the spiral-of-death after a long pause / tab switch.
    if (delta > MAX_FRAME_TIME) {
      delta = MAX_FRAME_TIME
    }
    if (delta < 0) {
      delta = 0
    }
    this.accumulator += delta
    while (this.accumulator >= TIMESTEP) {
      this.update(TIMESTEP)
      this.accumulator -= TIMESTEP
    }
    this.render()
    if (this.isRunning) {
      this.rafId = requestAnimationFrame(this.frame)
    }
  }
}
