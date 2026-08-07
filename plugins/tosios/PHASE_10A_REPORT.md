# Phase 10A — TOSIOS Integration: Architecture Analysis & Adapter Report

**Scope of this report, exactly as directed:** analyze the real TOSIOS architecture, vendor the repository, build the Plugin Adapter and Decision Adapter, map canonical events and legal actions, verify the adapter compiles and passes tests, and document all of it. **The full AI pipeline is NOT connected and no adaptation experiments were run** — that is explicitly Phase 10B, once this adapter layer is reviewed and stable.

---

## 1. Directory tree

```
plugins/tosios/
├── PHASE_10A_REPORT.md          this document
├── upstream/                     vendored, BYTE-IDENTICAL, unmodified TOSIOS
│   ├── PROVENANCE.md             exact commit hash, date, verification method
│   ├── LICENSE                   MIT (unmodified)
│   └── packages/
│       ├── common/src/           shared types, constants, collision math, tiled-map parsing
│       ├── server/src/           the Colyseus server — authoritative game logic
│       │   ├── entities/         Player, Bullet, Monster, Prop, Game, Circle, Rectangle
│       │   ├── states/           GameState.ts (556 lines — the real simulation)
│       │   ├── rooms/            GameRoom.ts (Colyseus Room wrapper)
│       │   └── index.ts          express + Colyseus server bootstrap (not used by the adapter)
│       └── client/src/           PixiJS renderer + input capture (read for reference only —
│                                  see §2.1; this adapter never runs client code)
└── adapter/                      @adaptive-ai/tosios-adapter — everything WE wrote
    ├── package.json
    ├── tsconfig.json              strict, extends this monorepo's tsconfig.base.json
    ├── tsconfig.vendor.json       lenient, models TOSIOS's OWN tsconfig.json (see §4.1)
    ├── scripts/build-vendor.js    compiles the vendored subset this adapter needs
    ├── vendor-dist/                (git-ignored, regenerated) compiled TOSIOS output
    └── src/
        ├── manifest.ts            GamePluginManifest for tosios
        ├── types.ts               Adapter-internal snapshot/diffing types
        ├── snapshot.ts            The ONE place this adapter reads GameState's public fields
        ├── event-mapping.ts       Pure TOSIOS-signal -> canonical-event functions
        ├── event-deriver.ts       Stateful: message capture + tick-boundary diffing
        ├── action-mapping.ts      Legal action space (discretized from TOSIOS's continuous input)
        ├── decision-adapter.ts    getLegalActions / applyDecision
        ├── adapted-game-room.ts   The ONLY Colyseus-lifecycle glue — zero upstream edits
        ├── index.ts               Public exports
        └── __tests__/
            ├── fixtures.ts              Builds a REAL GameState (no mocks)
            ├── event-deriver.test.ts    16 tests, real GameState scenarios
            ├── decision-adapter.test.ts 14 tests, real GameState scenarios
            ├── action-mapping.test.ts   9 tests, pure functions
            └── integration.test.ts      1 end-to-end simulated-match test
```

**42/42 tests pass, `tsc -b` compiles clean, from a cold `rm -rf dist vendor-dist` in both cases** (verified as part of this session — see §7).

---

## 2. TOSIOS architecture analysis

Analyzed from the real vendored source (`upstream/`, commit `98de136e...`, see `upstream/PROVENANCE.md`), not from documentation or assumption.

### 2.1 Client architecture

