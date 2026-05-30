# Doom-WebGL engine — build contract

This is the single source of truth for the parallel build. **Every module's public API, its
allowed imports, and the global rules are fixed here.** Implement exactly these signatures so the
pieces link without integration drift. `config.ts` and `types.ts` already exist — read them; do
not redefine anything they export.

Renderer model: the whole engine draws into one RGBA `Framebuffer` (a `Uint8ClampedArray`). A thin
presenter (`engine/present.ts`) is the ONLY code touching WebGL2/Canvas2D. Everything else is pure
TS operating on typed arrays, so it is unit-testable under jsdom.

---

## 0. Global rules (non-negotiable — the gates fail otherwise)

- **No `any`. No non-null assertion `!`.** Both are ESLint warnings and `--max-warnings 0` fails the build.
- **`import type { ... }`** for every type-only import (`verbatimModuleSyntax`). Mixed value/type imports must split.
- **`??` not `||`** for defaulting; use optional chaining `?.`.
- Biome formatting: **2-space indent, single quotes, NO semicolons, trailing commas `all`, arrow
  parens omitted for a single param, line ≤ 100 cols.** Run `bun run biome:fix` mentally.
- Names: interfaces / type aliases / classes PascalCase. Prefer **string-literal unions over enums**.
- **`noUncheckedIndexedAccess` is on.** Indexing arrays/`Record`/tuples yields `T | undefined`.
  - Guard or default: `const row = grid[y] ?? 0`. Store maps as **flat typed arrays** with accessor
    functions that bounds-check and return a default.
  - **Typed-array element READS are still `number | undefined` under this TS version** — guard with
    `?? 0` (see `engine/framebuffer.ts`), or read bytes via `DataView.getUint8/16/32` (returns
    `number`). Writing to a typed-array index is fine. (Earlier drafts of this note were wrong.)
  - Non-empty tuple types make element 0 non-optional: `readonly [T, ...T[]]` ⇒ `items[0]: T`.
- **No import cycles** (`noImportCycles` is an error). Obey the per-module "may import" lists below.
  Layering: `config`/`types` ← `core` ← `engine/*` (draw + render) ← `game/*` ← `ui/*` ← `engine.ts`
  ← `DoomGame.tsx`. `audio/*` is an independent column. Never import `engine.ts` from a leaf.
- **No unused vars/params** — prefix deliberately-unused params with `_`.
- **No `Math.random()` / `Date.now()` for procedural content** — thread the seeded `Rng` from
  `core/rng.ts` so texture/audio output is deterministic and testable.
- **Headless/jsdom safety:** no module may throw at import or construction when WebGL/AudioContext/
  `requestAnimationFrame` are absent. Guard with `typeof`, return early, degrade to no-op.
- **DRY (jscpd threshold 0.1%):** never copy a ≥5-line block. Factor shared logic into
  `core/*`, `engine/noise.ts`, `engine/framebuffer.ts` primitives, and `ui/widgets.ts`.

Path alias: `~` → `src`. Import siblings as `~/doom/core/vec`, etc.

---

## 1. `core/` — pure leaves (may import: `~/doom/types`, `~/doom/config`, sibling `core/*`)

### `core/vec.ts` (imports: types)
```ts
export function vec(x: number, y: number): Vec2
export function add(a: Vec2, b: Vec2): Vec2
export function sub(a: Vec2, b: Vec2): Vec2
export function scale(a: Vec2, s: number): Vec2
export function dot(a: Vec2, b: Vec2): number
export function length(a: Vec2): number
export function dist(a: Vec2, b: Vec2): number
export function normalize(a: Vec2): Vec2            // returns {0,0} for a zero vector
export function rotate(a: Vec2, radians: number): Vec2
export function fromAngle(radians: number, len?: number): Vec2  // len default 1
export function clone(a: Vec2): Vec2
```

### `core/math.ts` (imports: none)
```ts
export function clamp(v: number, min: number, max: number): number
export function lerp(a: number, b: number, t: number): number
export function normalizeAngle(a: number): number   // wrap to (-PI, PI]
export function angleDiff(a: number, b: number): number  // shortest signed a→b
export function sign(v: number): number
export function approach(current: number, target: number, maxDelta: number): number
```

