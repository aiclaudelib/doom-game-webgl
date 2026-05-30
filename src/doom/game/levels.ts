// Hand-authored level data. Pure data — the only export is LEVELS.
// Authoring chars (see game/map.ts): # brick, = metal, % tech walls; D door,
// R/B/Y locked doors; X exit; * secret wall. Spawns: @ player; enemies
// g grunt, S shotgunGuy, c chaingunner, i imp, d demon, p spectre, l lostSoul,
// k cacodemon, K hellKnight, n baron, f mancubus, A arachnotron, v revenant,
// Q explosive barrel (clustered near enemy groups for chain-detonation).
// Tier-2 bosses (non-ASCII glyphs — the ASCII set is full): ø painElemental,
// † archvile (placed by a monster cluster so it has corpses to raise), Δ cyberdemon
// (reactor finale), Ω spiderMastermind (open arena — its 2.0-cell radius needs room).
// Pickups: h health, a/e green armor, m medkit, b bullets, s shells, G shotgun,
// C chaingun, r/u/y key cards; H health bonus, N armor bonus, q blue armor,
// O soulsphere, M megasphere, z berserk, V invuln, U radsuit, L light visor,
// P area map, w blur, $ backpack, o/0 rockets, j/9 cells, 8 bullet box,
// 7 shell box, 2 super shotgun, 5 rocket launcher, 6 plasma, 4 BFG, W chainsaw,
// !/?/; red/blue/yellow skull keys. Decor props (render-only, non-colliding):
// T/t techlamp, F floorlamp, E candelabra, ^/~/: red/green/blue torch,
// `/'/" short red/green/blue torch, , candle, I/J/(/) green/red pillars,
// 3 heart pillar, Z skull pillar, x torch-tree, 1 big tree, </>/[/] hanging
// victim/arms/leg/torso, -/_ dead/gibbed marine, +/ / /| dead zombie/sgun/imp,
// &/{ dead demon/caco, } blood pool. ' ' / '.' = floor.
//
// Every map is a rectangle (all rows equal length) fully ringed by walls, with a
// reachable X exit, a plain D door, a locked door whose matching key is reachable
// through normal play, and a secret * tile that conceals a bonus pickup. All three
// were generated and validated for reachability before being committed here.

import type { LevelSource } from '~/doom/types'

const HALF_PI = Math.PI / 2

// ─────────────────────────────────────────────────────────────────────────────
// Level 1 — "Outpost Entry" (32 wide × 22 tall).
// Easy ramp-up. Red key sits in the open; the
// red door gates the exit alcove. A secret in the left bay hides armor + a medkit.
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_1: LevelSource = {
  name: 'OUTPOST ENTRY',
  floorFlat: 0,
  ceilingFlat: 2,
  playerAngle: 0,
  rows: [
    '################################',
    '#@.....TH#..........#.T...T....#',
    '#....g..QQ#.....S....#...gQQ...#',
    '#...Qg....#.....b....#....2....#',
    '#....p....#....-i....#..=...h..#',
    '#.........D..........#...Qk....#',
    '#.........#..........#....7....#',
    '#..^....^.#.....i....#....Q....#',
    '#....#*####..........#.....,...#',
    '#....#O.V##.....+....#.%%%.%%%.#',
    '#....######....Qa....#...E$....#',
    '#.........#..........D.........#',
    '#....I....#..........#.....#...#',
    '#.........#....r.....#...s.#h..#',
    '#.........#....Q.....#...i.#...#',
    '#....i....#....Q.....#.....#...#',
    '#.........#..........#.....R...#',
    '#..G...<..#....g.....#.....#...#',
    '#......d..#....l.....#.....#.X.#',
    '#....I....#..........#.....#N..#',
    '#.........#..........#.....#...#',
    '################################',
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Level 2 — "Tech Labyrinth" (34 wide × 26 tall).
// Tech + metal + brick. Blue key in the lower-left
// vault; the blue door gates the exit. Shotgun + chaingun rewards; secret hides a medkit.
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_2: LevelSource = {
  name: 'TECH LABYRINTH',
  floorFlat: 1,
  ceilingFlat: 3,
  playerAngle: HALF_PI,
  rows: [
    '##################################',
    '#@..T..%%%%%%%%.........T........#',
    '#...g..%......%....Qi.......c....#',
    '#......D..h...%...QQ.......s.....#',
    '#......%......%......o.........s.#',
    '#......%%%%%%%%......QQ..........#',
    '#...^...........ø............5...#',
    '#....b........=....%%%%%.%%%%....#',
    '#....I........=.........Qj.......#',
    '#..a..Qg..i..=.......kQ........G.#',
    '#....I........=.........Q6.......#',
    '#.............=...........&......#',
    '#.............=.....b........$...#',
    '#%%%%.%%%%%%..=...QQg............#',
    '#%%Mw......%..=..................#',
    '#m*.u......%..D....,........h....#',
    '#%%........%..=..................#',
    '#%%......E.%..=..................#',
    '#%%%%%%%%%%%..=..........#########',
    '#.....<.......=.......C..#.dQ...##',
    '#...d.........=.......o..#..QQ..##',
    '#.............=.......Q..B....X.##',
    '#........g....=....Qv....#...0..##',
    '#......-......=..........#......##',
    '#.............=..........#########',
    '##################################',
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Level 3 — "The Reactor" (36 wide × 28 tall).
// FINALE. Heavy mix, yellow gate, demon-heavy.
// Yellow key in the lower-left vault; the yellow door seals the reactor exit. Secret hides armor.
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_3: LevelSource = {
  name: 'THE REACTOR',
  floorFlat: 1,
  ceilingFlat: 3,
  playerAngle: 0,
  rows: [
    '####################################',
    '#@..T...#.....T....#....T...h..T...#',
    '#...g...#...i......#....dQQ...K....#',
    '#.......D..........D.........Q=....#',
    '#...m...#....-.....#.....4....=....#',
    '#..^....#..........#.........Q=....#',
    '######D########D####...............#',
    '#..................#....QQj........#',
    '#....i...Qg........#.......<.......#',
    '#......Ω...........D....i..Qf......#',
    '#....b....s........#.....Q9........#',
    '#...I..............#%%%%%%%.%%%%%%%#',
    '###D#####..........#...............#',
    '#.......#........Qd#....g...s......#',
    '#.......#....G.....#......QW.......#',
    '#...E...#..........#......Q........#',
    '#..................Y...............#',
    '#.......#.....i....#...QA....dn....#',
    '#.......#..........#...†.Qz........#',
    '#...d...#....C.....#...............#',
    '#......&...........................#',
    '#..#######.....,...................#',
    '#..##e#..#.................=d=====.#',
    '#....*#..g.................=.OV..=.#',
    '#..a...y.#...<................X..=.#',
    '#..b.....i.................=.Δ...=.#',
    '#..#######.................=======.#',
    '####################################',
  ],
}

export const LEVELS: readonly LevelSource[] = [LEVEL_1, LEVEL_2, LEVEL_3]