`packages/client` — PixiJS 6 renderer + React shell (Reach Router), `colyseus.js` for the network connection. The client is a **thin, replaceable presentation layer**: it renders whatever `GameState` the server syncs to it and translates keyboard/mouse/touch input into the exact same three action types the server accepts (`move`/`rotate`/`shoot`), sent via `room.send(action.type, action)`. Critically for this integration: **the client never computes anything authoritative** — even its own local movement prediction (`Game.ts`'s `move()` method moves the local sprite immediately for responsiveness) is corrected by the server's own next state sync. This is exactly the "server-authoritative" property `PLATFORM_V2_DESIGN.md` flagged as the reason TOSIOS was picked over a client-simulated game — confirmed true by reading the actual code, not assumed. **This adapter never touches `packages/client` at all** — a server-authoritative game's AI opponent needs to speak the server's protocol, not run inside a renderer.

### 2.2 Server architecture

`packages/server` is a single Colyseus `Server` (`src/index.ts`) hosting one Room type (`GameRoom`, registered under the fixed name `Constants.ROOM_NAME = 'game'`). One `GameRoom` instance = one match = one Colyseus room; players join via the standard Colyseus matchmaking handshake. The Room delegates essentially all logic to a plain (non-Colyseus-framework) class, `GameState`, which is NOT a Colyseus Room subclass — it's a `@colyseus/schema` `Schema` (the network-sync-annotated state object) that ALSO happens to contain all the simulation logic as its own methods. This is TOSIOS's central architectural choice: **state and simulation logic are the same object.**

### 2.3 Entity system

Every entity (`Player`, `Bullet`, `Monster`, `Prop`, `Game`) extends `@colyseus/schema`'s `Schema` (or the small `Circle`/`Rectangle` base classes, which do too) and declares its networked fields with `@type(...)` decorators — this is what makes every field on these classes automatically diff-synced to every connected client, every server tick. **Audited field-by-field (see `adapter/src/snapshot.ts`'s doc comment): every field this adapter reads is a real, un-decorated-`private` field.** No entity has getters/setters gating access beyond what's already public; the handful of genuinely private fields (`Monster`'s internal AI state machine fields, `GameState`'s private `map`/`walls`/`spawners`/`actions` queue) are never read by this adapter.

### 2.4 AI system (pre-existing, non-adaptive)

TOSIOS already ships one NPC type: `Monster` (`server/src/entities/Monster.ts`), a simple three-state FSM (`idle` → `patrol` → `chase`) with no learning, no player-model awareness, no decision engine — pure scripted behavior (patrol randomly, chase within `MONSTER_SIGHT` (192px), attack on contact with a backoff timer). **This is explicitly out of scope for adaptive AI integration** — `Monster` is decorative danger, not an opponent our platform controls or observes for pattern purposes. The platform's AI opponent is a **player** (a Colyseus client the platform's Decision Adapter drives via the same `playerPushAction` path a human uses), never a monster.

### 2.5 Networking model

Colyseus's standard model: WebSocket transport, server-authoritative state, automatic state-diff sync to every client every `patchRate` (Colyseus's own patch-broadcast interval, separate from the simulation tick — TOSIOS doesn't override `setPatchRate`, so it runs at Colyseus's own default). Client → server messages are the three action types (`move`/`rotate`/`shoot`), sent via `room.send(type, action)`, arriving at `GameRoom.onMessage('*', ...)`. There is exactly one message dispatch point in the entire server for all player input — confirmed by reading `GameRoom.ts` in full (82 lines).

### 2.6 Tick/update loop

`GameRoom.onCreate` calls `this.setSimulationInterval(() => this.handleTick())` with **no explicit delay** — confirmed against the installed `@colyseus/core@0.14.36` source (`node_modules/@colyseus/core/build/Room.js`): `DEFAULT_SIMULATION_INTERVAL = 1000 / 60` — **TOSIOS runs its authoritative simulation at exactly 60Hz (16.66ms/tick)**. Each tick: `GameState.update()` → `updateGame()` (match-lifecycle FSM) → `updatePlayers()` (drains the queued action list, applying at most one `move`/`rotate`/`shoot` per queued action) → `updateMonsters()` → `updateBullets()` (movement + all collision resolution), strictly in that order, every tick, synchronously.

**Important, empirically-verified finding (see `event-deriver.ts`'s `BULLET_ATTRIBUTION_WINDOW_MS` doc comment and the failing-then-fixed test in `event-deriver.test.ts`):** because `updatePlayers()` (which spawns a bullet from a queued `shoot` action) and `updateBullets()` (which moves and resolves that same bullet's collisions) both run within ONE `update()` call, **a bullet fired at close range can be born, travel, hit, and deactivate within its own first tick** — it may never be observable as `active: true` in any snapshot taken once-per-tick. This directly shaped this adapter's damage-attribution design (recency-window correlation on `Bullet.shotAt`, not a naive active→inactive transition check — see §5).

### 2.7 Match lifecycle

A single `Game` entity (`server/src/entities/Game.ts`) drives a 3-state FSM, `waiting → lobby → game → lobby → ...`:

