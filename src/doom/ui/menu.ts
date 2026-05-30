// Canvas menu system: renders every non-playing screen and translates keyboard/mouse
// input into MenuActions for the engine to apply. No game-logic imports.

import { RENDER_H, RENDER_W } from '~/doom/config'
import type {
  BindingAction,
  Framebuffer,
  GameMode,
  InputFrame,
  MenuAction,
  MenuState,
  Settings,
} from '~/doom/types'
import { pal } from '~/doom/core/color'
import { drawText, drawTextCentered, fillRect } from '~/doom/engine/framebuffer'
import type { WorldStats } from '~/doom/ui/widgets'
import { drawMenuList, drawPanel, drawSlider, drawTitle, pointInRect } from '~/doom/ui/widgets'

// ─────────────────────────────────────────────────────────────────────────────
// Layout model — a screen is a list of rows; both render and update walk it so the
// hit-boxes and the visuals never drift apart.
// ─────────────────────────────────────────────────────────────────────────────

type RowKind = 'action' | 'slider' | 'toggle' | 'binding'

interface MenuRow {
  readonly kind: RowKind
  readonly label: string
  /** Slider fraction 0..1 (slider rows only). */
  readonly value?: number
  /** Binding action this row rebinds (binding rows only). */
  readonly binding?: BindingAction
  /** Action emitted on confirm/click (action rows only). */
  readonly onConfirm?: MenuAction
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const CX = RENDER_W / 2
const ROW_H = 14
const ROW_W = 200
const SLIDER_W = ROW_W - 64

const MAX_SENSITIVITY = 0.006
const MAX_VOLUME = 1
const SLIDER_STEP = 0.05

const BINDING_ORDER: readonly BindingAction[] = [
  'forward',
  'back',
  'turnLeft',
  'turnRight',
  'strafeLeft',
  'strafeRight',
  'run',
  'use',
  'fire',
]

const BINDING_LABEL: Readonly<Record<BindingAction, string>> = {
  forward: 'MOVE FORWARD',
  back: 'MOVE BACK',
  turnLeft: 'TURN LEFT',
  turnRight: 'TURN RIGHT',
  strafeLeft: 'STRAFE LEFT',
  strafeRight: 'STRAFE RIGHT',
  run: 'RUN',
  use: 'USE',
  fire: 'FIRE',
  weapon1: 'WEAPON 1',
  weapon2: 'WEAPON 2',
  weapon3: 'WEAPON 3',
  weapon4: 'WEAPON 4',
  weapon5: 'WEAPON 5',
  weapon6: 'WEAPON 6',
  weapon7: 'WEAPON 7',
  weaponNext: 'NEXT WEAPON',
  weaponPrev: 'PREV WEAPON',
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function sensitivityToFraction(value: number): number {
  return clamp01(value / MAX_SENSITIVITY)
}

function fractionToSensitivity(frac: number): number {
  return clamp01(frac) * MAX_SENSITIVITY
}

/** Builds the row model for the given screen. The pure source of truth for layout. */
function rowsFor(mode: GameMode, settings: Settings): MenuRow[] {
  switch (mode) {
    case 'menu':
      return [
        { kind: 'action', label: 'NEW GAME', onConfirm: { type: 'newGame' } },
        { kind: 'action', label: 'OPTIONS', onConfirm: { type: 'goto', screen: 'options' } },
        { kind: 'action', label: 'CONTROLS', onConfirm: { type: 'goto', screen: 'controls' } },
        { kind: 'action', label: 'QUIT', onConfirm: { type: 'quit' } },
      ]
    case 'options':
      return [
        { kind: 'slider', label: 'MASTER', value: settings.masterVolume / MAX_VOLUME },
        { kind: 'slider', label: 'SFX', value: settings.sfxVolume / MAX_VOLUME },
        { kind: 'slider', label: 'MUSIC', value: settings.musicVolume / MAX_VOLUME },
        {
          kind: 'slider',
          label: 'SENSITIVITY',
          value: sensitivityToFraction(settings.mouseSensitivity),
        },
        { kind: 'toggle', label: 'MOUSE LOOK' },
        { kind: 'action', label: 'BACK', onConfirm: { type: 'goto', screen: 'menu' } },
      ]
    case 'controls': {
      const rows: MenuRow[] = BINDING_ORDER.map(action => ({
        kind: 'binding' as const,
        label: BINDING_LABEL[action],
        binding: action,
      }))
      rows.push({ kind: 'action', label: 'BACK', onConfirm: { type: 'goto', screen: 'menu' } })
      return rows
    }
    case 'paused':
      return [
        { kind: 'action', label: 'RESUME', onConfirm: { type: 'resume' } },
        { kind: 'action', label: 'OPTIONS', onConfirm: { type: 'goto', screen: 'options' } },
        { kind: 'action', label: 'QUIT TO MENU', onConfirm: { type: 'quitToMenu' } },
      ]
    case 'dead':
      return [
        { kind: 'action', label: 'RETRY', onConfirm: { type: 'restart' } },
        { kind: 'action', label: 'QUIT TO MENU', onConfirm: { type: 'quitToMenu' } },
      ]
    case 'levelComplete':
      return [{ kind: 'action', label: 'CONTINUE', onConfirm: { type: 'nextLevel' } }]
    case 'victory':
      return [{ kind: 'action', label: 'BACK TO MENU', onConfirm: { type: 'quitToMenu' } }]
    default:
      return []
  }
}

/** Where the (selectable) rows begin on screen — leaves room for titles/stats above. */
function listTop(mode: GameMode): number {
  switch (mode) {
    case 'options':
      return 72
    case 'controls':
      return 42
    case 'dead':
      return 124
    case 'levelComplete':
      return 132
    case 'victory':
      return 150
    case 'paused':
      return 104
    default:
      return 96
  }
}

/** Pixel rectangle of a row index — identical for render & hit-test. */
function rowRect(mode: GameMode, index: number): Rect {
  const top = listTop(mode)
  return { x: CX - ROW_W / 2, y: top + index * ROW_H, w: ROW_W, h: ROW_H }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/** Strips the verbose KeyboardEvent.code prefix for a tidy display label. */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) {
    return code.slice(3)
  }
  if (code.startsWith('Digit')) {
    return code.slice(5)
  }
  if (code.startsWith('Arrow')) {
    return code.slice(5)
  }
  return code
}

/** Draws the slider/toggle/binding rows for the options & controls screens. */
function renderDetailRow(
  fb: Framebuffer,
  row: MenuRow,
  rect: Rect,
  selected: boolean,
  menu: MenuState,
  settings: Settings,
): void {
  if (row.kind === 'slider') {
    drawSlider(fb, row.label, row.value ?? 0, rect.x, rect.y, SLIDER_W, selected)
    return
  }

  const labelColor = selected ? pal('yellow') : pal('lightGray')

  // Only rows carrying a right-hand value draw the left-aligned label; plain action
  // rows (e.g. BACK) render solely via the centred path below to avoid a double-draw.
  const hasValue = row.kind === 'toggle' || row.kind === 'binding'
  if (hasValue) {
    drawText(fb, row.label, rect.x, rect.y, labelColor)
  }

  if (row.kind === 'toggle') {
    drawText(fb, settings.mouseLook ? 'ON' : 'OFF', rect.x + ROW_W - 40, rect.y, labelColor)
    return
  }

  if (row.kind === 'binding' && row.binding !== undefined) {
    const capturing = menu.rebinding === row.binding
    const code = settings.bindings[row.binding]
    const valueColor = capturing ? pal('orange') : selected ? pal('white') : pal('gray')
    const text = capturing ? '<PRESS KEY>' : keyLabel(code)
    drawText(fb, text, rect.x + ROW_W - 84, rect.y, valueColor)
    return
  }

  // A trailing BACK action mixed into a detail screen.
  drawTextCentered(fb, selected ? `> ${row.label} <` : row.label, CX, rect.y, labelColor)
}

/** Renders the kills / completion summaries for the end-of-level and victory screens. */
function renderStatsBlock(fb: Framebuffer, mode: GameMode, stats: WorldStats | null): void {
  if (mode === 'levelComplete' && stats !== null) {
    drawTextCentered(fb, stats.level, CX, 80, pal('white'))
    drawTextCentered(fb, `KILLS  ${stats.kills} / ${stats.totalEnemies}`, CX, 100, pal('lightGray'))
  } else if (mode === 'victory') {
    drawTextCentered(fb, 'YOU CLEARED ALL LEVELS!', CX, 74, pal('white'))
    drawTextCentered(fb, 'THANKS FOR PLAYING', CX, 94, pal('lightGray'))
    drawTextCentered(fb, 'A PROCEDURAL DOOM-LIKE', CX, 110, pal('gray'))
  }
}

function renderTitle(fb: Framebuffer, mode: GameMode): void {
  switch (mode) {
    case 'menu':
      // "#slop" hashtag tag sitting above the logo → reads as "slop Doom".
      drawTextCentered(fb, '#SLOP', CX, 10, pal('cyan'), 2)
      drawTitle(fb, 'DOOM', CX, 26)
      break
    case 'options':
      drawTextCentered(fb, 'OPTIONS', CX, 44, pal('orange'), 2)
      break
    case 'controls':
      drawTextCentered(fb, 'CONTROLS', CX, 18, pal('orange'), 2)
      break
    case 'paused':
      drawTextCentered(fb, 'PAUSED', CX, 64, pal('orange'), 2)
      break
    case 'dead':
      drawTitle(fb, 'YOU DIED', CX, 48)
      break
    case 'levelComplete':
      drawTextCentered(fb, 'LEVEL COMPLETE', CX, 52, pal('green'), 2)
      break
    case 'victory':
      drawTitle(fb, 'VICTORY', CX, 30)
      break
    default:
      break
  }
}

function renderFooter(fb: Framebuffer, mode: GameMode): void {
  if (mode === 'controls') {
    drawTextCentered(fb, 'ENTER: REBIND   ESC: BACK', CX, RENDER_H - 11, pal('gray'))
  } else if (mode === 'options') {
    drawTextCentered(fb, 'LEFT/RIGHT: ADJUST   ESC: BACK', CX, RENDER_H - 11, pal('gray'))
  }
}

/** Draws the screen for a given mode. Stats are only used by completion/victory screens. */
export function renderMenu(
  fb: Framebuffer,
  mode: GameMode,
  menu: MenuState,
  settings: Settings,
  stats: WorldStats | null,
): void {
  // Standalone screens clear to black; pause/dead/levelComplete overlay the live world the
  // engine already rendered into the framebuffer.
  if (mode === 'menu' || mode === 'options' || mode === 'controls' || mode === 'victory') {
    fillRect(fb, 0, 0, RENDER_W, RENDER_H, pal('black'))
  } else {
    fillRect(fb, 0, 0, RENDER_W, RENDER_H, pal('black'), 170)
  }

  renderTitle(fb, mode)
  renderStatsBlock(fb, mode, stats)

  const rows = rowsFor(mode, settings)

  if (mode === 'options' || mode === 'controls') {
    const top = listTop(mode)
    drawPanel(fb, CX - ROW_W / 2 - 8, top - 8, ROW_W + 16, rows.length * ROW_H + 12)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row === undefined) {
        continue
      }
      renderDetailRow(fb, row, rowRect(mode, i), i === menu.cursor, menu, settings)
    }
  } else {
    // Pure action screens delegate to the shared centred-list widget.
    const labels = rows.map(r => r.label)
    drawMenuList(fb, labels, menu.cursor, CX, listTop(mode), ROW_H)
  }

  renderFooter(fb, mode)
}