### `core/rng.ts` (imports: types)
```ts
export function mulberry32(seed: number): Rng        // deterministic, period-OK PRNG
export function randRange(rng: Rng, min: number, max: number): number
export function randInt(rng: Rng, min: number, max: number): number   // inclusive
export function chance(rng: Rng, p: number): boolean
export function pick<T>(rng: Rng, items: readonly [T, ...T[]]): T      // non-empty tuple
```

### `core/color.ts` (imports: config, types, core/math)
```ts
export type Rgb = readonly [number, number, number]
export function rgb(r: number, g: number, b: number): Rgb
export function pal(name: PaletteName): Rgb          // PALETTE[name]
export function shade(c: Rgb, intensity: number): Rgb   // multiply, clamp 0..1
export function mix(a: Rgb, b: Rgb, t: number): Rgb
export function fogIntensity(distance: number): number  // 1 near → MIN_SHADE at/after FOG_DISTANCE
export function packShade(c: Rgb, intensity: number): readonly [number, number, number]  // shaded bytes
```

---

## 2. `engine/` draw + assets layer

### `engine/noise.ts` (imports: none) — shared procedural-pattern math (keeps textures DRY)
```ts
export function hash2(x: number, y: number, seed: number): number      // deterministic [0,1)
export function valueNoise(x: number, y: number, seed: number): number // smoothed [0,1)
export function fbm(x: number, y: number, seed: number, octaves: number): number // [0,1)
```

### `engine/font.ts` (imports: none) — procedural bitmap font DATA only (no drawing here)
```ts
export const GLYPH_W: number   // 5
export const GLYPH_H: number   // 7
export const GLYPH_SPACING: number  // 1
// GLYPH_H rows; each row is a bitmask, bit (GLYPH_W-1) is leftmost pixel. Unknown char → blank.
export function glyphRows(ch: string): readonly number[]
export function textWidth(text: string, scale: number): number  // includes spacing, uppercased
```
Cover A–Z, 0–9, space, and `.:!?-/%()+,'`. `glyphRows` uppercases input.

### `engine/texture.ts` (imports: types, core/color) — Texture create/write helpers
```ts
export function createTexture(width: number, height: number): Texture  // zeroed (transparent)
export function setTexel(tex: Texture, x: number, y: number, c: Rgb, alpha?: number): void  // alpha def 255
export function fillTexture(tex: Texture, c: Rgb, alpha?: number): void
export function texelOffset(tex: Texture, x: number, y: number): number  // (y*width+x)*4, no bounds check (caller in-range)
```

### `engine/framebuffer.ts` (imports: types, config, core/color, engine/font) — THE shared draw core
```ts
export function createFramebuffer(width: number, height: number): Framebuffer
export function clear(fb: Framebuffer, c: Rgb): void
export function setPixel(fb: Framebuffer, x: number, y: number, c: Rgb, alpha?: number): void  // bounds-checked, alpha-blended
export function fillRect(fb: Framebuffer, x: number, y: number, w: number, h: number, c: Rgb, alpha?: number): void
export function drawRect(fb: Framebuffer, x: number, y: number, w: number, h: number, c: Rgb): void  // 1px outline
export function drawLine(fb: Framebuffer, x0: number, y0: number, x1: number, y1: number, c: Rgb): void
export function drawText(fb: Framebuffer, text: string, x: number, y: number, c: Rgb, scale?: number): void  // scale def 1
export function drawTextCentered(fb: Framebuffer, text: string, cx: number, y: number, c: Rgb, scale?: number): void
export function blitTexture(fb: Framebuffer, tex: Texture, dx: number, dy: number, scale?: number): void  // integer scale, alpha-tested
// Vertical textured strip — the shared primitive for BOTH walls and sprites:
//   sx           screen column
//   [drawStart,drawEnd]  clipped visible y-range
//   spanTop, spanHeight  the UNCLIPPED projected span (used to map screen-y → texture-v)
//   texX         texture column already chosen
//   intensity    shade multiplier 0..1
//   alphaTest    true → skip texels with alpha 0 (sprites); false → opaque (walls)
export function paintColumn(
  fb: Framebuffer, sx: number, drawStart: number, drawEnd: number,
  spanTop: number, spanHeight: number, tex: Texture, texX: number,
  intensity: number, alphaTest: boolean,
): void
```

