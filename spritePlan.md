# Sprite Plan — Freedoom → собственный формат + все объекты в игре

> Цель: перекодировать настоящие Doom-спрайты (источник — **Freedoom**, лицензия BSD) из
> канонического WAD/patch-формата в **наш современный web-формат** (атлас PNG + типизированный
> JSON-манифест + таблицы состояний), и на этой базе реализовать в движке **все объекты**: 17
> монстров с 8 ракурсами, 9 видов оружия, все снаряды, все пикапы/паверапы и декор (бочки, лампы,
> трупы, колонны…). Существующий процедурный путь (`createAssets`) остаётся как fallback для
> headless/offline.

Статус: **план**. Исполнение — через dynamic workflow (см. §13). Источник зафиксирован: Freedoom
`freedoom2.wad` v0.13.0, лежит в `assets/freedoom2.wad` (в git не коммитится — см. §2).

> **Компаньон-документ:** [`doomBehaviorSpec.md`](./doomBehaviorSpec.md) — каноничная спека
> поведения (source of truth для геймплейной фазы). Матрица покрытия по **всем** сущностям
> (17 монстров, 9 оружий, 10 снарядов, 33 пикапа/паверапа, 45 пропов), точные числа Doom
> (выверены по `info.c`/`p_enemy.c`/doomwiki) и чек-лист из **22 новых механик движка**. §9 и §15
> ниже опираются на неё.

---

## 0. TL;DR

1. **Build-time** скрипт `scripts/build-sprites.ts` парсит WAD → декодирует patch-lump'ы через
   PLAYPAL → пакует уникальные кадры в атлас `public/sprites/atlas.png` + пишет типизированный
   `public/sprites/atlas.json`. Запускается раз, оффлайн, результат коммитится.
2. **Runtime** грузит атлас+манифест один раз (async), нарезает в `Texture` и строит расширенный
   `Assets`. Если загрузка недоступна (jsdom/offline) — тихий откат на процедурные ассеты.
3. **Движок** учится: выбирать 1 из 8 ракурсов по углу «камера→враг vs facing врага», зеркалить
   спрайт (mirror-пары), якорить по Doom-offsets, гонять анимацию по реальным state-таблицам Doom
   (тики @ 35 Гц).
4. **Геймплей** расширяется на весь ростер: новые `EnemyKind`/`WeaponKind`/`ProjectileKind`/
   `PickupKind` + новый статический `Prop`-объект (декор) + 22 новые механики (см. `doomBehaviorSpec.md`),
   архетипы AI + культовые спец-поведения, новые символы карты, обновлённые уровни.

Принцип «современно с точки зрения кода»: **арт генерится оффлайн и типизирован**, рантайм его
только потребляет; декодеры — чистые тестируемые функции; манифест версионируется и
самоописывается; строгие гейты репо соблюдаются (нет `any`/`!`, `??`/`?.`, biome-стиль,
headless-safe, без циклов импорта).

---

## 1. Что внутри `freedoom2.wad` (проверено парсером)

`IWAD`, 3610 lump'ов, 27.5 МБ. `PLAYPAL` + `COLORMAP` на месте. Спрайтовых lump'ов между
`S_START`/`S_END` — **1350**, флэтов — 240.

- **Монстры (17, все с 8 ракурсами `rots=[0-8]`):** `TROO` Imp, `POSS` Zombieman, `SPOS` Shotgun
  guy, `CPOS` Chaingunner, `SARG` Pinky/Spectre, `HEAD` Cacodemon, `BOS2` Hell Knight, `BOSS` Baron,
  `SKUL` Lost Soul, `PAIN` Pain Elemental, `FATT` Mancubus, `BSPI` Arachnotron, `SKEL` Revenant,
  `VILE` Archvile, `CYBR` Cyberdemon, `SPID` Spider Mastermind, `PLAY` Player.