// ─────────────────────────────────────────────────────────────────────────────
// Input handling
// ─────────────────────────────────────────────────────────────────────────────

/** Emits the set* action for a slider row given a step direction (-1/+1). */
function adjustSlider(row: MenuRow, settings: Settings, dir: number): MenuAction {
  switch (row.label) {
    case 'MASTER':
      return { type: 'setMasterVolume', value: clamp01(settings.masterVolume + dir * SLIDER_STEP) }
    case 'SFX':
      return { type: 'setSfxVolume', value: clamp01(settings.sfxVolume + dir * SLIDER_STEP) }
    case 'MUSIC':
      return { type: 'setMusicVolume', value: clamp01(settings.musicVolume + dir * SLIDER_STEP) }
    case 'SENSITIVITY': {
      const frac = sensitivityToFraction(settings.mouseSensitivity) + dir * SLIDER_STEP
      return { type: 'setSensitivity', value: fractionToSensitivity(frac) }
    }
    default:
      return { type: 'none' }
  }
}

/** The set* action for a slider given an absolute 0..1 fraction (mouse seek). */
function sliderActionFromFraction(row: MenuRow, frac: number): MenuAction {
  const f = clamp01(frac)
  switch (row.label) {
    case 'MASTER':
      return { type: 'setMasterVolume', value: f * MAX_VOLUME }
    case 'SFX':
      return { type: 'setSfxVolume', value: f * MAX_VOLUME }
    case 'MUSIC':
      return { type: 'setMusicVolume', value: f * MAX_VOLUME }
    case 'SENSITIVITY':
      return { type: 'setSensitivity', value: fractionToSensitivity(f) }
    default:
      return { type: 'none' }
  }
}