### `engine/textures.ts` (imports: types, config, core/rng, core/color, engine/noise, engine/texture)
```ts
export function createAssets(seed: number): Assets
```
Builds everything deterministically from `mulberry32(seed)`. Index agreement (MUST match `game/map.ts`):
- `wall[0]` placeholder; `wall[1]` brick; `wall[2]` metal/steel; `wall[3]` tech panel;
  `wall[4]` door (vertical seam + tech); `wall[5]` exit switch (glowing); `wall[6]` secret (looks like brick);
  `wall[7]` red door; `wall[8]` blue door; `wall[9]` yellow door. (length ≥ 10)
- `flat[0]` stone floor; `flat[1]` metal floor; `flat[2]` dark ceiling; `flat[3]` tech ceiling. (length ≥ 4)
- `enemy.grunt/imp/demon` each: `walk[≥2]`, `attack[≥1]`, `hurt[≥1]`, `die[≥3]` (last = corpse).
- `weapon.fist/pistol/shotgun/chaingun`: `idle` + `fire[≥2]` (first-person, anchored bottom-centre, transparent bg).
- `pickup[kind]` one icon each (transparent bg). `projectile.fireball` `[≥2]` frames.
Factor brick/panel/flat generation through `noise.ts` + small private helpers — do NOT repeat loops.

### `engine/raycaster.ts` (imports: types, config, core/{vec,math,color}, engine/framebuffer)
```ts
// Renders floor+ceiling (floorcast) then textured, distance-shaded walls into the viewport
// [0,VIEW_W)×[0,VIEW_H); writes per-column wall depth. Door cells slide up by doorOpennessAt.
export function renderWorld(
  fb: Framebuffer, scene: SceneQuery, camera: Camera, assets: Assets, depth: DepthBuffer,
): void
```
Camera basis: `dir = fromAngle(camera.angle)`, `plane = rotate(dir, +PI/2) * CAMERA_PLANE_SCALE`.
Use `paintColumn` for walls. Shade = `fogIntensity(perpDist)` × (0.7 for y-sides else 1.0).

### `engine/sprites.ts` (imports: types, config, core/{vec,math,color}, engine/framebuffer)
```ts
// Billboards, far-to-near, depth-tested against the wall buffer. Anchored to the floor.
export function renderSprites(
  fb: Framebuffer, sprites: readonly SpriteInstance[], camera: Camera, depth: DepthBuffer,
): void
```

### `engine/present.ts` (imports: types, config) — the ONLY GL/2D code
```ts
export function createPresenter(canvas: HTMLCanvasElement): Presenter
// Tries WebGL2 (texture on a fullscreen quad, NEAREST filter) → Canvas2D (offscreen putImageData +
// drawImage, imageSmoothingEnabled=false) → a NullPresenter with ready=false. Never throws.
export function computeViewport(
  clientW: number, clientH: number, bufW: number, bufH: number,
): ViewportTransform   // letterboxed, preserves aspect; shared by all presenter variants
```

### `engine/input.ts` (imports: types) — keyboard + mouse, no engine deps
```ts
export class InputManager {
  constructor(bindings: KeyBindings)
  attach(canvas: HTMLCanvasElement): void   // window keydown/up + canvas mouse/pointer-lock listeners
  detach(): void
  setBindings(bindings: KeyBindings): void
  setViewport(v: ViewportTransform): void   // to map client → buffer pointer coords
  requestPointerLock(): void
  poll(): InputFrame                        // snapshot; consumes edges + mouseDX + weaponSlot + pointerDown
}
```
Movement keys come from bindings; weapon slots are `Digit1..Digit4`; menu nav from Arrows/WASD +
Enter/Escape. Track held keys in a `Set<string>`; compute edges by diffing against last poll.