- **Оружие от 1-го лица (9, `rots=[0]`):** `PUNG` кулак, `SAWG` бензопила, `PISG` пистолет, `SHTG`
  дробовик, `SHT2` супер-дробовик, `CHGG` чейнган, `MISG` ракетница, `PLSG` плазма, `BFGG` BFG.
- **Снаряды:** `BAL1` (файрбол импа), `BAL2` (шар како/барона), `MANF` (мансубус), `MISL` (ракета,
  8-rot), `APLS`/`PLSS` (плазма), `BFS1` (BFG).
- **Пикапы/предметы:** аптечки `MEDI`/`STIM`, бонусы `BON1`/`BON2`, брони `ARM1`/`ARM2`, сферы
  `SOUL`/`MEGA`/`PINV`/`PINS`/`PSTR`/`PVIS`, патроны `CLIP`/`AMMO`/`SHEL`/`SBOX`/`ROCK`/`BROK`/
  `CELL`/`CELP`, ключи `RKEY`/`BKEY`/`YKEY` + черепа `RSKU`/`BSKU`/`YSKU`, рюкзак `BPAK`, радзащита
  `SUIT`.
- **Декор/эффекты (79 префиксов):** бочка `BAR1` (взрывная!), лампы/факелы `TLMP`/`CAND`/`TRED`/
  `TGRN`/`TBLU`/`COLU`, колонны `COL1..6`, трупы/гибы `GOR1..5`/`POL1..6`/`HDB1..6`, деревья
  `TRE1/2`, кровь `BLUD`, паффы/вспышки `PUFF`/`SHTF`/`PISF`, дымки телепорта `TFOG`/`IFOG`.

---

## 2. Источник и легальность

- **Freedoom** — BSD-лицензия, можно публиковать (репо деплоится на GitHub Pages через ветку
  `gh-pages`). Формат 1:1 с оригинальным Doom, поэтому пайплайн универсален и потом примет хоть
  оригинальный `DOOM2.WAD` (если владеешь), хоть Realm667-`.pk3` — для локального использования.
- **`assets/freedoom2.wad` НЕ коммитим** (27 МБ бинарь). Правило `assets/*.wad` в `.gitignore`.
  Билд-скрипт до-качивает его из релиза Freedoom, если файла нет.
- Коммитим только **сгенерённый атлас** (`public/sprites/*`, единицы МБ после кропа/дедупа) и
  файл атрибуции `public/sprites/CREDITS.md` (Freedoom BSD + ссылка).

---

## 3. Канонический формат-источник (что парсим)

### 3.1 WAD directory
Header: `int32 magic('IWAD')`, `int32 numLumps`, `int32 dirOfs` (LE). Директория: `numLumps` записей
по 16 байт — `int32 filepos`, `int32 size`, `char[8] name` (null-padded). Спрайты — между маркерами
`S_START`/`S_END` (нулевого размера).

### 3.2 PLAYPAL
`10752 = 14 × 768` → 14 палитр по 256 RGB-триплетов. Берём **палитру 0** (база) для всех спрайтов.
(`COLORMAP` — 34 карты по 256 для дистанс-шейдинга; опционально, см. §7.4.)

### 3.3 Picture (patch) format — подтверждено на байтах
```
Header: uint16 width, uint16 height, int16 leftoffset, int16 topoffset
columnofs: uint32[width]               // смещения колонок от начала lump'а
Каждая колонка — посты до байта 0xFF:
  uint8 topdelta(0xFF=конец) | uint8 length | uint8 pad | uint8[length] palIndex | uint8 pad
```
Пропуски между постами = прозрачные пиксели → **alpha 0**. Каждый байт данных — индекс в PLAYPAL.
Декод → RGBA `Uint8ClampedArray`. Проверка: `TROOA1 w=48 h=60 leftoff=23 topoff=56`.

