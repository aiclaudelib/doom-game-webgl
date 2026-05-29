// Top-level orchestrator. Owns the framebuffer, presenter, input, audio, assets and
// the active World, drives a fixed-timestep GameLoop, routes WorldEvents to sound and
// mode transitions, and paints the right screen per GameMode. The ONLY game-side module
// allowed to wire the rendering, simulation, UI and audio columns together.
//
// Headless-safe: start() degrades to an idle no-op when no drawing context is available
// (jsdom / no WebGL/2D), and every DOM/audio touch is guarded.

import { MAX_HEALTH, RENDER_H, RENDER_W, VIEW_W } from '~/doom/config'
import type {
  Assets,
  BindingAction,
  DepthBuffer,
  Framebuffer,
  GameMode,
  InputFrame,
  KeyBindings,
  MenuAction,
  MenuState,
  Player,
  Presenter,
  Settings,
} from '~/doom/types'
import { mulberry32 } from '~/doom/core/rng'
import { createFramebuffer } from '~/doom/engine/framebuffer'
import { InputManager } from '~/doom/engine/input'
import { GameLoop } from '~/doom/engine/loop'
import { createPresenter } from '~/doom/engine/present'
import { renderWorld } from '~/doom/engine/raycaster'
import { renderSprites } from '~/doom/engine/sprites'
import { createAssets } from '~/doom/engine/textures'
import { compileLevel } from '~/doom/game/map'
import { LEVELS } from '~/doom/game/levels'
import { loadSettings, saveSettings } from '~/doom/game/state'
import { World } from '~/doom/game/world'
import type { WorldEvents } from '~/doom/game/world'
import { renderMenu, updateMenu } from '~/doom/ui/menu'
import { renderFlash, renderHud, renderWeaponSprite } from '~/doom/ui/hud'
import { AudioEngine } from '~/doom/audio/audio'
import { MusicPlayer } from '~/doom/audio/music'
import { playSfx } from '~/doom/audio/sfx'

/** Fixed asset seed — the procedural world looks identical on every run. */
const ASSET_SEED = 0x1d00d

/** Base simulation seed; offset per level so each map's randomness is deterministic. */
const WORLD_SEED = 0xa17e

