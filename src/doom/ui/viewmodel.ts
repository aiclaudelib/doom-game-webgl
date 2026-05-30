// Pure placement math for the first-person weapon viewmodel — kept framebuffer-free so it
// is unit-testable in isolation (the golden offset tests import straight from here).
//
// CRITICAL convention (weaponPlan §B3): weapon sprite ox/oy are FULL-320-SCREEN-RELATIVE
// NEGATIVES (the screen centre is already baked in by the Doom author). So the draw position
// is `x = bobX - ref.ox` — do NOT add 160/screenCenterX as the world-billboard path does
// (that would shove the gun off-screen). `pspSy` is the raise/lower slide (32 top..128 bottom);
// `bobX/bobY` are the only other render-space shifts. WEAPON_BASE_Y is the single free vertical
// constant, calibrated + pinned by golden test (see tests/doom/viewmodelDrawPos.test.ts).

import type { ActorFrameRef } from '~/doom/engine/sprites/spriteAtlas'
import type { WeaponState } from '~/doom/types'

/**
 * Vertical anchor (px). Calibrated so a fully-raised gun (pspSy = 32 = WEAPONTOP) rests at
 * the bottom of the 320×160 view: PISG/A (oy −97, h 92) bottoms exactly at y = 160
 * (−61 + 32 + 97 + 92 = 160). Larger pspSy slides the gun lower (raise/lower travel).
 * PINNED by golden test — do not retune without updating tests/doom/viewmodelDrawPos.test.ts.
 */
export const WEAPON_BASE_Y = -61

/** Frame letter for a 0-based frame index: 0→'A', 1→'B', … (Doom S_* sprite letters). */
export function letterOf(frame: number): string {
  return String.fromCharCode(65 + frame)
}

/** Peak view-bob excursion in screen px (per axis); scaled by the 0..1 bob amplitude. */
export const BOB_AMP = 4

/**
 * Render-space view-bob (B5). A 90°-apart figure-eight — bobX ∝ cos, bobY ∝ |sin| — whose
 * amplitude is `BOB_AMP * bob`. SUPPRESSED to {0,0} whenever the gun is firing, raising or
 * lowering (recoil/travel own the gun then) or when `bob` has decayed to 0 (standing still).
 * Pure: deterministic in the player's bob fields, no clock.
 */
export function viewmodelBob(
  weaponState: WeaponState,
  bob: number,
  bobPhase: number,
): { x: number; y: number } {
  const settled =
    weaponState === 'firing' || weaponState === 'raising' || weaponState === 'lowering'
  if (settled || bob <= 0) {
    return { x: 0, y: 0 }
  }
  const amp = BOB_AMP * bob
  return { x: amp * Math.cos(bobPhase), y: amp * Math.abs(Math.sin(bobPhase)) }
}

/**
 * Screen-space top-left for a viewmodel frame. Horizontal is offset-driven (the negative ox
 * does the centring); vertical adds the calibrated base, the raise/lower slide, and the bob.
 * Gun + flash layers share this anchor so the muzzle flash stays glued to the barrel.
 */
export function viewmodelDrawPos(
  ref: ActorFrameRef,
  bobX: number,
  bobY: number,
  pspSy: number,
): { x: number; y: number } {
  return {
    x: Math.round(bobX - ref.ox),
    y: Math.round(WEAPON_BASE_Y + pspSy + bobY - ref.oy),
  }
}