### 3.4 Именование, 8 ракурсов, зеркала
`NAME(4) + frame(1) + rot(1) [+ frame2 + rot2]`.
- `rot=0` → один спрайт на все углы (оружие, снаряды, пикапы, кадры смерти монстров).
- `rot=1..8` → 8 ракурсов, шаг 45° по часовой; `1` = лицом к зрителю, `5` = спина.
- 8-символьное имя `TROOA2A8` = один спрайт служит ракурсу 2 **и** ракурсу 8 (отражённый
  горизонтально). Итог: 8 углов хранятся в ≤5 lump'ах (`1`, `2/8`, `3/7`, `4/6`, `5`).
- `leftoffset/topoffset` → точка привязки. Монстры: ноги на полу, горизонтальный центр.
  Оружие 1-го лица: отрицательные offsets относительно экранного origin Doom `(160, ~168)` при
  320×200 — а у нас ровно `RENDER_W×RENDER_H = 320×200`, так что мэппинг почти прямой.

---

## 4. Наш целевой формат (выход билда)

Два файла в `public/sprites/` (Vite отдаёт `public/` в корень):

### 4.1 `atlas.png`
Один (или несколько при переполнении) RGBA-PNG. В него упакованы **уникальные** кадры, **обрезанные
по bbox** (прозрачная рамка отброшена), shelf/MaxRects-пакер. PNG кодируется в билде через
`node:zlib` (свой минимальный энкодер, без сторонних зависимостей). Браузер декодирует нативно —
одна сетевая загрузка, GPU-дружелюбно.

### 4.2 `atlas.json` (версионированный, типизированный)
```jsonc
{
  "version": 1,
  "source": "freedoom2.wad 0.13.0 (BSD)",
  "image": "atlas.png",
  "atlas": { "width": 2048, "height": 2048 },
  // index-addressable кадры: регион в атласе + Doom-offsets (для якоря)
  "frames": [
    { "x": 0, "y": 0, "w": 48, "h": 60, "ox": 23, "oy": 56 }
    /* … */
  ],
  // актёры: на букву кадра — 8 записей (rot 1..8) или 1 (rot 0)
  "actors": {
    "TROO": {
      "rotated": true,
      "frames": {
        "A": [ { "f": 12, "flip": false }, /* …8 шт: rot1..rot8, flip для зеркал */ ],
        "I": [ { "f": 40, "flip": false } ]      // длина 1 → all-angles
      }
    },
    "PISG": { "rotated": false, "frames": { "A": [ { "f": 220, "flip": false } ] } }
  }
}
```
TS-контракт манифеста — в `src/doom/engine/sprites/atlasTypes.ts` (zero-import leaf).

### 4.3 Поведение/анимация — отдельно (рукотворно, из Doom `info.c`)
Арт (атлас) машинно-генерён; **поведение** — это таблицы состояний, которых в WAD нет. Точные
значения уже выверены и лежат в [`doomBehaviorSpec.md`](./doomBehaviorSpec.md); здесь они кодируются
в `src/doom/game/actorDefs.ts`:
```ts
interface StateFrame { readonly letter: string; readonly tics: number; readonly bright?: boolean }
interface StateSeq { readonly frames: readonly StateFrame[]; readonly loop?: boolean }
interface ActorDef {
  readonly sprite: string                 // 'TROO'
  readonly states: {
    readonly idle?: StateSeq; readonly see: StateSeq; readonly melee?: StateSeq
    readonly missile?: StateSeq; readonly pain?: StateSeq
    readonly death: StateSeq; readonly xdeath?: StateSeq; readonly raise?: StateSeq
  }
  readonly tuning: EnemyDef                // health/speed/radius/attack* (см. types.ts)
  readonly archetype: AiArchetype          // 'melee' | 'hitscan' | 'projectile' | 'boss'…
}
```
Разделение **ART (генерён) / BEHAVIOUR (рукотворно из info.c)** — ядро «современного» дизайна:
переген арта не трогает баланс, правка баланса не трогает арт.

---

