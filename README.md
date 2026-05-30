# doom-game-webgl

A Doom-style pseudo-3D shooter rendered entirely in the browser. The engine is pure TypeScript
operating on typed-array framebuffers; a thin presenter blits the final RGBA buffer to the screen
via WebGL2 (with a Canvas2D fallback). React only hosts the canvas and the menu shell.

**▶ Play:** https://aiclaudelib.github.io/doom-game-webgl/

## Features

- **Raycasting renderer** — textured walls, floor/ceiling casting, depth-sorted billboard sprites
  with distance shading, fullbright frames, and a fuzz shader for spectres.
- **Real Doom sprites** — monsters, weapons, projectiles, items and decor are transcoded from
  **Freedoom** (`freedoom2.wad`, BSD) into a single packed atlas at build time and rendered as
  **8-direction billboards** with authentic Doom anchor offsets. The engine degrades to the
  procedural art generator when the atlas is unavailable (offline / headless).
- **Full bestiary** — 17 Doom monsters (Zombieman → Cyberdemon & Spider Mastermind) with canonical
  HP, pain chances, attack dice and animation timings (35 Hz state tables), plus signature
  behaviours: Lost Soul charge, Revenant homing tracers, Mancubus fan, Pain Elemental skull-spawn,
  Arch-vile fire + corpse resurrection, monster infighting, and splash-immune bosses.
- **Full arsenal** — fist, chainsaw, pistol, shotgun, super shotgun, chaingun, rocket launcher,
  plasma rifle and BFG9000, with rockets/cells ammo, area-of-effect splash, the BFG 40-ray spray,
  and the berserk fist multiplier.
- **Items & props** — the full pickup/powerup set (spheres, armor, the six powerups with real-time
  timers, backpack, keys) and explosive barrels with chain detonation, amid Doom decor.
- **Audio** — procedural SFX and music synthesized at runtime (no audio assets shipped).
- **UI** — in-game HUD, main menu, and rebindable controls persisted to `localStorage`.
- **Strict toolchain** — TypeScript (`noUncheckedIndexedAccess`, no `any`), ESLint, Biome, Vitest,
  Playwright, and jscpd gate every change.

## Sprites

The committed sprite atlas (`public/sprites/atlas.png` + a typed `atlas.json` manifest) is generated
from Freedoom by `scripts/build-sprites.ts`. The raw `freedoom2.wad` is **not** committed (it is
re-downloadable; see `assets/`); only the compact generated atlas ships. To regenerate it:

```bash
bun run build:sprites          # decode the WAD → public/sprites/{atlas.png,atlas.json,CREDITS.md}
```

Art is supplied by Freedoom (BSD); gameplay numbers are derived from id Software's `info.c` and the
Doom Wiki — see [`doomBehaviorSpec.md`](doomBehaviorSpec.md) for the canonical behaviour spec and
[`spritePlan.md`](spritePlan.md) for the pipeline.

## Controls

| Action            | Key                          |
| ----------------- | ---------------------------- |
| Move forward/back | `W` / `S`                    |
| Strafe            | `A` / `D`                    |
| Turn              | `←` / `→` (or mouse look)    |
| Fire              | `Space` / left mouse button  |
| Use / open door   | `E`                          |
| Run               | `Shift`                      |
| Select weapon     | `1` – `7`                    |
| Confirm / menu    | `Enter` / `Esc`              |

Click the canvas to capture the pointer for mouse look. All keys are rebindable in the options menu.

## Getting started

Requires [Bun](https://bun.sh) (the repo ships `bun.lock`). npm works too if you prefer.

```bash
bun install
bun run dev          # dev server at http://localhost:5180
```

## Scripts

| Command            | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `bun run dev`      | Vite dev server (port 5180)                           |
| `bun run build`    | Type-check then production build → `dist/`            |
| `bun run preview`  | Serve the production build (port 4173)                |
| `bun run check`    | `tsc` + Biome + ESLint in one pass                    |
| `bun run test`     | Unit tests (Vitest, jsdom)                            |
| `bun run e2e`      | End-to-end tests (Playwright)                         |
| `bun run copies`   | Duplicate-code report (jscpd)                         |
| `bun run build:sprites` | Transcode Freedoom WAD → committed sprite atlas  |

## Deployment

The site is published to **GitHub Pages** from the `gh-pages` branch (built files only). To deploy
a new version:

```bash
bun run build
bunx gh-pages -d dist -t
```

`vite.config.ts` uses `base: './'`, so the build works unchanged under the
`/doom-game-webgl/` Pages sub-path.

> A GitHub Actions workflow (`.github/workflows/deploy.yml`) is also included for automatic
> deploys on push to `master`. It is currently disabled because the account's Actions are locked
> by a billing issue; re-enable it and switch the Pages source back to **GitHub Actions** once
> billing is resolved.

## Architecture

The full module contract — public APIs, allowed imports, and the renderer model — lives in
[`src/doom/ARCHITECTURE.md`](src/doom/ARCHITECTURE.md).

## License

MIT
