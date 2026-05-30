// Single source of truth for the first-person weapon DRAWN frames the atlas must carry.
// Mirrors weaponPlan §1.2 — only the sprite frames the psprite tic engine actually draws
// (gun layer + muzzle-flash layer). Terminal S_LIGHTDONE frames (e.g. SHTG E) are never
// drawn, so they are intentionally absent. Both the build-time coverage gate
// (scripts/build-sprites.ts) and the runtime coverage test read this map, so a dropped
// letter fails loudly in exactly one place.

/** prefix → the frame letters that the renderer can resolve and blit. */
export const REQUIRED_VIEWMODEL_FRAMES: Readonly<Record<string, readonly string[]>> = {
  PUNG: ['A', 'B', 'C', 'D'],
  SAWG: ['A', 'B', 'C', 'D'],
  PISG: ['A', 'B', 'C'],
  PISF: ['A'],
  SHTG: ['A', 'B', 'C', 'D'], // NOT E — S_LIGHTDONE terminal, never drawn
  SHTF: ['A', 'B'],
  SHT2: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'], // I/J are the baked flash
  CHGG: ['A', 'B'],
  CHGF: ['A', 'B'],
  MISG: ['A', 'B'],
  MISF: ['A', 'B', 'C', 'D'],
  PLSG: ['A', 'B'],
  PLSF: ['A', 'B'],
  BFGG: ['A', 'B'],
  BFGF: ['A', 'B'],
}