## 5. Build-пайплайн `scripts/build-sprites.ts`

Чистый Node/TS (esbuild/tsx-runner или `node --experimental-strip-types`). Модули — чистые функции,
тестируемые отдельно:

| Модуль | Ответственность |
|---|---|
| `scripts/wad/readWad.ts` | header + directory → `Lump[]` (`{name,data:Uint8Array}`) |
| `scripts/wad/palette.ts` | PLAYPAL → `Uint8Array` (256×RGB, палитра 0) |
| `scripts/wad/decodePatch.ts` | patch-lump + палитра → `{ w,h,ox,oy, rgba:Uint8ClampedArray }` |
| `scripts/wad/spriteIndex.ts` | сгруппировать lump'ы по `NAME→frame→rot`, развернуть mirror-пары |
| `scripts/wad/packAtlas.ts` | кроп по bbox + бин-пакер → атлас RGBA + список регионов |
| `scripts/wad/encodePng.ts` | RGBA → PNG (zlib), минимальный энкодер |
| `scripts/build-sprites.ts` | оркестратор: download-if-missing → parse → decode → pack → write `atlas.png`+`atlas.json`+`CREDITS.md` |

`package.json`: `"build:sprites": "node --experimental-strip-types scripts/build-sprites.ts"`.
Детерминизм: фиксированный порядок lump'ов и пакинга → стабильный diff. Опция `--only=TROO,POSS…`
для частичной сборки в разработке.

---

## 6. Runtime-архитектура (новые модули)

| Файл | Что делает | Импортирует |
|---|---|---|
| `engine/sprites/atlasTypes.ts` | типы манифеста (leaf) | — |
| `engine/sprites/atlasLoader.ts` | `loadAtlas(url): Promise<SpriteAtlas \| null>` — fetch JSON + декод PNG через `Image`→offscreen-canvas→`ImageData`; headless-safe (нет `Image`/canvas → `null`) | types, atlasTypes |
| `engine/sprites/spriteAtlas.ts` | `SpriteAtlas`: лениво нарезает кадры в `Texture`; `frameTexture(i)`, `actorFrame(name,letter,rot)→{tex,flip,ox,oy}` | types, atlasTypes, engine/texture |
| `engine/assets.ts` | `buildAssetsFromAtlas(atlas): Assets` — собирает расширенный `Assets`; `createAssets(seed)` остаётся fallback'ом | всё арт-сборочное |

**Async-загрузка с fallback.** Сейчас `DoomEngine` строит ассеты синхронно в конструкторе. Меняем:
конструктор берёт процедурные ассеты (как сейчас, чтобы jsdom/offline жили и тесты не падали),
параллельно `loadAtlas(SPRITE_URL)` — при успехе свап `this.assets = buildAssetsFromAtlas(...)`
(ассеты уже не `readonly` на стороне движка). Никаких throw при отсутствии сети/Image.

---

## 7. Корректный рендер

### 7.1 Выбор ракурса (ядро «корректного воспроизведения»)
Для билборда монстра нужен индекс ракурса `1..8`:
```
viewAngle = atan2(enemy.y - cam.y, enemy.x - cam.x)      // направление камера→враг
rel       = normalizeAngle(enemy.angle - viewAngle + π)  // как враг повёрнут к зрителю
rot       = 1 + (floor((rel + π/8) / (π/4)) mod 8)       // 1=лицом, 5=спина, по 45°
```
Манифест отдаёт `{ frameIndex, flip }` для (актёр, буква кадра, rot). Кадры `rot=0` (смерть/гибы,
снаряды, пикапы) → всегда индекс 0, без выбора.

### 7.2 Зеркалирование (mirror-пары)
`SpriteInstance` получает поле `flip?: boolean`. В `engine/sprites.ts` при `flip` инвертируем
выборку колонки: `texX = tex.width - 1 - texX`. Дешевле, чем хранить отражённую копию.