### `engine/loop.ts` (imports: config)
```ts
export class GameLoop {
  constructor(update: (dt: number) => void, render: () => void)  // update called with fixed TIMESTEP
  start(): void   // no-op if requestAnimationFrame is undefined (jsdom)
  stop(): void
  get running(): boolean
}
```
Fixed-timestep accumulator; clamp frame delta to `MAX_FRAME_TIME`. Use `performance.now()` (guard `typeof`).

---

## 3. `game/` — simulation (no `ui/`, no `engine.ts`; rendering-engine imports limited as noted)

### `game/map.ts` (imports: types, config, core/vec)
```ts
export const TILE_DEFS: readonly TileDef[]            // indexed by tile id 0..9 (see table)
export function tileDef(id: number): TileDef          // guarded → empty-floor def for unknown
export function compileLevel(src: LevelSource): Level // parse ASCII rows → tiles + spawns + player start
export function tileAt(level: Level, tx: number, ty: number): number  // guarded → 0
export function cellIndex(width: number, tx: number, ty: number): number
```
**Tile ids ↔ chars ↔ TileDef** (keep in sync with textures wall indices):
| id | char | meaning | solid | wallTexture | door | locked | exit | secret |
|----|------|---------|-------|-------------|------|--------|------|--------|
| 0 | ` ` `.` | floor/empty | f | -1 | f | null | f | f |
| 1 | `#` | brick wall | t | 1 | f | null | f | f |
| 2 | `=` | metal wall | t | 2 | f | null | f | f |
| 3 | `%` | tech wall | t | 3 | f | null | f | f |
| 4 | `D` | door | t* | 4 | t | null | f | f |
| 5 | `X` | exit switch | t | 5 | f | null | t | f |
| 6 | `*` | secret wall | t | 6 | f | null | f | t |
| 7 | `R` | red door | t* | 7 | t | red | f | f |
| 8 | `B` | blue door | t* | 8 | t | blue | f | f |
| 9 | `Y` | yellow door | t* | 9 | t | yellow | f | f |

`t*` = solid only while closed (the live World flips it via door openness).
**Spawn chars** (the cell itself becomes floor id 0): `@` player start (angle from `LevelSource.playerAngle`);
`g` grunt, `i` imp, `d` demon; pickups `h` health, `a` armor, `m` medkit, `b` bullets, `s` shells,
`G` shotgun, `C` chaingun, `r` red key, `u` blue key, `y` yellow key. Spawn position = cell centre `(tx+0.5, ty+0.5)`.

### `game/levels.ts` (imports: types) — data only
```ts
export const LEVELS: readonly LevelSource[]   // 3 hand-authored levels; rows are equal-length strings
```
Each level: enclosed by walls, a clear path to an `X` exit, mix of brick/metal/tech, ≥1 door, ≥1
locked door + matching key, ≥1 secret (`*`) hiding a pickup, a spread of enemies + pickups. Keep maps
~24–40 wide. Level 3 ends the game (engine shows victory).

### `game/collision.ts` (imports: types, config, core/{vec,math})
```ts
export function isBlocked(scene: SceneQuery, pos: Vec2, radius: number): boolean
export function moveWithCollision(scene: SceneQuery, pos: Vec2, delta: Vec2, radius: number): Vec2
// axis-separated slide: try x then y so the player slides along walls
```

### `game/player.ts` (imports: types, config, core/{vec,math}, game/collision)
```ts
export function createPlayer(start: Vec2, angle: number): Player   // fist+pistol, 50 bullets, full health
export function updatePlayerMovement(player: Player, scene: SceneQuery, input: InputFrame, settings: Settings, dt: number): void
export function damagePlayer(player: Player, amount: number): void  // armor absorbs 1/3, min 0
export function addHealth(player: Player, amount: number, max: number): void
export function addArmor(player: Player, amount: number): void
export function giveAmmo(player: Player, kind: AmmoKind, amount: number): void
export function giveWeapon(player: Player, kind: WeaponKind): boolean  // true if newly owned
export function giveKey(player: Player, key: KeyKind): void
export function requestWeapon(player: Player, kind: WeaponKind): void  // begins switch if owned & different
export function setMessage(player: Player, text: string): void
export function tickPlayerTimers(player: Player, dt: number): void   // decay flashes + message timer
```
**Must NOT import `game/weapon.ts`** (slot→kind mapping is done by the caller). Turn = keyboard
`turnAxis*TURN_SPEED*dt` + (settings.mouseLook ? `input.mouseDX*settings.mouseSensitivity` : 0).

