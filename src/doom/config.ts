// Central tunable constants for the Doom-style engine.
// Pure data with no imports — the dependency leaf every other module may safely read.

/** Internal render-buffer resolution. Authentic chunky pixels, scaled up by the presenter. */
export const RENDER_W = 320
export const RENDER_H = 200

/** Bottom status-bar height (render px). The 3D viewport fills the space above it. */
export const HUD_HEIGHT = 40
export const VIEW_W = RENDER_W
export const VIEW_H = RENDER_H - HUD_HEIGHT

/** Camera-plane scale relative to the unit direction vector. 0.66 ≈ 66° horizontal FOV. */
export const CAMERA_PLANE_SCALE = 0.66

/** Procedural texture / flat dimensions (square, power of two). */
export const TEXTURE_SIZE = 64

/** Movement tuning — world tiles per second, radians per second. */
export const MOVE_SPEED = 3.2
export const STRAFE_SPEED = 2.8
export const TURN_SPEED = 2.6
export const RUN_MULTIPLIER = 1.7
export const PLAYER_RADIUS = 0.22

/** Door animation. */
export const DOOR_SPEED = 1.8 // openness units (0..1) per second
export const DOOR_OPEN_TIME = 4 // seconds a door waits open before auto-closing
export const DOOR_PASSABLE_AT = 0.85 // openness above which a door stops blocking movement/sight

/** Player vitals. */
export const MAX_HEALTH = 100
export const MAX_ARMOR = 100

/** Interaction & combat radii / ranges (world tiles), and projectile speed (tiles/sec). */
export const ENEMY_HIT_RADIUS = 0.42 // generous hitscan radius around an enemy centre
export const PROJECTILE_RADIUS = 0.22
export const PICKUP_RADIUS = 0.5 // distance at which the player grabs a pickup
export const USE_RANGE = 1.25 // reach for opening doors with the use key
export const MELEE_RANGE = 1.1
export const PROJECTILE_SPEED = 4.5

/** Fixed-timestep simulation. */
export const TIMESTEP = 1 / 60
export const MAX_FRAME_TIME = 0.25 // clamp accumulated time to dodge the spiral-of-death

/** Default settings (0..1 volumes; sensitivity in radians per mouse pixel). */
export const DEFAULT_MASTER_VOLUME = 0.8
export const DEFAULT_SFX_VOLUME = 0.9
export const DEFAULT_MUSIC_VOLUME = 0.5
export const DEFAULT_MOUSE_SENSITIVITY = 0.0022

/** Distance shading: walls/floors fade toward darkness by FOG_DISTANCE tiles. */
export const FOG_DISTANCE = 9
export const MIN_SHADE = 0.18 // darkest multiplier so distant geometry never goes pure black

/** localStorage key for persisted settings + bindings. */
export const STORAGE_KEY = 'doom-webgl:settings'

/** RGB palette tuples reused by texture generators and UI for a cohesive retro look. */
export const PALETTE = {
  black: [8, 8, 12],
  darkGray: [40, 40, 48],
  gray: [96, 96, 104],
  lightGray: [168, 168, 176],
  white: [232, 228, 216],
  red: [188, 36, 28],
  darkRed: [96, 16, 12],
  brown: [104, 68, 40],
  darkBrown: [60, 38, 22],
  green: [64, 168, 56],
  darkGreen: [28, 92, 36],
  blue: [56, 96, 200],
  cyan: [72, 176, 192],
  yellow: [216, 188, 48],
  orange: [224, 120, 32],
  steel: [120, 128, 140],
  darkSteel: [64, 70, 80],
} as const

export type PaletteName = keyof typeof PALETTE