### 7.3 Якорь по offsets
В `engine/sprites.ts` заменяем «bottom-center, full-tile» на offset-aware:
горизонталь — центр сдвигается на `(ox - w/2)`, вертикаль — низ спрайта = земля + `(h - oy)` (в
проекционных px). `SpriteInstance` несёт `ox/oy/pxW/pxH` кадра. Вводим `SPRITE_PX_PER_TILE` в
`config.ts` (старт ~48; финально тюним) для перевода px-высоты спрайта в тайлы.

### 7.4 Дистанс-шейдинг (опционально)
Уже есть `fogIntensity`. `COLORMAP` можно подключить позже для аутентичного «light diminishing» —
в этот план не входит (оставляем текущий шейдинг).

### 7.5 Оружие от 1-го лица
`ui/hud.ts::renderWeaponSprite` остаётся, но кадры берутся из атласа (`PISG`/`SHTG`/…), якорь — по
их offsets относительно `(RENDER_W/2, ~168)` + bob/recoil как сейчас. Вспышки выстрела (`PUFF`/
`SHTF`/`MISF`/`PLSF`/`BFGF`) — отдельные bright-кадры поверх. (Учесть, что в `master` оружие уже
переведено на first-person вьюмодели — атлас заменяет процедурные кадры, механика bob/recoil та же.)

---

## 8. Анимация по state-таблицам Doom

Текущий `enemyFrame(enemy, assets)` выбирает кадр по `state + animTimer` из массивов walk/attack/…
Меняем на **state-driven** селектор `actorFrameLetter(def, state, stateClock)`:
проигрываем `StateSeq` актёра по тикам (1 тик = 1/35 c), `loop` для `see`. Буква кадра + ракурс →
кадр атласа. Тики берём из `doomBehaviorSpec.md` (выверены по `info.c`). Примеры:
- **Imp `TROO`**: see `A A B B C C D D` (по ~3 тика, loop); melee/missile `E F G`; pain `H`; death
  `I J K L M`(труп); xdeath `N O P Q R`(гибы); raise — реверс смерти.
- **Zombieman `POSS`**: see `AABBCCDD`; missile (hitscan) `EFG`; pain `H`; death `IJKL`+труп.

> ⚠️ Тики Doom идут @35 Гц, наш sim — @60 Гц. Либо отдельные 35-Гц логические часы анимации, либо
> масштаб тиков ×(60/35≈1.714). Деталь зафиксирована в `doomBehaviorSpec.md`.

---

## 9. Реализация всех объектов (геймплей)

> **Источник истины — [`doomBehaviorSpec.md`](./doomBehaviorSpec.md):** полная матрица покрытия по
> **каждой** сущности (17 монстров / 9 оружий / 10 снарядов / 33 пикапа-паверапа / 45 пропов),
> точные каноничные числа (HP, формулы урона, painchance, скорости, длительности, splash, спец-
> функции) и **чек-лист из 22 новых механик движка**. `actorDefs.ts` кодирует его state-таблицы и
> тюнинг; реализуем по тирам (§13). Ниже — как ростер ложится на архетипы движка.

Расширяем `types.ts` юнионы и таблицы. Подход — **тиры**, чтобы workflow собирал инкрементально с
гейтами проверки.

### 9.1 Монстры → архетипы AI (реюз + спец-поведения)
Базовые архетипы уже есть (melee / ranged-fireball). Маппинг ростера:
- **hitscan-пехота:** Zombieman (пистолет), Shotgun guy (дробь-спред), Chaingunner (очередь+refire).
- **melee:** Pinky/Spectre (Spectre — fuzz-рендер), Lost Soul (charge-rush, всегда флинчит).
- **projectile:** Imp (файрбол), Cacodemon (летает, шар), Hell Knight/Baron (bruiser-шар, разный hp),
  Arachnotron (плазма-поток), Revenant (homing-tracer + melee), Mancubus (6 файрболов веером).