### `game/combat.ts` (imports: types, config, core/{vec,math}) — pure, no entity-module imports
```ts
export function lineOfSight(scene: SceneQuery, from: Vec2, to: Vec2): boolean   // false if a solid blocks
export function hitscan(scene: SceneQuery, enemies: readonly Enemy[], origin: Vec2, angle: number, range: number): HitscanResult
```
Use `ENEMY_HIT_RADIUS`; ignore dead enemies; nearest enemy hit must be closer than the wall.

### `game/projectile.ts` (imports: types, config, core/{vec,math}, game/{collision,player})
```ts
export function spawnProjectile(kind: ProjectileKind, pos: Vec2, dir: Vec2, damage: number, fromEnemy: boolean): Projectile
export function updateProjectile(proj: Projectile, player: Player, scene: SceneQuery, dt: number): void
// move by vel*dt; if cell solid → dead; if within PROJECTILE_RADIUS of player (and fromEnemy) → damagePlayer + dead
export function projectileFrame(proj: Projectile, assets: Assets): Texture
```

### `game/enemy.ts` (imports: types, config, core/{vec,math,rng}, game/{combat,collision,player,projectile})
```ts
export const ENEMY_DEFS: Readonly<Record<EnemyKind, EnemyDef>>
export function enemyDef(kind: EnemyKind): EnemyDef
export function spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy
export function updateEnemy(enemy: Enemy, player: Player, scene: SceneQuery, projectiles: Projectile[], rng: Rng, dt: number): void
export function damageEnemy(enemy: Enemy, amount: number, rng: Rng): void   // → hurt (painChance) or dying
export function enemyFrame(enemy: Enemy, assets: Assets): Texture           // pick frame from state+animTimer
```
AI: if dead → corpse frame; dying/hurt → run timer then resume; else if `lineOfSight` to player:
face + `moveWithCollision` toward player at def.speed; within `attackRange` & `attackTimer≤0` →
attack (ranged: `spawnProjectile` pushed to `projectiles`; melee: `damagePlayer`), reset cooldown.
grunt = fast melee/close, imp = ranged fireball, demon = tanky fast melee.

### `game/weapon.ts` (imports: types, config, core/{vec,math,rng}, game/{combat,enemy,player})
```ts
export const WEAPONS: Readonly<Record<WeaponKind, WeaponDef>>
export function weaponDef(kind: WeaponKind): WeaponDef
export function weaponBySlot(slot: number): WeaponKind | null
export function updateWeapon(player: Player, dt: number): void   // advance switch/fire animation, return to ready
export interface FireOutcome { readonly fired: boolean; readonly soundKind: WeaponKind | null; readonly hitEnemy: boolean }
export function tryFire(player: Player, scene: SceneQuery, enemies: Enemy[], rng: Rng): FireOutcome
// ready + ammo → consume ammo, set firing, run def.pellets × hitscan(spread) → damageEnemy on hits
```

### `game/pickup.ts` (imports: types, config, game/player)
```ts
export function spawnPickup(kind: PickupKind, x: number, y: number): Pickup
export interface PickupResult { readonly taken: boolean; readonly message: string }
export function applyPickup(player: Player, kind: PickupKind): PickupResult
// only "taken" when useful (health<max, weapon not owned, ammo<max, key not held); applies via player mutators
```

### `game/state.ts` (imports: types, config) — settings persistence + factories
```ts
export function defaultBindings(): KeyBindings
export function defaultSettings(): Settings
export function loadSettings(): Settings   // localStorage guarded, merged over defaults
export function saveSettings(settings: Settings): void  // guarded; never throws
```