/** Map a click on a slider row to the 0..1 track position and emit the matching set* action. */
function sliderClickAction(
  mode: GameMode,
  index: number,
  row: MenuRow,
  input: InputFrame,
  settings: Settings,
): MenuAction {
  const rect = rowRect(mode, index)
  // The track spans the row's left edge for SLIDER_W px (see widgets.drawSlider).
  const frac = SLIDER_W > 0 ? (input.pointerX - rect.x) / SLIDER_W : 0
  // Out-of-track horizontally (e.g. on the numeric readout): fall back to a +1 nudge.
  if (input.pointerX < rect.x || input.pointerX > rect.x + SLIDER_W) {
    return adjustSlider(row, settings, 1)
  }
  return sliderActionFromFraction(row, frac)
}

/** Confirm/activate the row at the cursor: rebind capture, toggle, slider nudge or its action. */
function activateRow(
  mode: GameMode,
  row: MenuRow,
  menu: MenuState,
  settings: Settings,
): MenuAction {
  switch (row.kind) {
    case 'binding':
      if (row.binding !== undefined) {
        menu.rebinding = row.binding
      }
      return { type: 'none' }
    case 'toggle':
      return { type: 'toggleMouseLook' }
    case 'slider':
      return adjustSlider(row, settings, 1)
    default:
      // The BACK row on options/controls must honour menu.returnTo, exactly like Escape.
      if ((mode === 'options' || mode === 'controls') && row.onConfirm?.type === 'goto') {
        return backAction(mode, menu)
      }
      return row.onConfirm ?? { type: 'none' }
  }
}