- **боссы:** Cyberdemon (3 ракеты, splash-иммун, hp4000), Spider Mastermind (чейнган-хитскан, splash-иммун).
- **спец-поведения (тир-2):** Pain Elemental (спавнит Lost Souls, cap>20, +3 на смерти), Archvile
  (мгновенная LoS-fire-атака + воскрешение трупов через `raise`-state).
Каждому — запись в `actorDefs.ts` (state-таблицы + tuning `EnemyDef`) с числами из спеки. `EnemyKind`
расширяется до полного списка; `enemyDef`/`spawnEnemy`/`updateEnemy`/`damageEnemy` работают от данных.

### 9.2 Оружие (полный арсенал)
`WeaponKind += superShotgun | rocket | plasma | bfg | chainsaw`. `AmmoKind += rockets | cells`.
- Ракетница/плазма/BFG — стреляют снарядами (не хитскан): `tryFire` ветвится на projectile-оружие.
- Слоты Doom: 1 кулак/пила, 2 пистолет, 3 дробовики, 4 чейнган, 5 ракетница, 6 плазма, 7 BFG
  (расширяем `weaponBySlot` и `Digit1..7`).
- HUD: иконки/лейблы новых стволов, индикатор патронов по типам. Берсерк → кулак ×10 + авто-свитч.

### 9.3 Снаряды
`ProjectileKind += plasma | bfg | rocket | mancubusBall | bruiserShot | revenantTracer | cacoBall`.
- **Rocket:** урон по площади (Chebyshev splash 128, LoS-gated) при попадании.
- **Revenant tracer:** самонаведение (поворот к игроку с лимитом ~16.875°/тик).
- **BFG:** основной шар (100–800) + 40-лучевой spray по фрейму.
Анимация снарядов — кадры `rot=0` (или 8-rot для `MISL`/`MANF`), bright.

### 9.4 Пикапы/паверапы (полный набор)
`PickupKind += stimpack | medikit | healthBonus | armorBonus | greenArmor | blueArmor | soulsphere |`
`megasphere | berserk | invuln | radsuit | lightAmp | allMap | backpack | rockets | rocketBox |`
`cells | cellPack | bulletBox | shellBox` (+ ключи/черепа-ключи).
Эффекты в `applyPickup`/`player.ts` — точные суммы/кэпы из спеки: соул +100 (до 200), мега =200/200,
берсерк (фулл-хп + бонус кулака + тинт), invuln/radsuit/lightAmp/map — таймеры в `Player` (реальные
секунды) + HUD-индикация, backpack — рост `maxAmmo`. Паверап-таймеры тикают в `tickPlayerTimers`.

### 9.5 Декор/реквизит (новый статический объект)
Новый тип `Prop` (статический билборд, не враг): `{ kind, pos, anim?, solid?, destructible? }`.
- **Explosive barrel `BAR1`** — интерактив: hp, при смерти `BEXP` + `A_Explode` splash 128 (цепная
  детонация, та же радиальная функция, что и у ракеты).
- Лампы/факелы/колонны/деревья — анимированный (`TLMP`/`CAND`) или статичный солид-декор;
  fullbright по флагам из спеки; `MF_SPAWNCEILING`-висюны якорятся к потолку.
- Трупы/гибы (`GOR*`/`POL*`/`HDB*`) — нессолид-декор для атмосферы.
`world.ts` владеет `props[]`, тикает анимацию/детонацию, отдаёт в `buildSprites()`.

### 9.6 Карта и уровни
`map.ts`: расширить `CHAR_TO_ENEMY`/`CHAR_TO_PICKUP` + новый `CHAR_TO_PROP`; добавить новые символы
(монстры/оружие/паверапы/бочки). `levels.ts`: задействовать новый ростер в существующих 3 уровнях
(показательно расставить новых врагов, арсенал, бочки у групп врагов, паверапы в секретах).

---