- **waiting**: fewer than 2 players. `updateWaiting`: as soon as `countPlayers > 1`, transitions to `lobby`.
- **lobby**: `Constants.LOBBY_DURATION` = 10 real seconds, broadcast-free countdown. Drops back to `waiting` if a player leaves mid-lobby leaving only 1. On timeout, transitions to `game` (`startGame()`).
- **game**: `Constants.GAME_DURATION` = 90 real seconds max. `startGame()` randomizes team assignment (team deathmatch only), positions, sets every player's lives to `PLAYER_MAX_LIVES` (3), spawns props (`FLASKS_COUNT` = 3) and monsters (`MONSTERS_COUNT` = 3), and broadcasts `{type: 'start'}`. Ends on: last-player-standing (deathmatch) / last-team-standing (team deathmatch) / the 90s timer / down to 1 connected player — each broadcasts `{type: 'won'|'timeout', ...}` immediately followed by `{type: 'stop'}`, then returns to `lobby`.

**There is no per-life respawn within a round** — once a player's `lives` hits 0 they stay dead (spectating) until the NEXT match's `startGame()` repositions and re-lives everyone simultaneously. This directly informed a real architectural finding in §5 (no "PlayerRespawned" canonical event applies to TOSIOS as it exists today).

### 2.8 Input handling