### `game/world.ts` (imports: types, config, core/*, game/{map,player,enemy,projectile,weapon,pickup,combat})
```ts
export interface WorldEvents {
  readonly fired: WeaponKind | null
  readonly doorOpened: boolean
  readonly enemyHurt: boolean
  readonly enemyDied: boolean
  readonly playerHurt: boolean
  readonly pickedUp: boolean
  readonly playerDead: boolean
  readonly reachedExit: boolean
}
export interface WorldStats { readonly kills: number; readonly totalEnemies: number; readonly level: string }
export class World implements SceneQuery {
  constructor(level: Level, assets: Assets, rng: Rng)
  readonly width: number; readonly height: number; readonly floorFlat: number; readonly ceilingFlat: number
  tileAt(tx: number, ty: number): number
  isSolid(tx: number, ty: number): boolean          // open doors not solid
  wallTextureAt(tx: number, ty: number): number
  doorOpennessAt(tx: number, ty: number): number
  get player(): Player
  get camera(): Camera                               // {pos: player.pos, angle: player.angle}
  get stats(): WorldStats
  update(input: InputFrame, dt: number): WorldEvents // drives player, weapon, enemies, projectiles, doors, pickups, exit
  buildSprites(): SpriteInstance[]                   // enemies (incl. corpses) + projectiles + active pickups
}
```
Owns `Float32Array` door openness + per-door timers keyed by `cellIndex`. `update` order: player
movement → use(doors) → weapon (switch/fire via input) → enemies → projectiles → door animation →
pickups (proximity) → exit (player on exit tile). A door opens on `use` within `USE_RANGE` if the
required key is held (else a "need the X key" message).

---

## 4. `ui/` — canvas UI (imports: types, config, core/color, engine/framebuffer; menu/hud also ui/widgets)

### `ui/widgets.ts` — shared widgets (kills menu/hud duplication)
```ts
export function drawPanel(fb: Framebuffer, x: number, y: number, w: number, h: number): void
export function drawBar(fb: Framebuffer, x: number, y: number, w: number, h: number, fill: number, fg: Rgb, bg: Rgb): void
export function drawSlider(fb: Framebuffer, label: string, value: number, x: number, y: number, w: number, selected: boolean): void
export function drawMenuList(fb: Framebuffer, items: readonly string[], cursor: number, cx: number, y: number, lineH: number): void
export function drawTitle(fb: Framebuffer, text: string, cx: number, y: number): void   // big red scaled title
export function pointInRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean
```

### `ui/menu.ts`
```ts
export function renderMenu(fb: Framebuffer, mode: GameMode, menu: MenuState, settings: Settings, stats: WorldStats | null): void
export function updateMenu(mode: GameMode, menu: MenuState, input: InputFrame, settings: Settings): MenuAction
```
Screens: `menu` (NEW GAME / OPTIONS / CONTROLS / QUIT), `options` (master/sfx/music sliders,
sensitivity slider, mouse-look toggle, BACK), `controls` (binding rows — Enter to rebind, captures
next key via `menu.rebinding`; BACK), `paused` (RESUME / OPTIONS / QUIT TO MENU), `dead` (YOU DIED —
RETRY / QUIT TO MENU), `levelComplete` (stats + CONTINUE), `victory` (credits + back to menu).
Support BOTH keyboard nav and mouse hover/click (`pointInRect` + `input.pointerX/Y/pointerDown`).
Left/right on a slider row emits the matching `set*` action.

### `ui/hud.ts`
```ts
export function renderHud(fb: Framebuffer, player: Player, stats: WorldStats): void  // bottom bar: HEALTH/ARMOR/AMMO/keys/message
export function renderWeaponSprite(fb: Framebuffer, player: Player, assets: Assets): void  // first-person gun, bob + fire frame
export function renderFlash(fb: Framebuffer, player: Player): void  // red damage / gold pickup full-screen tint
```

---

## 5. Top integration

### `audio/audio.ts` (imports: types, config)
```ts
export class AudioEngine {
  constructor(settings: Settings)
  get ready(): boolean
  get context(): AudioContext | null        // null under jsdom
  get sfxBus(): GainNode | null
  get musicBus(): GainNode | null
  resume(): void                             // void a promise; call on first user gesture
  setVolumes(settings: Settings): void
  dispose(): void
}
```
Guard `typeof AudioContext` and `webkitAudioContext`. All getters null when unavailable; nothing throws.