## 10. Изменения типов (`types.ts`)

- `EnemyKind` → полный список (§9.1). `ProjectileKind`/`WeaponKind`/`AmmoKind`/`PickupKind` → §9.2-9.4.
- `SpriteInstance` += `flip?: boolean`, `ox?/oy?/pxW?/pxH?` (offset-aware рендер). Альтернатива —
  отдельный `BillboardInstance`; решаем при реализации, по умолчанию расширяем `SpriteInstance`.
- `Assets.enemy[kind]` → структура с ракурсами: `Record<state, readonly DirFrame[][]>` где
  `DirFrame = { tex: Texture; flip: boolean; ox: number; oy: number }`, внешний массив — кадры,
  внутренний — 8 ракурсов (или 1). Либо тоньше: хранить атлас + резолвить на лету в `buildSprites`.
- Новые сущности: `Prop`, `PropKind`, `ActorDef`/`StateSeq` (в `actorDefs.ts`, не в `types.ts` если
  только для game-слоя), поля таймеров паверапов в `Player`.

---

## 11. Тесты (гейты — обязательны)

**Unit (Vitest, headless):**
- `decodePatch`: синтетический patch (известные посты/пропуски) → ожидаемые RGBA + alpha-0 в дырах.
- `palette`: PLAYPAL-стаб → корректные триплеты; индекс 0 и 255.
- `spriteIndex`: разворот `TROOA2A8` в rot2(flip=false)+rot8(flip=true); `rot=0` → длина 1.
- `rotation`: `(enemy.angle, camera bearing) → rot 1..8` для 8 контрольных углов; flip-флаги.
- `atlasLoader`: при отсутствии `Image`/canvas → `null`, движок жив на процедурных.
- `actorDefs`/state-anim: проигрывание тиков выбирает ожидаемые буквы кадров; `loop`.
- расширенные `enemy`/`weapon`/`pickup`/`world`/`map` под новый ростер + 22 механики из спеки.

**E2E (Playwright, prod-preview):** атлас грузится без console-ошибок; враг меняет спрайт при
повороте игрока вокруг него (сэмпл пикселей); новые стволы переключаются; бочка детонирует.

**Build:** `tsc --noEmit` + `biome` + `eslint --max-warnings 0` + `jscpd` зелёные.

---

## 12. Карта изменений по файлам

**Новое:** `scripts/build-sprites.ts` (+ `scripts/wad/*`), `engine/sprites/atlasTypes.ts`,
`engine/sprites/atlasLoader.ts`, `engine/sprites/spriteAtlas.ts`, `engine/assets.ts`,
`game/actorDefs.ts`, `game/prop.ts`, `public/sprites/{atlas.png,atlas.json,CREDITS.md}`,
тесты под каждый модуль.

**Правим:** `types.ts` (§10), `config.ts` (`SPRITE_PX_PER_TILE`, `SPRITE_URL`, новые радиусы/тайминги),
`engine/sprites.ts` (flip + offset-anchor + rot), `engine/sprites`-интеграция, `game/enemy.ts`
(data-driven + state-anim + спецы), `game/weapon.ts` (арсенал + projectile-ветка), `game/projectile.ts`
(splash/homing/новые типы), `game/pickup.ts`+`game/player.ts` (паверапы/таймеры), `game/map.ts`+
`game/levels.ts` (символы/ростер), `game/world.ts` (`props[]`, `buildSprites`, тик детонаций),
`ui/hud.ts` (оружие из атласа, новые иконки/индикаторы), `engine.ts` (async-load + swap),
`package.json` (`build:sprites`), `.gitignore` (`assets/*.wad`).

---

## 13. Исполнение через dynamic workflow

Несколько последовательных workflow-фаз (между ними читаем результат и решаем дальше). Урок прошлого
запуска: **синтез-агенты держать тощими / собирать большие документы в главном потоке**, а
ресёрч-агентам не давать write-доступ к репо.

