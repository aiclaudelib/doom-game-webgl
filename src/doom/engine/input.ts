// Keyboard + mouse intent capture, with zero engine dependencies. Tracks held keys
// in a Set keyed by KeyboardEvent.code, accumulates pointer-locked mouse deltas, and
// snapshots one InputFrame per poll() — consuming all per-frame edge state on read.

import type { InputFrame, KeyBindings, NavEdge, ViewportTransform } from '~/doom/types'

const EMPTY_NAV: NavEdge = {
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  back: false,
}

export class InputManager {
  private bindings: KeyBindings
  private canvas: HTMLCanvasElement | null = null
  private viewport: ViewportTransform = { offsetX: 0, offsetY: 0, scale: 1 }

  private readonly held = new Set<string>()
  // Edge codes that were pressed since the previous poll (consumed on poll).
  private readonly pressedThisFrame = new Set<string>()

  private mouseDX = 0
  private pointerDown = false
  private pointerX = 0
  private pointerY = 0
  private weaponSlot = 0
  private weaponCycle: -1 | 0 | 1 = 0

  constructor(bindings: KeyBindings) {
    this.bindings = bindings
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code
    // Swallow scrolling / browser shortcuts for keys the game owns.
    if (this.isGameKey(code)) {
      e.preventDefault()
    }
    if (!this.held.has(code)) {
      this.pressedThisFrame.add(code)
      this.captureWeaponSlot(code)
      this.captureWeaponCycle(code)
    }
    this.held.add(code)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code)
  }

  private readonly onWheel = (e: WheelEvent): void => {
    // Scroll up (deltaY < 0) → previous weapon; scroll down → next. Last write wins.
    this.weaponCycle = e.deltaY < 0 ? -1 : 1
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.isPointerLocked()) {
      this.mouseDX += e.movementX
      return
    }
    this.updatePointerFromClient(e.clientX, e.clientY)
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) {
      return
    }
    this.pointerDown = true
    if (!this.isPointerLocked()) {
      this.updatePointerFromClient(e.clientX, e.clientY)
    }
  }

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
  }

  private readonly onBlur = (): void => {
    // Dropping focus must not leave keys stuck "held".
    this.held.clear()
  }

  attach(canvas: HTMLCanvasElement): void {
    this.detach()
    this.canvas = canvas
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown)
      window.addEventListener('keyup', this.onKeyUp)
      window.addEventListener('blur', this.onBlur)
    }
    canvas.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
  }

  detach(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown)
      window.removeEventListener('keyup', this.onKeyUp)
      window.removeEventListener('blur', this.onBlur)
    }
    const canvas = this.canvas
    if (canvas !== null) {
      canvas.removeEventListener('mousemove', this.onMouseMove)
      canvas.removeEventListener('mousedown', this.onMouseDown)
      canvas.removeEventListener('contextmenu', this.onContextMenu)
      canvas.removeEventListener('wheel', this.onWheel)
    }
    this.canvas = null
    this.held.clear()
    this.pressedThisFrame.clear()
    this.mouseDX = 0
    this.pointerDown = false
    this.weaponSlot = 0
    this.weaponCycle = 0
  }

  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings
  }

  setViewport(v: ViewportTransform): void {
    this.viewport = v
  }

  requestPointerLock(): void {
    const canvas = this.canvas
    if (canvas !== null && typeof canvas.requestPointerLock === 'function') {
      void canvas.requestPointerLock()
    }
  }

  poll(): InputFrame {
    const b = this.bindings
    const moveForward = this.axis(b.forward, b.back)
    const moveStrafe = this.axis(b.strafeRight, b.strafeLeft)
    const turnAxis = this.axis(b.turnRight, b.turnLeft)

    const firing = this.held.has(b.fire)
    const fire = this.pressedThisFrame.has(b.fire)
    const run = this.held.has(b.run)
    const use = this.pressedThisFrame.has(b.use)

    const nav = this.buildNav()

    const frame: InputFrame = {
      moveForward,
      moveStrafe,
      turnAxis,
      mouseDX: this.mouseDX,
      firing,
      fire,
      run,
      use,
      nav,
      weaponSlot: this.weaponSlot,
      weaponCycle: this.weaponCycle,
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      pointerDown: this.pointerDown,
    }

    // Consume all per-frame state.
    this.pressedThisFrame.clear()
    this.mouseDX = 0
    this.weaponSlot = 0
    this.weaponCycle = 0
    this.pointerDown = false

    return frame
  }

  // ── internals ──

  private axis(positive: string, negative: string): number {
    const p = this.held.has(positive) ? 1 : 0
    const n = this.held.has(negative) ? 1 : 0
    return p - n
  }

  private buildNav(): NavEdge {
    const pressed = this.pressedThisFrame
    const up = pressed.has('ArrowUp') || pressed.has('KeyW')
    const down = pressed.has('ArrowDown') || pressed.has('KeyS')
    const left = pressed.has('ArrowLeft') || pressed.has('KeyA')
    const right = pressed.has('ArrowRight') || pressed.has('KeyD')
    const confirm = pressed.has('Enter') || pressed.has('NumpadEnter') || pressed.has('Space')
    const back = pressed.has('Escape')
    if (!up && !down && !left && !right && !confirm && !back) {
      return EMPTY_NAV
    }
    return { up, down, left, right, confirm, back }
  }

  private captureWeaponSlot(code: string): void {
    const b = this.bindings
    const slots: readonly string[] = [
      b.weapon1,
      b.weapon2,
      b.weapon3,
      b.weapon4,
      b.weapon5,
      b.weapon6,
      b.weapon7,
    ]
    const idx = slots.indexOf(code)
    if (idx >= 0) {
      this.weaponSlot = idx + 1
    }
  }

  private captureWeaponCycle(code: string): void {
    if (code === this.bindings.weaponNext) {
      this.weaponCycle = 1
    } else if (code === this.bindings.weaponPrev) {
      this.weaponCycle = -1
    }
  }

  private isPointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.canvas
  }

  private updatePointerFromClient(clientX: number, clientY: number): void {
    const canvas = this.canvas
    if (canvas === null || typeof canvas.getBoundingClientRect !== 'function') {
      return
    }
    const rect = canvas.getBoundingClientRect()
    const t = this.viewport
    const localX = clientX - rect.left - t.offsetX
    const localY = clientY - rect.top - t.offsetY
    const scale = t.scale === 0 ? 1 : t.scale
    this.pointerX = localX / scale
    this.pointerY = localY / scale
  }

  private isGameKey(code: string): boolean {
    const b = this.bindings
    if (
      code === b.forward ||
      code === b.back ||
      code === b.turnLeft ||
      code === b.turnRight ||
      code === b.strafeLeft ||
      code === b.strafeRight ||
      code === b.run ||
      code === b.use ||
      code === b.fire ||
      code === b.weapon1 ||
      code === b.weapon2 ||
      code === b.weapon3 ||
      code === b.weapon4 ||
      code === b.weapon5 ||
      code === b.weapon6 ||
      code === b.weapon7 ||
      code === b.weaponNext ||
      code === b.weaponPrev
    ) {
      return true
    }
    switch (code) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Space':
      case 'Enter':
        return true
      default:
        return false
    }
  }
}