### `audio/sfx.ts` (imports: types, config, audio/audio)
```ts
export type SfxName = 'pistol' | 'shotgun' | 'chaingun' | 'fist' | 'door' | 'groan' | 'hurt'
  | 'pickup' | 'menuMove' | 'menuSelect' | 'enemyDie' | 'noAmmo'
export function playSfx(audio: AudioEngine, name: SfxName): void   // no-op if !audio.ready
```
Shared private helpers: a cached noise `AudioBuffer`, an ADSR gain helper. Synthesize per name
(noise burst + lowpass for guns, filtered sweep for door, detuned osc + noise for groan, blips for menu).

### `audio/music.ts` (imports: types, config, audio/audio)
```ts
export type MusicTrack = 'menu' | 'combat'
export class MusicPlayer {
  constructor(audio: AudioEngine)
  play(track: MusicTrack): void   // lookahead-scheduled loop (bass + arpeggio); no-op if !ready
  stop(): void
  dispose(): void
}
```

### `engine.ts` — orchestrator (imports: config, types, core/*, engine/*, game/*, ui/*, audio/*)
```ts
export class DoomEngine {
  constructor(canvas: HTMLCanvasElement)   // build presenter, framebuffer, depth, input, audio, assets, load settings, mode='menu'
  start(): void   // if !presenter.ready → log + idle (jsdom). Else attach input, start loop, play menu music
  stop(): void    // idempotent full teardown: stop loop, detach input, dispose presenter + audio
  resize(clientWidth: number, clientHeight: number): void
}
```
Owns `mode: GameMode`, `MenuState`, `levelIndex`, `world: World | null`. `tick(dt)`: poll input; if a
playing-family mode → `world.update` then map `WorldEvents` to sfx + mode changes (dead/exit→next or
victory); else → `updateMenu` and apply `MenuAction` (newGame builds world from `LEVELS[0]`, goto
changes mode, set* mutates settings + `saveSettings` + audio.setVolumes, quit→menu/credits). `frame()`:
playing → `renderWorld`+`renderSprites`+`renderWeaponSprite`+`renderHud`+`renderFlash`; paused draws
the world then the pause menu over it; menu-family → `renderMenu`; then `presenter.present(fb)`.
First user gesture (key/click) calls `audio.resume()`. Clicking the canvas while playing requests pointer lock.

### `DoomGame.tsx` (imports: react, ~/doom/engine)
```tsx
export function DoomGame(): JSX.Element
```
`useRef<HTMLCanvasElement>` + `useEffect([])`: create `DoomEngine(canvas)`, size canvas to client
(×devicePixelRatio, capped), `engine.resize`, `window` resize listener, `engine.start()`; cleanup
removes listener + `engine.stop()` (StrictMode-safe — must be idempotent). Canvas styled fullscreen
inline (styling the host element is allowed; game UI stays on the canvas). No other DOM.

---

## 6. Tests (`tests/doom/*.test.ts` Vitest, `tests/e2e/*.spec.ts` Playwright)

Unit (pure, jsdom): `vec`, `math`, `rng` (determinism: same seed → same sequence), `color`,
`noise` (determinism), `framebuffer` (assert written pixels / `paintColumn` bounds), `font`
(known glyph + `textWidth`), `textures` (createAssets(seed) reproducible — hash data), `map`
(`compileLevel` tiles + spawns + player start), `collision` (slide against a stub `SceneQuery`),
`combat` (`lineOfSight` + `hitscan` nearest-enemy selection), `enemy` (chase reduces distance; dies
at 0 hp), `weapon` (`tryFire` consumes ammo, shotgun = N pellets, no-fire when empty), `world`
(spawn → fire kills enemy; walking onto a pickup grabs it; exit tile sets reachedExit), `state`
(defaults + load/save round-trip with a localStorage stub).