1. **Pipeline (parallel fan-out):** реализовать `scripts/wad/*` + `build-sprites.ts`; параллельно —
   юнит-тесты декодера/палитры/индекса. Гейт: `bun run build:sprites` выдаёт валидные
   `atlas.png`+`atlas.json`; визуальный санити-чек нескольких кадров.
2. **Runtime + рендер (parallel):** `atlasTypes`/`atlasLoader`/`spriteAtlas`/`assets.ts`; правки
   `engine/sprites.ts` (rot+flip+offset); async-swap в `engine.ts`. Гейт: типы/тесты/e2e — враг
   меняет ракурс при облёте.
3. **Анимация + базовый ростер (pipeline по актёрам):** `actorDefs.ts` (state-таблицы из спеки),
   data-driven `enemy.ts`; завести hitscan/melee/projectile-монстров. Гейт: новый ростер играбелен.
4. **Арсенал + снаряды (parallel):** оружие/аммо/projectile-ветка/HUD. Гейт: все стволы стреляют.
5. **Пикапы/паверапы + декор (parallel):** полный набор предметов + `prop.ts` + бочки; символы карты
   и уровни. Гейт: подбор/паверапы/детонация работают.
6. **Спец-боссы (тир-2, parallel):** Pain Elemental (спавн), Archvile (поджог + raise), homing
   Revenant, splash-rocket, Cyberdemon/Spider. Гейт: спец-поведения корректны.
7. **Финал:** прогон всех гейтов (`tsc`/`biome`/`eslint`/`jscpd`/`vitest`/`playwright`), визуальный
   проход, обновить `README`/`ARCHITECTURE.md`.

Каждая фаза адверсариально верифицируется (отдельные агенты-скептики проверяют корректность
ракурсов/таймингов/баланса против `doomBehaviorSpec.md`), правки применяются в рабочее дерево, гейты
держим зелёными.

---

## 14. Риски и решения

- **Параллельные сессии в одном дереве** → спрайт-фичу вести на ветке `feat/sprites`, чтобы `git
  checkout`/`rm`/коммиты соседней сессии не затирали незакоммиченную работу (как уже случилось с
  первой версией этих планов и WAD — восстановлено).
- **Масштаб спрайтов** → `SPRITE_PX_PER_TILE` + per-actor `scale`, тюним визуально (native 320×200
  совпадает с Doom — стартовые значения близки к 1:1).
- **Размер атласа/PNG-энкодер** → свой zlib-энкодер без зависимостей; при переполнении — несколько
  страниц атласа (манифест уже index-addressable).
- **Headless/offline** → строгий fallback на процедурные ассеты; ни один модуль не throw'ит без
  сети/Image/canvas; все тесты остаются зелёными.
- **Объём «всех объектов»** → тиры (§9, §13): базовый ростер играбелен рано, культовые боссы — тир-2.
  Полный AI Archvile/Pain Elemental помечен как самый тяжёлый кусок и идёт последним.
- **Коммит WAD** → не коммитим (`assets/*.wad` в `.gitignore`); решение легко обратимо.

---

## 15. Критерии приёмки

1. `bun run build:sprites` детерминированно генерит `atlas.png`+`atlas.json` из `freedoom2.wad`.
2. В игре монстр показывает **корректный из 8 ракурсов** спрайт в зависимости от угла обзора.
3. Анимации идут по **думовским таймингам**; смерть/боль/атака переключаются по state-таблицам.
4. **Каждая сущность из матрицы покрытия `doomBehaviorSpec.md` реализована с задокументированным
   поведением, и все 22 механики из чек-листа закрыты** (монстры, оружие, снаряды, пикапы/паверапы,
   декор — включая взрывную бочку, homing-ракету ревенанта, воскрешение Archvile и спавн Lost Souls).
5. Все гейты зелёные; offline/headless работает на процедурном fallback'е; репо публикуемо (BSD).