Exactly three player-originated actions, always carrying `{playerId, ts, type, value}`:
- `move`: `value: {x, y}` — a raw (not-necessarily-normalized) 2D direction; `Player.move()` normalizes it server-side and applies `Constants.PLAYER_SPEED` (1px/tick).
- `rotate`: `value: {rotation}` — absolute angle in radians, purely cosmetic/aiming state, no gameplay cost.
- `shoot`: `value: {angle}` — rate-limited server-side by `Constants.BULLET_RATE` (800ms) via `player.lastShootAt`, checked inside the PRIVATE `GameState.playerShoot` method (no public hook — see §5's cooldown-detection design).

All three funnel through the single `GameRoom.onMessage('*', ...)` dispatch into `state.playerPushAction(...)`, which just appends to a queue (`private actions: Models.ActionJSON[]`) drained once per tick, in receipt order, by `updatePlayers()`. **This queue-then-drain design is what "the AI is indistinguishable from a client with unusual input timing" (`PLATFORM_V2_DESIGN.md` §3.4) means concretely**: an AI-submitted action enters the exact same queue, at whatever tick it happens to arrive, exactly like a human's.

### 2.9 Damage system

Two damage sources, both resolved as exactly **-1 life** (no variable damage amounts anywhere in the codebase):
1. **Bullet hits** (`GameState.bulletUpdate`, called once per active bullet per tick): circle-to-circle collision against every player; `Player.canBulletHurt` gates it (must be alive, not the shooter, not a teammate in team-deathmatch). On hit: `bullet.active = false`, `player.hurt()`, and — **only if this hit was lethal** — a `{type:'killed', params:{killerName, killedName}}` broadcast. A non-lethal hit produces **no message at all**, only the `lives` schema field changing (see §5, this is why tick-diffing exists).
2. **Monster attacks** (`GameState.monsterUpdate`): circle-to-circle collision against every player, gated by `monster.canAttack` (a 3-second attack backoff, `Constants.MONSTER_ATTACK_BACKOFF`). Same `-1 life`/optional-`killed`-message pattern, with `killerName` hardcoded to `'A bat'`.

Healing is the mirror case: walking onto an active `potion-red` prop (`GameState.playerMove`'s collision branch) calls `player.heal()` (+1 life, capped at `maxLives`) and deactivates the prop — again, **no broadcast message**, only two schema fields changing (`player.lives`, `props[i].active`).

### 2.10 Weapon system

TOSIOS has exactly **one weapon**, unnamed in the data model (referred to only as "the staff" in `Constants.PLAYER_WEAPON_SIZE`'s comment) — no weapon inventory, no equip/switch mechanic, no ammo count, no reload mechanic of any kind. The only "resource" gating fire rate is the flat 800ms cooldown. **This is a real, confirmed absence, not an oversight in this analysis** — grepped the entire `server/` and `client/` source for `reload`/`ammo`/`magazine`/`weapon.*switch` and found nothing beyond the identifiers already covered above.

### 2.11 Spawn system

Player/monster/prop spawn positions come from two independent sources baked into each Tiled map JSON (`common/src/maps/{small,gigantic}.json`, loaded via `common/src/tiled/`):
- **Spawners**: designated tiles, collected into `this.spawners: RectangleBody[]` at room creation; players are placed at `getSpawnerRandomly()` (uniform random pick) at match start and (implicitly) never mid-round, since there's no respawn (§2.7).
- **Free positions**: monsters and props use `getPositionRandomly()` — uniform-random map coordinates, optionally collision-checked against walls (props: yes; monsters: no, per `monstersAdd`'s call with `withCollisions=false`).

### 2.12 Event system

TOSIOS's OWN "event system" is the `MessageJSON` broadcast stream (`Models.Message.ts`: `type: 'waiting'|'start'|'stop'|'joined'|'killed'|'won'|'left'|'timeout'`), funneled through exactly one function, `GameState`'s constructor-injected `onMessage` callback — `GameRoom.handleMessage`, which just re-broadcasts it to every connected client (`this.broadcast(message.type, message)`). This is a **client-notification stream, not a canonical/structured event log** — several fields identify players by display NAME rather than id (`killed`'s `killerName`/`killedName`), which is a real, confirmed constraint this adapter's `captureMessage` has to work around (name→id lookup against currently-known players — see §5 and `event-deriver.ts`'s doc comment).

---

## 3. Integration architecture

```
        Human client                              AI (future, Phase 10B)
  packages/client (PixiJS)                  Decision Engine -> getLegalActions/
        │ room.send(type, action)                  applyDecision (this adapter)
        ▼                                                  │
┌──────────────────────────────────────────────────────────┼───────────┐
│  AdaptedGameRoom  (subclasses upstream's real GameRoom)   │           │
│  onCreate/onJoin/onLeave: call super.*() first, unconditionally       │
│  handleTick/handleMessage: shadow the two arrow-field methods (§4.2)  │
│                                                             ▼          │
│  ┌──────────────────────┐        ┌─────────────────────────────────┐ │
│  │ TosiosEventDeriver     │◄──────│  captureSnapshot(state)          │ │
│  │  - captureMessage()    │       │  (the ONE place public GameState │ │
│  │  - diffTick()          │       │   fields are read — §2.3)        │ │
│  │  - observeShootAttempt │       └─────────────────────────────────┘ │
│  └──────────┬────────────┘                                            │
│             │ TosiosCanonicalEvent[]                                  │
└─────────────┼──────────────────────────────────────────────────────────┘
              ▼
     (Phase 10B: Event Pipeline ingestion — not wired yet, see §8)

  state.playerPushAction(...)  <───── decision-adapter.ts's applyDecision()
  (the SAME public method GameRoom's onMessage dispatch already calls)
```

### 3.1 Why `upstream/` and the strict monorepo tsconfig don't mix (and how that was resolved without touching upstream)

**Confirmed empirically during this session** (a throwaway probe compile, since deleted): compiling TOSIOS's real source under this repo's `tsconfig.base.json` (which every other package in this monorepo extends — `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitAny`, ...) produces ~50 errors — missing `@colyseus/schema`/`rbush` type augmentations, several genuine implicit-`any` parameters, a few `strictNullChecks` violations (e.g. `Game.lobbyEndsAt: number` with no definite-assignment analysis satisfied). This is not a defect in TOSIOS — its own `package.json` points `main`/`types` at **raw `.ts` source**, an esbuild-bundling convention (`scripts/build.ts` bundles directly from source, never runs `tsc`) that was never meant to be consumed as a type-checked dependency by a separate strict package.

**Resolution:** `adapter/scripts/build-vendor.js` compiles the subset this adapter needs (`common` in full; `server`'s `entities/`, `states/`, `rooms/` — deliberately excluding `server/src/index.ts`, which pulls in `express`/`cors`/`compression`/`@colyseus/monitor` for a bootstrap this adapter never runs) using `tsconfig.vendor.json` — settings modeled on **TOSIOS's own root `tsconfig.json`** (`target: es2019`, non-strict, `skipLibCheck`), into `vendor-dist/` (git-ignored, regenerated by `npm run build:vendor`, which `npm run build`/`npm test` both run automatically first). The adapter's own strict `tsc -b` then consumes `vendor-dist/`'s real `.d.ts`+`.js` output — this repo's `tsconfig.base.json` already sets `skipLibCheck: true`, so re-checking TOSIOS's already-compiled declarations never happens.

One additional wrinkle, also resolved without touching `upstream/`: TypeScript's `paths` config option (used to resolve the bare `@tosios/common` specifier during the vendor compile) is compile-time-only — it does **not** rewrite the `require('@tosios/common')` calls actually emitted into the compiled `.js`. `build-vendor.js`'s final step writes a small `vendor-dist/node_modules/@tosios/common/package.json` whose `main` is a relative path straight to the already-compiled `common/src/index.js` — a real, Node-resolvable package, requiring no symlink (avoided deliberately: directory symlinks need elevated privileges on Windows, where this session ran).

**This entire build step is new code we own (`adapter/scripts/build-vendor.js`, `adapter/tsconfig.vendor.json`) — zero bytes of `upstream/` were read-modified-written to make it work.** Verified: `diff -rq` between `upstream/packages/` and a fresh clone of the vendored commit reports zero differences (see `upstream/PROVENANCE.md`).

---

## 4. Adapter design

### 4.1 The "zero modification" constraint, made concrete

Every hook point this adapter uses is a genuinely **public, framework-intended extension point** — never a private field/method reached into, and never a byte changed in `upstream/`:

| Hook | Why it's legitimate | Used for |
|---|---|---|
| `Room.onCreate`/`onJoin`/`onLeave` | Colyseus's own documented subclass-override lifecycle (`Room.d.ts` declares them `?(...)`, i.e. designed to be overridden) | Wiring, per-connection bookkeeping |
| `this.onMessage('*', ...)` | A real, public `Room` method; TOSIOS itself calls it the same way | Shoot-cooldown observation (§4.3) |
| `this.state` (public field) | `GameState` is publicly exposed on every `Room<GameState>` | Reading (never writing) for snapshotting |
| `state.playerPushAction(...)` | Public method, the SAME one `GameRoom`'s own dispatch calls | The Decision Adapter's ONLY write path |
| `state.playerAdd`/`playerRemove` | Public methods TOSIOS's own `onJoin`/`onLeave` already call | (available; not currently used beyond what `super.onJoin`/`onLeave` already does) |
| `GameState`'s constructor `onMessage` parameter | An explicit, designed injection point (not a default — it's a **required constructor argument**) | Message capture, via field-shadowing (§4.2) |

### 4.2 The field-shadowing technique (why `handleTick`/`handleMessage` needed it, and why it's safe)

`GameRoom.handleTick`/`handleMessage` are declared as **arrow-function instance fields** (`handleTick = () => { this.state.update(); }`), not prototype methods — a common pattern for auto-binding `this` without `.bind()`. This means `super.handleTick` is not reachable the way `super.someMethod()` normally would be (there is nothing on `GameRoom.prototype` to call). `AdaptedGameRoom` redeclares both fields with the same name; per JS class-field initialization order (parent's own field initializers run first, as part of the implicit `super()` call, then the subclass's own field initializers run and **overwrite** any same-named field), by the time Colyseus's framework code — or `GameRoom.onCreate`'s own `new GameState(..., this.handleMessage)` call — reads `this.handleTick`/`this.handleMessage`, it already resolves to `AdaptedGameRoom`'s version. Both overrides replicate their parent's one-line original body **exactly**, so this is sequencing, never a reimplementation of gameplay logic.

### 4.3 Why tick-diffing exists at all (vs. patching every call site)

Two of TOSIOS's real behaviors have **no public hook**: the shoot-rate-limit check (private, inside `GameState.playerShoot`) and non-lethal-damage/pickup resolution (private, inside `bulletUpdate`/`monsterUpdate`/`playerMove`). Two options were available: (a) patch those private methods anyway (impossible without either modifying `upstream/` or monkey-patching prototypes — both rejected, the latter for being far more fragile and harder to review than either alternative), or (b) **derive the same information from public state, either independently re-checking the identical condition (cooldown), or diffing public schema fields tick-over-tick (damage/pickups)**. Option (b) was chosen for both — it's exactly what a spectating Colyseus client already does implicitly via state sync, so it can never see anything a plugin shouldn't.

### 4.4 Decision Adapter — legal action space

TOSIOS's real input is continuous (arbitrary 2D vector, arbitrary angle); Utility AI needs a finite, scoreable candidate set. `action-mapping.ts`/`decision-adapter.ts` discretize it into (at most) 12 actions per `getLegalActions` call, tagged with the exact vocabulary `@adaptive-ai/decision-engine`'s real considerations already read (`plan-adherence.ts`'s `CATEGORY_TAGS`, `punish-opening.ts`/`safety.ts`'s tag lists — grepped directly from the approved Phase 8 source, not guessed):

| Action id | When legal | Tags | Realized as |
|---|---|---|---|
| `hold` | Always (player alive, match live) | `wait`, `observe` | No command sent at all |
| `move:N`/`NE`/`E`/`SE`/`S`/`SW`/`W`/`NW` | Always | `move`, `reposition`, `position` | `rotate` (facing) + `move {x,y}` |
| `move:towardNearestOpponent` | A live, non-teammate opponent exists | `offensive`, `attack`, `pressure` | `rotate` toward opponent + `move` toward them |
| `move:awayFromNearestOpponent` | Same | `defensive`, `retreat` | `rotate` toward opponent (facing them while retreating) + `move` away |
| `shoot:nearestOpponent` | Opponent exists AND off cooldown | `offensive`, `attack`, `pressure` | `rotate` toward opponent + `shoot {angle}` |

Every action's `legalUntil` is `now + 100ms` (one TOSIOS reconciliation window — see §2.6's tick rate). `applyDecision` calls `state.playerPushAction` one or two times (a `rotate` then the actual `move`/`shoot`) — **never anything else** — and returns `[]` (a genuine no-op) for: an unrecognized action id, a dead player, or a `move:towardNearestOpponent`/`shoot:nearestOpponent` whose target vanished between `getLegalActions` and `applyDecision` (never fabricates a stand-in target).

**Deliberate Phase 10A simplification, documented rather than hidden:** a bare `rotate` (independent of a move/shoot) is not offered as its own legal action — it's folded into every move/shoot as a facing prerequisite, since it has no standalone gameplay cost or effect worth Utility AI reasoning about on its own. `countersPatternCategory`/`punishesAggression`/`pressuresLowSkill` (the opt-in fields `decision-engine`'s exploit considerations read) are not yet set on any action — real tuning work, deferred to Phase 10B once the full pipeline is live and there's real match data to tune against.

---

## 5. Event mappings

Every mapping below is justified against either (a) the real, already-implemented `CANONICAL_EVENT_TYPES` in `@adaptive-ai/sdk-protocol`, or (b) real payload fields already read by a shipped Pattern Recognition detector / Player Modeling analyzer (grepped from `platform/ai-engine/{pattern-recognition,player-modeling}/src`) or `platform/event-pipeline/validation/plugins.ts`'s fixtures — never invented ad hoc.

| TOSIOS signal | Derivation | Canonical event | Payload | Real consumer(s) grounding the shape |
|---|---|---|---|---|
| `Game` transitions to `'game'` (`{type:'start'}` message) | Message capture | `MatchStarted` | `{map, mode, maxPlayers}` | `validation/plugins.ts`'s `{map}` fixture, extended |
| `{type:'won'}` then `{type:'stop'}` | Message capture, buffered | `MatchEnded` | `{outcome:'win', winnerName}` | `validation/plugins.ts`'s `{outcome, winnerId}` (name used, no numeric id exists upstream) |
| `{type:'timeout'}` then `{type:'stop'}` | Message capture, buffered | `MatchEnded` | `{outcome:'timeout'}` | same |
| `{type:'stop'}` with no preceding won/timeout (a player left, dropping the room to 1) | Message capture | `MatchEnded` | `{outcome:'abandoned'}` | genre-agnostic — no upstream fixture covers this case, named to match the real cause |
| `player.x`/`y` changes tick-over-tick beyond a 0.01 epsilon | Tick diff | `PlayerMoved` | `{x, y, dx, dy}` | `validation/plugins.ts`; `player-modeling/preferred-combat-distance.ts` reads `payload.distance` off `PlayerMoved` too (not populated here — no "distance to what" is well-defined for a bare move; only populated on `PlayerDamaged`, see below) |
| `player.lives` decreases (any amount — always 1 in practice) | Tick diff + bullet/monster correlation | `PlayerDamaged` | `{amount, sourceType:'bullet'\|'monster', sourceId?, distance?}` | `engagement-distance.ts` reads `payload.distance`; `sourceId` is the real shooter's `playerId` (Bullet's own public field) |
| `{type:'killed'}` message | Message capture, name→id resolved against current players | `PlayerDied` | `{killerName, killerId?, distance?}` | `validation/plugins.ts`'s `{killerId}`; `killerId` omitted for a monster kill (not a player) |
| `shoot` action, off cooldown | Independent re-check inside `AdaptedGameRoom`'s `onMessage` (§4.3) | `AbilityUsed` | `{weaponAction:'shoot', weaponId:'staff', offensive:true, angle, timeSinceCooldownReadyMs}` | `reload-timing.ts`'s `payload.weaponAction`; `aggression.ts`'s `payload.offensive`; `weaponId` is a stable placeholder since TOSIOS has exactly one weapon (§2.10) |
| `shoot` action, still on cooldown | Same | `AbilityOnCooldownAttempt` | `{weaponAction:'shoot', weaponId:'staff', remainingCooldownMs}` | `mechanical-skill.ts` reads this event type directly |
| `props[i].active` flips true→false, correlated to the co-located player | Tick diff | `ItemPicked` | `{itemType:'potion-red', propIndex}` | `exploration.ts`'s `payload.itemId` (TOSIOS has no per-instance item id, only a type — `itemType` used instead, see §9) |

### Documented gaps — mission-example events with NO TOSIOS equivalent

| Mission example | Why it doesn't apply |
|---|---|
| `ReloadStarted`/`ReloadFinished` | TOSIOS has no reload mechanic at all (§2.10) — confirmed by source grep, not assumed |
| `TargetChanged` (mission) / `TargetAcquired`/`TargetSwitched` (real canonical types) | No discrete target-lock exists — aiming is continuous mouse angle, never a selection event |
| `WeaponEquipped` | One weapon, never equipped/switched |
| `PlayerRespawned` | No mid-round respawn exists (§2.7) — dying is terminal until the next match, which is already covered by `MatchStarted` |
| `'joined'`/`'left'` (real TOSIOS messages) | No canonical event type exists for bare presence — `CANONICAL_EVENT_TYPES` has no `PlayerJoined`/`PlayerLeft` |
| `DecisionPoint` | This is emitted by the orchestration/tick layer requesting an AI decision, not by a plugin adapter describing what already happened — out of scope for this file |

---

## 6. Known architectural findings (surfaced per the mission's explicit allowance — "unless integration exposes a genuine architectural flaw")

1. **The SDK's per-plugin-mount model assumes one `MatchContext` (one `playerId`) per mounted instance — TOSIOS is one server process hosting MANY players in ONE room/match.** `mountPlugin`'s `handleMessage` stamps `matchContext.playerId` onto **every** event from a mounted instance uniformly (`@adaptive-ai/sdk-host/src/index.ts`). This fits a per-player iframe plugin perfectly but not a server-authoritative multiplayer room. **Resolution taken for Phase 10A:** this adapter's own event type, `TosiosCanonicalEvent`, extends `EmitEventInput` with an explicit `playerId` field per event (see `event-mapping.ts`'s doc comment) — correctly representing what TOSIOS actually produces. **Not yet resolved:** how these per-player-attributed events actually flow through the CURRENT `mountPlugin`/`GameSDK` (which has no per-event playerId override) is an open question for whoever wires the live pipeline in Phase 10B — likely either (a) a room-level mount emitting one canonical event stream with `playerId` folded into `payload` as a workaround field, or (b) a small, additive extension to `mountPlugin`'s `onEvent` signature. **This is the single most consequential finding in this report** — it affects every future multiplayer-room-based plugin the platform ever integrates, not just TOSIOS.
2. **Shot-outcome (`hit`) correlation is not implemented.** `mechanical-skill.ts` wants `payload.hit` on `AbilityUsed`, but a TOSIOS shot's outcome (hit/miss/still-traveling) is only known later, inside `bulletUpdate`, decoupled from the originating shot event by TOSIOS's own bullet-pooling (recycled array slots, no stable bullet id across its lifetime). `AbilityUsed` deliberately omits `hit` rather than fabricate it. A real fix needs a stable shot→bullet→outcome correlation id, deferred to Phase 10B.
3. **Damage-source attribution is a real-data-only heuristic, not a certainty.** `attributeDamage` correlates a `lives` decrease with the most-recently-fired (within 500ms), now-inactive bullet resting within 24px of the victim — real fields, real distances, but a heuristic window nonetheless. In a packed melee with many simultaneous shooters it could misattribute; the alternative (a guaranteed-correct correlation) needs a stable per-bullet id TOSIOS doesn't currently have (same root cause as finding #2).
4. **`GameState`'s own kill message identifies players by display NAME, never by id** (`killed`'s `killerName`/`killedName` are strings, not session ids) — a genuine upstream data-shape limitation this adapter works around via a live name→id lookup, which is only correct as long as two currently-connected players never share a display name (TOSIOS enforces no uniqueness on names at all).
5. **Tick rate (60Hz) makes naive per-tick `PlayerMoved` emission a firehose** (up to 60 events/sec per moving player). This adapter emits on every real position change (never throttled) — correct and complete, but a real Event Pipeline volume/cost consideration for Phase 10B, not addressed here per the "do not optimize prematurely" mission directive.

---

## 7. Verification performed this session

- `diff -rq` between vendored `upstream/packages/` and a fresh clone of commit `98de136e...`: **zero differences**.
- Directly instantiated the REAL, compiled `GameState` in a standalone Node script (no test framework) — confirmed `waiting→lobby` transition, message broadcasting, and player bookkeeping all work correctly straight out of the vendor-compile pipeline.
- `rm -rf dist vendor-dist && npm run build` (from the adapter package): clean, zero errors.
- `rm -rf vendor-dist && npm test` (from the adapter package): clean, **42/42 tests pass**.
- `npm run build --workspace=@adaptive-ai/tosios-adapter` from the monorepo root: clean.
- Every test in `event-deriver.test.ts`/`decision-adapter.test.ts`/`integration.test.ts` runs against a REAL, unmodified `GameState` instance (see `__tests__/fixtures.ts`) — never a mock of TOSIOS's own logic. The one bug this caught during development (documented in `event-deriver.ts`'s `BULLET_ATTRIBUTION_WINDOW_MS` comment) — same-tick bullet spawn-to-resolution — would have been invisible against a hand-rolled fake.