function clampCursor(menu: MenuState, count: number): void {
  if (menu.cursor < 0) {
    menu.cursor = 0
  } else if (menu.cursor >= count) {
    menu.cursor = count - 1
  }
}

/** Find the row whose rect contains the pointer, or -1. */
function rowUnderPointer(mode: GameMode, input: InputFrame, count: number): number {
  for (let i = 0; i < count; i++) {
    const r = rowRect(mode, i)
    if (pointInRect(input.pointerX, input.pointerY, r.x, r.y, r.w, r.h)) {
      return i
    }
  }
  return -1
}

/** The Escape/back behaviour per screen. */
function backAction(mode: GameMode, menu: MenuState): MenuAction {
  switch (mode) {
    case 'options':
    case 'controls':
      // Return to whichever screen opened us (pause vs main menu); default to main.
      return { type: 'goto', screen: menu.returnTo ?? 'menu' }
    case 'paused':
      return { type: 'resume' }
    case 'dead':
    case 'levelComplete':
    case 'victory':
      return { type: 'quitToMenu' }
    default:
      return { type: 'none' }
  }
}

/**
 * Handles BOTH keyboard navigation (NavEdge up/down/confirm/back, left/right on sliders) and
 * the mouse (hover sets cursor, click activates). Mutates `menu.cursor`/`menu.rebinding` and
 * returns the MenuAction the engine should apply. While `menu.rebinding` is set the engine is
 * capturing the next physical key, so navigation is suspended until it clears (Escape cancels).
 */
export function updateMenu(
  mode: GameMode,
  menu: MenuState,
  input: InputFrame,
  settings: Settings,
): MenuAction {
  const rows = rowsFor(mode, settings)
  const count = rows.length
  if (count === 0) {
    menu.rebinding = null
    return { type: 'none' }
  }

  // While capturing a rebind, suspend nav; the engine reads menu.rebinding to grab the next
  // raw key. Escape cancels the capture.
  if (menu.rebinding !== null) {
    if (input.nav.back) {
      menu.rebinding = null
    }
    return { type: 'none' }
  }

  clampCursor(menu, count)

  // Mouse hover updates the cursor; a click activates the hovered row.
  const hovered = rowUnderPointer(mode, input, count)
  if (hovered >= 0) {
    menu.cursor = hovered
    if (input.pointerDown) {
      const row = rows[hovered]
      if (row !== undefined) {
        // Clicking a slider seeks to the clicked position; everything else activates.
        if (row.kind === 'slider') {
          return sliderClickAction(mode, hovered, row, input, settings)
        }
        return activateRow(mode, row, menu, settings)
      }
    }
  }

  // Keyboard navigation (wrap-around).
  if (input.nav.up) {
    menu.cursor = (menu.cursor - 1 + count) % count
  }
  if (input.nav.down) {
    menu.cursor = (menu.cursor + 1) % count
  }
  clampCursor(menu, count)

  const current = rows[menu.cursor]
  if (current === undefined) {
    return { type: 'none' }
  }

  if (input.nav.left && current.kind === 'slider') {
    return adjustSlider(current, settings, -1)
  }
  if (input.nav.right && current.kind === 'slider') {
    return adjustSlider(current, settings, 1)
  }
  if (input.nav.confirm) {
    return activateRow(mode, current, menu, settings)
  }
  if (input.nav.back) {
    return backAction(mode, menu)
  }

  return { type: 'none' }
}