export class DoomEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly presenter: Presenter
  private readonly fb: Framebuffer
  private readonly depth: DepthBuffer
  private readonly inputManager: InputManager
  private readonly audio: AudioEngine
  private readonly music: MusicPlayer
  private readonly assets: Assets
  private readonly loop: GameLoop

  private settings: Settings
  private mode: GameMode = 'menu'
  private readonly menuState: MenuState = { cursor: 0, rebinding: null, returnTo: null }
  private levelIndex = 0
  private world: World | null = null

  private started = false
  private stopped = false
  private audioUnlocked = false
  private rebindHooked = false
  private lastClientW = 0
  private lastClientH = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.settings = loadSettings()
    this.presenter = createPresenter(canvas)
    this.fb = createFramebuffer(RENDER_W, RENDER_H)
    this.depth = new Float32Array(VIEW_W)
    this.inputManager = new InputManager(this.settings.bindings)
    this.audio = new AudioEngine(this.settings)
    this.music = new MusicPlayer(this.audio)
    this.assets = createAssets(ASSET_SEED)
    this.loop = new GameLoop(
      dt => this.tick(dt),
      () => this.frame(),
    )
  }

  start(): void {
    if (this.started) {
      return
    }
    if (!this.presenter.ready) {
      // No drawing context (jsdom / headless): do not attach listeners or spin a loop.
      console.warn('DoomEngine: no drawing context available; running idle.')
      return
    }
    this.started = true
    this.stopped = false

    this.inputManager.attach(this.canvas)
    this.attachGesture()
    this.presenter.resize(this.lastClientW, this.lastClientH)
    this.inputManager.setViewport(this.presenter.viewport)
    this.loop.start()
    this.music.play('menu')
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.started = false
    this.loop.stop()
    this.unhookRebind()
    this.detachGesture()
    this.inputManager.detach()
    this.music.dispose()
    this.audio.dispose()
    this.presenter.dispose()
  }

  resize(clientWidth: number, clientHeight: number): void {
    this.lastClientW = clientWidth
    this.lastClientH = clientHeight
    this.presenter.resize(clientWidth, clientHeight)
    this.inputManager.setViewport(this.presenter.viewport)
  }

  // ── one-time user-gesture audio unlock ──

  private readonly onGesture = (): void => {
    this.unlockAudio()
  }

  /**
   * Pointer lock must be requested from within a genuine user-gesture handler (a real canvas
   * click), not from the polled raf tick. We grab the mouse only while actually playing.
   */
  private readonly onCanvasClick = (): void => {
    if (this.mode === 'playing') {
      this.inputManager.requestPointerLock()
    }
  }

  private attachGesture(): void {
    const canvas = this.canvas
    if (typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('pointerdown', this.onGesture)
      canvas.addEventListener('keydown', this.onGesture)
      canvas.addEventListener('click', this.onCanvasClick)
    }
  }

  private detachGesture(): void {
    const canvas = this.canvas
    if (typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('pointerdown', this.onGesture)
      canvas.removeEventListener('keydown', this.onGesture)
      canvas.removeEventListener('click', this.onCanvasClick)
    }
  }

  private unlockAudio(): void {
    if (this.audioUnlocked) {
      return
    }
    this.audioUnlocked = true
    this.audio.resume()
  }

  // ── simulation ──

  private tick(dt: number): void {
    const input = this.inputManager.poll()

    // First real key/click anywhere unlocks the audio context (autoplay policy).
    if (this.hadUserIntent(input)) {
      this.unlockAudio()
    }

    if (this.mode === 'playing') {
      this.tickPlaying(input, dt)
      return
    }

    if (this.mode === 'paused') {
      // Still poll (above) but never advance the world; just run the pause menu.
      this.applyMenu(updateMenu(this.mode, this.menuState, input, this.settings))
      return
    }

    // Menu family (menu/options/controls/dead/levelComplete/victory).
    this.captureRebind()
    this.applyMenu(updateMenu(this.mode, this.menuState, input, this.settings))
  }

  private tickPlaying(input: InputFrame, dt: number): void {
    const world = this.world
    if (world === null) {
      this.mode = 'menu'
      return
    }

    const ev = world.update(input, dt)
    this.playEventSounds(ev)

    if (ev.playerDead) {
      this.mode = 'dead'
      this.menuState.cursor = 0
      return
    }
    if (ev.reachedExit) {
      this.advanceLevel()
      return
    }

    // Escape pauses the running game.
    if (input.nav.back) {
      this.mode = 'paused'
      this.menuState.cursor = 0
    }
  }

  /** Translate world events into one-shot sound effects. */
  private playEventSounds(ev: WorldEvents): void {
    if (ev.fired !== null) {
      playSfx(this.audio, ev.fired)
    }
    if (ev.dryFired) {
      playSfx(this.audio, 'noAmmo')
    }
    // Death and hurt are independent across enemies — a death and a separate flinch can both
    // happen in one tick, so these must NOT be chained with else-if.
    if (ev.enemyDied) {
      playSfx(this.audio, 'enemyDie')
    }
    if (ev.enemyHurt) {
      playSfx(this.audio, 'groan')
    }
    if (ev.playerHurt) {
      playSfx(this.audio, 'hurt')
    }
    if (ev.doorOpened) {
      playSfx(this.audio, 'door')
    }
    if (ev.pickedUp) {
      playSfx(this.audio, 'pickup')
    }
  }

  /**
   * Reached an exit tile. Keep the COMPLETED world alive as the backdrop and show its stats;
   * the next level is only built when CONTINUE/nextLevel is applied. After the last level we go
   * straight to victory.
   */
  private advanceLevel(): void {
    const next = this.levelIndex + 1
    if (next >= LEVELS.length) {
      this.mode = 'victory'
      this.menuState.cursor = 0
      this.music.play('menu')
      return
    }
    this.mode = 'levelComplete'
    this.menuState.cursor = 0
  }

  /** CONTINUE from the level-complete screen: build the next level and carry inventory forward. */
  private continueToNextLevel(): void {
    const next = this.levelIndex + 1
    if (next >= LEVELS.length) {
      this.mode = 'victory'
      this.menuState.cursor = 0
      this.music.play('menu')
      return
    }
    const previous = this.world
    this.levelIndex = next
    this.loadLevel(next)
    if (this.world !== null) {
      if (previous !== null) {
        this.carryInventory(previous.player, this.world.player)
      }
      this.mode = 'playing'
      this.music.play('combat')
    }
  }

  /**
   * Carry the previous level's progress onto the freshly spawned player: weapons, ammo, armor and
   * (clamped) health survive; keys reset per level since each map has its own locks.
   */
  private carryInventory(from: Player, to: Player): void {
    to.health = Math.min(from.health, MAX_HEALTH)
    to.armor = from.armor
    to.ammo = { ...from.ammo }
    to.maxAmmo = { ...from.maxAmmo }
    to.weapons = { ...from.weapons }
    to.currentWeapon = from.currentWeapon
    // Keys are intentionally NOT carried — every level introduces fresh locks.
  }

  /** Build a fresh World from the level at the given index, using the engine's current settings. */
  private loadLevel(index: number): void {
    const source = LEVELS[index]
    if (source === undefined) {
      this.world = null
      return
    }
    const level = compileLevel(source)
    const rng = mulberry32(WORLD_SEED + index)
    this.world = new World(level, this.assets, rng, this.settings)
  }

  private startNewGame(): void {
    this.levelIndex = 0
    this.loadLevel(0)
    if (this.world !== null) {
      this.mode = 'playing'
      this.music.play('combat')
    }
  }

  // ── menu action application ──

  private applyMenu(action: MenuAction): void {
    switch (action.type) {
      case 'none':
        return
      case 'newGame':
        playSfx(this.audio, 'menuSelect')
        this.startNewGame()
        return
      case 'resume':
        this.mode = 'playing'
        this.music.play('combat')
        return
      case 'goto':
        playSfx(this.audio, 'menuMove')
        this.menuState.cursor = 0
        // Opening options/controls: remember where we came from so BACK/Esc returns there
        // (pause keeps the running game alive and resumable; otherwise the main menu).
        if (action.screen === 'options' || action.screen === 'controls') {
          this.menuState.returnTo = this.mode === 'paused' ? 'paused' : 'menu'
        }
        this.mode = action.screen
        return
      case 'quitToMenu':
        this.world = null
        this.levelIndex = 0
        this.mode = 'menu'
        this.menuState.cursor = 0
        this.music.play('menu')
        return
      case 'restart':
        playSfx(this.audio, 'menuSelect')
        this.loadLevel(this.levelIndex)
        if (this.world !== null) {
          this.mode = 'playing'
          this.music.play('combat')
        }
        return
      case 'nextLevel':
        playSfx(this.audio, 'menuSelect')
        this.continueToNextLevel()
        return
      case 'quit':
        // No window to close in a canvas game — return to the title screen.
        this.mode = 'menu'
        this.menuState.cursor = 0
        return
      case 'setMasterVolume':
        this.settings = { ...this.settings, masterVolume: action.value }
        this.persistSettings()
        return
      case 'setSfxVolume':
        this.settings = { ...this.settings, sfxVolume: action.value }
        this.persistSettings()
        return
      case 'setMusicVolume':
        this.settings = { ...this.settings, musicVolume: action.value }
        this.persistSettings()
        return
      case 'setSensitivity':
        this.settings = { ...this.settings, mouseSensitivity: action.value }
        this.persistSettings()
        return
      case 'toggleMouseLook':
        this.settings = { ...this.settings, mouseLook: !this.settings.mouseLook }
        this.persistSettings()
        return
      case 'rebind':
        this.applyRebind(action.action, action.code)
        return
      default:
        return
    }
  }

  private persistSettings(): void {
    saveSettings(this.settings)
    this.audio.setVolumes(this.settings)
    // Push the new settings into a live world so in-game sensitivity/mouse-look take effect
    // immediately (e.g. when tweaking OPTIONS from the pause menu).
    if (this.world !== null) {
      this.world.setSettings(this.settings)
    }
  }

  private applyRebind(action: BindingAction, code: string): void {
    const bindings: KeyBindings = { ...this.settings.bindings, [action]: code }
    this.settings = { ...this.settings, bindings }
    this.inputManager.setBindings(bindings)
    saveSettings(this.settings)
  }

  /**
   * The controls screen sets menu.rebinding to capture a key; updateMenu never returns a
   * `rebind` action itself, so the engine grabs the next raw keydown. The InputManager poll
   * only surfaces structured intent, so a one-shot window listener is the lightest reader.
   */
  private captureRebind(): void {
    if (this.menuState.rebinding !== null) {
      this.hookRebind()
    } else {
      this.unhookRebind()
    }
  }

  private readonly onRebindKey = (e: KeyboardEvent): void => {
    const action = this.menuState.rebinding
    if (action === null) {
      this.unhookRebind()
      return
    }
    if (e.code === 'Escape') {
      // Cancel — the menu's own nav.back handling clears rebinding on the next poll.
      this.unhookRebind()
      return
    }
    e.preventDefault()
    this.applyRebind(action, e.code)
    this.menuState.rebinding = null
    playSfx(this.audio, 'menuSelect')
    this.unhookRebind()
  }

  private hookRebind(): void {
    if (this.rebindHooked || typeof window === 'undefined') {
      return
    }
    this.rebindHooked = true
    window.addEventListener('keydown', this.onRebindKey, { capture: true })
  }

  private unhookRebind(): void {
    if (!this.rebindHooked || typeof window === 'undefined') {
      return
    }
    this.rebindHooked = false
    window.removeEventListener('keydown', this.onRebindKey, { capture: true })
  }

  private hadUserIntent(input: InputFrame): boolean {
    return (
      input.fire ||
      input.use ||
      input.pointerDown ||
      input.weaponSlot > 0 ||
      input.nav.up ||
      input.nav.down ||
      input.nav.left ||
      input.nav.right ||
      input.nav.confirm ||
      input.nav.back ||
      input.moveForward !== 0 ||
      input.moveStrafe !== 0 ||
      input.turnAxis !== 0
    )
  }

  // ── rendering ──

  private frame(): void {
    const world = this.world

    if ((this.mode === 'playing' || this.mode === 'paused') && world !== null) {
      renderWorld(this.fb, world, world.camera, this.assets, this.depth)
      renderSprites(this.fb, world.buildSprites(), world.camera, this.depth)
      renderWeaponSprite(this.fb, world.player, this.assets)
      renderHud(this.fb, world.player, world.stats)
      renderFlash(this.fb, world.player)
      if (this.mode === 'paused') {
        renderMenu(this.fb, this.mode, this.menuState, this.settings, world.stats)
      }
    } else if ((this.mode === 'dead' || this.mode === 'levelComplete') && world !== null) {
      // These overlay the last world frame; redraw it underneath.
      renderWorld(this.fb, world, world.camera, this.assets, this.depth)
      renderSprites(this.fb, world.buildSprites(), world.camera, this.depth)
      renderHud(this.fb, world.player, world.stats)
      renderMenu(this.fb, this.mode, this.menuState, this.settings, world.stats)
    } else {
      // Pure menu screens (menu/options/controls/victory) clear themselves.
      renderMenu(this.fb, this.mode, this.menuState, this.settings, world?.stats ?? null)
    }

    this.presenter.present(this.fb)
  }
}