---

## 8. What's deferred to Phase 10B (explicitly out of scope here, per the mission brief)

- Actually connecting a live `AdaptedGameRoom` to a running Colyseus server and Event Pipeline ingestion (finding #1 in §6 needs a resolution first).
- Resolving the per-player-event-attribution gap in the SDK's mounting model.
- Bullet-to-shot outcome correlation (`hit` on `AbilityUsed`).
- Tuning `countersPatternCategory`/`punishesAggression`/`pressuresLowSkill` on the legal-action tags against real match data.
- Running actual matches (simulated or live) to observe learning/adaptation, confidence evolution, or pattern emergence — none of that has happened yet; nothing in this report should be read as a claim that it has.
- A live client (bot or scripted) actually connecting to a Colyseus room to exercise `getLegalActions`/`applyDecision` over the real network path, rather than directly against an in-process `GameState` as this session's tests do.

## 9. Recommendations before Phase 10B begins

1. **Resolve finding #1 (§6) first** — it's a prerequisite for wiring anything live, not a nice-to-have; every subsequent phase-10B step assumes events can be correctly attributed to individual players.
2. Prototype the live-bot-connection approach (a real Colyseus client, driven by `getLegalActions`/`applyDecision`, connecting exactly like a human) before assuming it "just works" — Colyseus's matchmaking/reconnection semantics haven't been exercised by this phase's tests at all.
3. Add a stable per-bullet correlation id (in the ADAPTER, not upstream — e.g. a side-table keyed by array index + `shotAt`, refreshed each tick) before relying on `hit`-driven Player Modeling signals (`mechanical-skill`) for TOSIOS specifically.
4. Budget real review time for `adapted-game-room.ts` specifically — it's the one file in this package not exercised by an automated test against a real Colyseus `Room` (deliberately: `@colyseus/testing`/a live WebSocket server was judged disproportionate for Phase 10A's stated scope), verified only by strict type-checking against real Colyseus types and manual review against the vendored source it wraps.
