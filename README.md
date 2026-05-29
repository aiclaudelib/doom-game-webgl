# doom-game-webgl

A Doom-style pseudo-3D shooter rendered entirely in the browser. The engine is pure TypeScript
operating on typed-array framebuffers; a thin presenter blits the final RGBA buffer to the screen
via WebGL2 (with a Canvas2D fallback). React only hosts the canvas and the menu shell.

**▶ Play:** https://aiclaudelib.github.io/doom-game-webgl/

## Features

- **Raycasting renderer** — textured walls, floor/ceiling casting, depth-sorted billboard sprites.
- **Gameplay** — player movement & collision, hitscan/projectile combat, enemy AI, pickups,
  multiple levels, doors with a use key.
- **Audio** — procedural SFX and music synthesized at runtime (no audio assets shipped).
- **UI** — in-game HUD, main menu, and rebindable controls persisted to `localStorage`.
- **Strict toolchain** — TypeScript (`noUncheckedIndexedAccess`, no `any`), ESLint, Biome, Vitest,
  Playwright, and jscpd gate every change.

## Controls

| Action            | Key                          |
| ----------------- | ---------------------------- |
| Move forward/back | `W` / `S`                    |
| Strafe            | `A` / `D`                    |
| Turn              | `←` / `→` (or mouse look)    |
| Fire              | `Space` / left mouse button  |
| Use / open door   | `E`                          |
| Run               | `Shift`                      |
| Select weapon     | `1` – `4`                    |
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
