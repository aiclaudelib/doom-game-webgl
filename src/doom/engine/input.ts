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
    }
    this.held.add(code)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code)
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
    }
    this.canvas = null
    this.held.clear()
    this.pressedThisFrame.clear()
    this.mouseDX = 0
    this.pointerDown = false
    this.weaponSlot = 0
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
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      pointerDown: this.pointerDown,
    }

    // Consume all per-frame state.
    this.pressedThisFrame.clear()
    this.mouseDX = 0
    this.weaponSlot = 0
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
    switch (code) {
      case 'Digit1':
        this.weaponSlot = 1
        break
      case 'Digit2':
        this.weaponSlot = 2
        break
      case 'Digit3':
        this.weaponSlot = 3
        break
      case 'Digit4':
        this.weaponSlot = 4
        break
      case 'Digit5':
        this.weaponSlot = 5
        break
      case 'Digit6':
        this.weaponSlot = 6
        break
      case 'Digit7':
        this.weaponSlot = 7
        break
      default:
        break
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
      code === b.fire
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
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
      case 'Digit6':
      case 'Digit7':
        return true
      default:
        return false
    }
  }
}