E2E (`tests/e2e/{smoke,gameplay}.spec.ts`, prod preview): canvas present & sized; **no console
errors**; pixels non-blank; menu→New Game (Enter) changes the frame; `KeyW`/`ArrowLeft`/`Space`
move/turn/fire and the frame keeps changing; screenshots at menu + in-game. Use keyboard only
(pointer lock is unavailable headless). Sample pixels via `canvas.toDataURL()` or a readback.

---

## 7. Sprite atlas pipeline (real Doom art)

Art is **transcoded offline** from Freedoom (`assets/freedoom2.wad`, BSD, gitignored) into a
committed atlas, and consumed at runtime with a procedural fallback. **ART is generated;
BEHAVIOUR is hand-authored** from `doomBehaviorSpec.md` — regenerating the atlas never touches
gameplay numbers.

### Build time — `scripts/wad/*` + `scripts/build-sprites.ts` (run with **bun**, NOT linted/tsc'd
by the app config; type-checked transitively via `tests/doom/sprites/*`)
- `wad/readWad.ts` (WAD header+directory → `Lump[]`, `spriteLumps`), `wad/palette.ts` (PLAYPAL →
  256-RGB palette 0), `wad/decodePatch.ts` (Doom picture format → RGBA + Doom offsets),
  `wad/spriteIndex.ts` (group `NAME+frame+rot`, expand 8-char mirror pairs), `wad/packAtlas.ts`
  (bbox-crop + shelf-pack), `wad/encodePng.ts` (RGBA → PNG via `node:zlib`).
- `build-sprites.ts` orchestrates → `public/sprites/{atlas.png, atlas.json, CREDITS.md}`.
  Deterministic: same WAD + code ⇒ byte-identical output. `bun run build:sprites`.

### Runtime — `engine/sprites/*` (engine layer; headless-safe)
- `atlasTypes.ts` — manifest type contract (zero-import leaf).
- `atlasLoader.ts` — `loadAtlas(url): Promise<SpriteAtlas | null>`; fetch JSON + decode PNG via
  `Image`→canvas→`ImageData`. Returns `null` (never throws) when `fetch`/`Image`/canvas absent.
- `spriteAtlas.ts` — `SpriteAtlas` lazily slices frames into `Texture`s; `actorFrame(name,letter,
  rot)→{tex,flip,ox,oy}`; pure `spriteRotation(angle, camX, camY, x, y)→1..8`.

### Render — `engine/sprites.ts`
`SpriteInstance` carries optional `flip / ox / oy / pxW / pxH` (Doom-offset anchoring + mirror) and
`bright / fuzz`. `renderSprites(fb, sprites, camera, depth, fullBright?)` shades each billboard by
`spriteIntensity(depth, bright, fullBright)` (= `fogIntensity` unless bright / light-amp visor) and
applies a deterministic `(sx+y)&1` fuzz dither for spectres. The legacy bottom-centre path is kept
for the procedural fallback (sprites with no `pxH`).

### Behaviour tables — `game/actorDefs.ts`
35 Hz state tables (`seq('A4 B4 C4 D4', true)` DSL) + `resolveActorFrame`. `game/prop.ts` is the
analogous render-only `PROP_DEFS` decor table. The atlas swaps into a live `World` via
`World.setSpriteAtlas`; `engine.ts` kicks off `loadAtlas` async and re-applies on `loadLevel`.

### Notable signature drift from the original contract
- `World` constructor is `(level, assets, rng, settings)`; `WorldEvents` includes `dryFired`.
- `updateEnemy(enemy, player, scene, projectiles, enemies, rng, dt)` — gained `enemies` for
  infighting target resolution. `updateProjectile(proj, scene, player, enemies, dt)` returns a
  `ProjectileImpact` (cycle-safe: it never imports `enemy.ts`; `world.ts` applies all damage/splash/
  spray). `weaponBySlot(slot, player)`; weapon slots are `Digit1..Digit7`.
- `EnemyDef` is archetype-driven (`melee|hitscan|projectile|charger|spawner|vile|inert`) with damage
  dice, `splashImmune`, `raisable`, `drop`, `flying`, `fuzz`. `EnemyKind` includes `barrel` (an
  inert, shootable, exploding "enemy").
