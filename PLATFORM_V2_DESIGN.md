# Adaptive AI Gaming Platform — V2 Technical Design

**Status: design for review. No implementation has begun.** This supersedes the game-centric framing of `PLATFORM_REDESIGN_PROPOSAL.md` (kept for its licensing research, which still holds) with the platform-centric architecture below. WARDEN and THE FIVE are archived under `/archive` — proof-of-concept, not on the active roadmap. See `archive/README.md`.

---

## 1. Final Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              PLATFORM CORE                                │
│                                                                            │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │Authentication│  │ Plugin Manager │  │  Analytics   │  │ Game        │ │
│  │  (existing,  │  │ (registry,     │  │  (platform & │  │ Marketplace │ │
│  │  extended)   │  │  lifecycle,    │  │  business    │  │ (future —   │ │
│  │              │  │  versioning)   │  │  metrics)    │  │  stubbed)   │ │
│  └──────┬───────┘  └───────┬────────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                  │                   │                 │        │
│         └──────────────────┴─────────┬─────────┴─────────────────┘        │
│                                       │                                    │
│                          ┌────────────▼─────────────┐                     │
│                          │      Player Dashboard      │  (React shell,    │
│                          │  Game Launcher · Profile    │  existing)        │
│                          │  Card · Match History        │                  │
│                          └────────────┬─────────────┘                     │
└───────────────────────────────────────┼───────────────────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │           GAME SDK BOUNDARY               │
                    │     (postMessage-only, sandboxed iframe)  │
                    └────────────────────┬────────────────────┘
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  │                      │                      │
          ┌───────▼──────┐      ┌────────▼───────┐     ┌────────▼───────┐
          │ Plugin: TOSIOS│      │Plugin: (future)│     │Plugin: (future)│
          │  events ·      │      │                │     │                │
          │  legal actions │      │                │     │                │
          │  · metadata    │      │                │     │                │
          └───────┬──────┘      └────────┬───────┘     └────────┬───────┘
                  └──────────────────────┼──────────────────────┘
                                         │  canonical event stream
                          ┌───────────────▼────────────────┐
                          │         EVENT PIPELINE            │  (§4)
                          └───────────────┬────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
┌───────▼────────┐          ┌────────────▼─────────────┐        ┌────────▼────────┐
│ Player           │          │   ADAPTIVE AI ENGINE       │        │  Analytics       │
│ Intelligence      │◀────────▶│        (§5)                │        │  Warehouse       │
│ Engine (§5.3)     │          │  9 internal modules         │        │  (business/prod  │
│                   │          │                              │        │   metrics, not   │
│ cross-game profile│          │                              │        │   player-facing) │
└───────┬─────────┘          └────────────┬─────────────┘        └─────────────────┘
        │                                 │  legal-action decisions only
        │                                 ▼
        │                    back through the SAME Game SDK
        │                    action-submission path human
        │                    input uses — the fairness boundary
        └─────────────────────────────────────────────────────────┘
              (profile also feeds Difficulty Calibration & the
               Player Dashboard's Player Card, independent of
               any single match in progress)
```

**The one rule everything above is built to enforce:** the arrow from the Adaptive AI Engine back into a game plugin only ever carries a *decision* (a choice among that plugin's declared legal actions), submitted through the identical channel a human player's input travels through. There is no other path from the Engine into a plugin. That's not a policy — it's the only wire that exists, enforced by the sandbox boundary in §3.

---

## 2. Folder Structure

```
/
├── archive/                      # frozen POCs — see archive/README.md
│   ├── warden/warden.html
│   └── the-five/the-five.html
│
├── platform/                     # NEW — platform core, replaces ad-hoc backend/frontend split
│   ├── api/                      # Express/Node — auth, plugin registry, dashboard API
│   │   ├── auth/                 # existing JWT/bcrypt/Google OAuth, moved in as-is
│   │   ├── plugins/              # Plugin Manager: registry CRUD, version pinning
│   │   ├── dashboard/            # player-facing profile/match-history endpoints
│   │   └── db/                   # Mongoose models (§6)
│   │
│   ├── ai-engine/                # NEW — independent service/package (§5)
│   │   ├── behavior-analysis/
│   │   ├── memory-engine/
│   │   ├── player-modeling/
│   │   ├── pattern-recognition/
│   │   ├── strategy-planner/
│   │   ├── decision-engine/
│   │   ├── difficulty-calibration/
│   │   ├── opponent-personality/
│   │   ├── long-term-memory/
│   │   └── explainability/
│   │
│   ├── player-intelligence/      # NEW — cross-game profile aggregation (§5.3),
│   │                              #   distinct service from ai-engine: this one
│   │                              #   owns the canonical player model; ai-engine
│   │                              #   *consumes* it per-match.
│   │
│   ├── event-pipeline/           # NEW — ingestion API, batching, canonical schema (§4)
│   │
│   ├── sdk/                      # NEW — the Game SDK itself (§3), published as
│   │   │                          #   an installable package so game plugins (ours
│   │   │                          #   or third-party forks) depend on one real
│   │   │                          #   versioned artifact, not copy-pasted glue code
│   │   ├── client/                # runs inside the plugin iframe: emit(), 
│   │   │                          #   getLegalActions(), submitDecision()
│   │   └── host/                  # runs in the parent frame: mounts plugin,
│   │                              #   relays postMessage, enforces the boundary
│   │
│   └── web/                      # the existing React app (frontend/), becomes
│       │                          #   the Player Dashboard specifically —
│       │                          #   Launcher, Profile Card, Match History
│       └── src/...                # AuthContext, ProtectedRoute, etc. — kept as-is
│
├── plugins/                      # NEW — one directory per adopted/built game
│   └── tosios/                    # vendored fork + our adapter layer (§3.4)
│       ├── upstream/               # unmodified-as-possible vendored source,
│       │                          #   tracked so upstream fixes are easy to pull
│       ├── adapter/                # our event-emitter + decision-channel glue,
│       │                          #   the ONLY code we intentionally diverge with
│       └── manifest.json           # GamePlugin manifest (§3.1)
│
├── PLATFORM_REDESIGN_PROPOSAL.md  # prior research doc — licensing analysis still valid
├── PLATFORM_V2_DESIGN.md          # this document
└── info.md                        # existing project overview (predates this pivot;
                                    #   due for a rewrite once V2 ships — not done here)
```

**Migration note on the existing repo:** `backend/` maps onto `platform/api/`, `frontend/` onto `platform/web/`. This is a rename/reorg, not a rewrite — the auth system, `Player` model, and React shell are all kept, just relocated to reflect that they're one piece of a bigger platform now, not "the backend" and "the frontend" of a single app.

---

## 3. Plugin SDK Specification

### 3.1 Manifest

```ts
interface GamePluginManifest {
  id: string;                 // "tosios"
  displayName: string;
  version: string;            // semver of OUR adapter, independent of upstream's version
  upstreamVersion: string;    // commit/tag of the vendored source, for audit trail
  entryUrl: string;           // static bundle path, sandboxed-iframe src
  eventSchemaVersion: string; // canonical taxonomy version this plugin targets (§4)
  supportsAIOpponent: boolean;
  license: { spdxId: string; noticeUrl: string; upstreamRepo: string };
  legalActionSpace: string;   // reference to this plugin's declared action schema
}
```

### 3.2 What a plugin is allowed to expose — and nothing else

Per your instruction, exactly three surfaces, no more:

1. **Events** — the plugin calls `sdk.emit(canonicalEvent)` at meaningful moments. One-directional, plugin → platform.
2. **Legal Actions** — the plugin implements `getLegalActions(entityId): Action[]`, queried by the platform when an AI-controlled entity needs to decide something. Read-only from the platform's side.
3. **Metadata** — the manifest above, static, declared once at plugin registration.

Everything else — rendering, physics, the plugin's actual game logic, its internal state shape — **stays inside the plugin** and is never queried, never touched, never assumed by platform code. This is what makes the AI Engine genuinely game-agnostic: it only ever sees the three surfaces above, identically shaped across every plugin.

### 3.3 The fairness boundary, concretely

Each plugin runs in a **sandboxed iframe** (`sandbox="allow-scripts"`, deliberately omitting `allow-same-origin` where feasible, or same-origin-but-isolated-heap where the plugin needs it for asset loading — evaluated per-plugin, defaulting to maximally restrictive). The SDK's `host/` half lives in the parent frame and is the *only* thing that talks to the iframe, via `postMessage`. Concretely:

```
Plugin iframe                          Platform (parent frame)
─────────────                          ────────────────────────
sdk.emit(event)      ──postMessage──▶  host receives, forwards to
                                       Event Pipeline ingestion API

(platform decides an AI entity        host.requestDecision(entityId)
 needs to act)                        ──postMessage──▶
                                       plugin.getLegalActions(entityId)
                      ◀──postMessage── returns Action[]

                                       AI Engine picks one (§5)

host.submitDecision(entityId, action)
                      ──postMessage──▶
plugin.submitDecision(entityId, action)
  → fed into the SAME code path
    human input uses
```

There is no shared memory, no direct function reference, no synchronous call across the boundary. A plugin *cannot* be asked for anything beyond `getLegalActions`, and cannot be told anything beyond `submitDecision`. This is what makes "the AI never reads hidden state, never teleports, never receives impossible information" a structural guarantee rather than a promise — those failure modes require a capability (direct state access) that the boundary simply does not provide.

### 3.4 The adapter pattern (how a third-party game actually becomes a plugin)

We don't fork-and-rewrite the adopted game. We vendor its source close to unmodified and add a **thin adapter layer**:
- Hook the adapter into the game's existing systems at the points where state already changes (e.g., TOSIOS's Colyseus server already has an authoritative `onPlayerDamaged` handler — the adapter adds one `sdk.emit(...)` call there, doesn't rewrite the damage logic).
- Implement `getLegalActions`/`submitDecision` by wrapping the game's *existing* input-handling entry point — for TOSIOS this means the adapter constructs whatever message the game's own client already sends the server for a human input, and sends that. The AI is, from the game server's point of view, indistinguishable from a client with unusual input timing.

This keeps upstream diffs small and reviewable, and means pulling upstream security fixes later doesn't fight our own modifications.

---

## 4. Event Schema

### 4.1 Envelope (identical across every plugin)

```ts
interface CanonicalEvent {
  playerId: string;
  gameId: string;
  matchId: string;
  seq: number;          // monotonic per-match, detects drops/reordering
  ts: number;            // client-side timestamp, ms
  serverTs?: number;     // stamped on ingestion — clock-skew reconciliation
  type: CanonicalEventType;
  payload: Record<string, unknown>;   // shape defined per `type`, not per-game
  schemaVersion: string;
}
```

### 4.2 Canonical event types (starting taxonomy, versioned and extensible)

| Type | Payload shape | Feeds |
|---|---|---|
| `MatchStarted` / `MatchEnded` | `{opponentType, outcome, durationMs}` | Match records, profile aggregation trigger |
| `PlayerMoved` | `{x, y, velocity, facing}` | Movement Style, Preferred Combat Distance |
| `PlayerDamaged` | `{amount, sourceEntityId, hpRemaining}` | Risk Tolerance, Panic Threshold |
| `PlayerDied` | `{killerEntityId, cause}` | Aggression, Mistake patterns |
| `AbilityUsed` / `AbilityOnCooldownAttempt` | `{abilityId, targetId?}` | Favorite Abilities, mistimed-input signal |
| `TargetAcquired` / `TargetSwitched` | `{targetId, targetRole?}` | Target Prioritization |
| `ItemPicked` / `WeaponEquipped` | `{itemId}` | Favorite Weapons |
| `DecisionPoint` | `{context, chosenAction, availableActions}` | Decision Speed, Strategic Skill — also the raw material for the Explainability Module (§5.9) to later say *why* the AI reacted a certain way |

`payload` for anything outside this core set is still transmitted (games will always have bespoke moments worth capturing) but only the `type`s above get first-class treatment in Behavior Analysis without per-game code. New types are proposed per-plugin and, if broadly useful, promoted into the canonical set — versioned so existing plugins never silently break.

### 4.3 Legal Action schema (the other half of the SDK contract)

```ts
interface Action {
  id: string;              // "move", "attack", "useAbility:beam"
  params?: Record<string, unknown>;
  legalUntil?: number;      // some actions are only legal for a short window —
}                            // exposed explicitly so the AI can't be "tricked"
                             // into an illegal action by stale info
```

---

## 5. Adaptive AI Engine Architecture

Nine modules, each independently testable and reusable across every plugin. This is the product.

### 5.1 Behavior Analysis
Stream processors, one per behavioral dimension, consuming the canonical event stream per-match. Stateless per batch — a match's events can be reprocessed independently, which matters for horizontal scaling (§9) and for replaying old matches if a dimension's analysis logic improves later (recompute history without re-playing the actual game).

### 5.2 Memory Engine
The persistence and retrieval layer for everything the platform has observed — both the raw-ish per-match observation log and the distilled profile. Distinguish from Long-Term Memory (§5.9): Memory Engine is the *mechanism* (read/write, indexing, retention policy); Long-Term Memory is the *behavior* (what gets kept vs. decayed, and how confidence ages).

### 5.3 Player Modeling
Turns Behavior Analysis output into the structured `PlayerProfile` (schema in §6). This is also where **Player Intelligence** as a platform pillar lives conceptually — Player Modeling is game-agnostic by construction, since it operates purely on canonical events, which is exactly what makes cross-game intelligence (a player's TOSIOS aggression informing their day-one read in the next plugin) possible without bespoke cross-game glue code.

### 5.4 Pattern Recognition
Distinguished from Player Modeling: Modeling tracks *continuous* dimensions (aggression: 0.84). Pattern Recognition looks for *discrete, nameable habits* — "reloads after exactly two shots," "always checks the same escape route," "never checks behind." These are the observations you listed verbatim, and they need different machinery (sequence/frequency mining over the event log, not a running average) than the continuous dimensions do. This module is what turns "aggression: 84%" into "this player rushes low-health targets" as a legible, quotable sentence — critical for §5.10's Explainability.

### 5.5 Strategy Planner
Consumes Player Modeling + Pattern Recognition output, produces a match-scoped (or few-seconds-scoped) *plan* — an abstract intent like `{focus: 'healer-first', posture: 'ambush', confidence: 0.7}`. Runs on a slow cadence; does not touch per-tick game state.

### 5.6 Decision Engine
Runs every tick/decision-point. Given the current plugin-reported legal actions + the active plan from the Strategy Planner, picks one action. This is the *only* module that ever calls back through the SDK boundary (§3.3).

### 5.7 Difficulty Calibration
A cross-cutting control layer, not a stage in the pipeline — it modulates how *aggressively* the Decision Engine acts on what it knows, independent of what it knows. A brand-new player and a veteran can have the AI hold an identical, fully-detailed profile; Difficulty Calibration decides how much of that read the Decision Engine is allowed to act on this match. This is the generalized, platform-wide version of what WARDEN's `depth` scaling already did well for one game — promoted here into its own reusable module instead of being hand-coded per game.

### 5.8 Opponent Personality
A deliberate stylistic layer on top of the Decision Engine's raw optimal-play output — the same underlying read on a player ("rushes low-HP targets") can be expressed as a cautious, methodical opponent or an aggressive, punishing one without changing what the AI *knows*, only how it *acts* on it. This is what stops every AI opponent across every game from feeling like the same brain in a different skin, and gives games/designers a lever independent of the learning system itself.

### 5.9 Long-Term Memory
Governs retention and confidence decay across a player's *entire history* with a game (or the platform), as distinct from a single match's working state. Concretely: how much does an observation from 40 matches ago still count, versus one from last night — and does that decay rate differ per dimension (reaction time is probably stable long-term; "favorite ability this season" should decay faster if the game gets balance-patched).

### 5.10 Explainability Module
Given a specific decision the Decision Engine made, produce a human-readable reason, sourced from Pattern Recognition's nameable observations and the active Strategy Planner intent. This is what makes "this enemy actually knows me" *legible* rather than just felt — directly fuels the Player Dashboard's Player Card and post-match "what it learned" summaries (a feature both archived POCs already did in a hand-written, per-game way; this generalizes it).

---

## 6. Database Schema

Extends §9 of the prior proposal with the new modules' needs made explicit.

```
players                    (existing, unchanged)
  _id, email, name, passwordHash?, googleId?, createdAt, updatedAt

playerProfiles              (Player Modeling's output — §5.3)
  playerId,
  crossGame: { [dimensionKey]: { value, confidence, samples, lastUpdated } },
  perGame: { [gameId]: GameSpecificProfile },
  updatedAt

playerPatterns               (Pattern Recognition's output — §5.4, NEW vs. prior doc)
  playerId, gameId, patternId ("reloads-after-two-shots"),
  description, confidence, occurrences, lastSeenMatchId, firstDetectedAt

gameplayEvents                (raw event log — §4)
  playerId, gameId, matchId, seq, ts, serverTs, type, payload, schemaVersion

matches                        (evolves current GameSession)
  playerId, gameId, opponentType: 'ai'|'human',
  aiPersonality?: string,        # which Opponent Personality was active — §5.8
  aiDifficultyLevel?: number,    # Difficulty Calibration's setting for this match — §5.7
  outcome, durationMs,
  profileSnapshotId              # which PlayerProfile version the AI used — audit/replay

decisions                        (Decision Engine's own log, NEW — needed for §5.10)
  matchId, ts, entityId, legalActions, chosenAction,
  planSnapshot,                  # what the Strategy Planner believed at decision time
  explanation?: string           # Explainability Module output, generated lazily
                                  #   on request rather than for every decision —
                                  #   volume/cost tradeoff, see §9

games                             (plugin registry — Plugin Manager's data)
  gameId, name, version, upstreamVersion, license: {spdxId, noticeUrl, upstreamRepo},
  entryUrl, eventSchemaVersion, legalActionSpaceVersion, active: boolean
```

**Why `decisions` is separate from `gameplayEvents`:** events are what *happened in the game*; decisions are what *the AI chose and why*. Conflating them would make the Explainability Module's job (finding "why did it do that") a search through undifferentiated noise instead of a direct lookup.

---

## 7. API Design

```
Auth (existing, unchanged)
  POST /api/auth/signup | /login | /google
  GET  /api/auth/me

Plugin Manager
  GET  /api/games                        # list active plugins, for the Launcher
  GET  /api/games/:gameId/manifest        # fetch a manifest (also used by SDK host)

Event Pipeline
  POST /api/events/batch                  # match-token-authenticated (§8), not
                                          #   the long-lived session JWT
  POST /api/matches/:matchId/start | /end

Player Intelligence / Dashboard
  GET  /api/profile/me                    # cross-game PlayerProfile — the "Player Card"
  GET  /api/profile/me/:gameId            # per-game profile detail
  GET  /api/profile/me/patterns           # Pattern Recognition's nameable observations
  GET  /api/matches/me?gameId=&limit=      # match history

AI Engine (internal-only — not exposed to the browser directly; the plugin host
  calls the platform backend, which calls the AI Engine service over an internal
  channel, so the Engine's decision logic is never client-reachable at all)
  POST /internal/ai/decide                # {matchId, entityId, legalActions} → Action
  POST /internal/ai/explain               # {matchId, decisionId} → explanation string
```

---

## 8. Deployment Architecture

```
                     ┌───────────────────┐
                     │   CDN / Static     │  plugin bundles + web app build,
                     │   Host             │  versioned by gameId@version path
                     └─────────┬─────────┘
                               │
   ┌───────────────────────────┼────────────────────────────┐
   │                Platform Backend (Node/Express)           │
   │   Auth · Plugin Manager · Event ingestion · Dashboard API │
   │              (existing Railway-style deploy)               │
   └──────────────┬─────────────────────────────┬─────────────┘
                  │                              │
       ┌──────────▼──────────┐        ┌──────────▼──────────┐
       │  AI Engine Service    │        │   MongoDB Atlas       │
       │  (separate deploy —   │        │   (existing, schema    │
       │  CPU-bound, scales     │        │   extended per §6)     │
       │  independently)        │        └────────────────────┘
       └──────────────────────┘
```

- **Platform Backend and AI Engine deploy independently** (per the prior proposal's reasoning — different scaling profiles). At current scale both can run on modest single instances; the *service boundary* exists from day one so splitting later isn't a rewrite.
- **Plugin bundles are static assets** — no per-plugin server process. A plugin's *game server* (TOSIOS needs one, being Colyseus-based and server-authoritative) is a third deployable unit, one per plugin that needs it, independent of the platform backend.
- **Feature-flagged plugin rollout**: `games.active` in the registry (§6) gates whether a plugin appears in the Launcher, independent of a platform-wide deploy.

---

## 9. Security Model

- **The SDK boundary (§3.3) is the primary security control**, not a convention — sandboxed iframe + `postMessage`-only bridge means a plugin cannot reach platform internals or other plugins' data, and the platform (including the AI Engine) cannot reach into a plugin beyond its three declared surfaces. Same mechanism defends against a malicious plugin *and* enforces AI fairness — one control, two payoffs.
- **Match-scoped tokens for event ingestion**, distinct from the long-lived session JWT — issued at `MatchStarted`, expire at `MatchEnded` or a timeout. Limits blast radius of a leaked token to one match's event stream, and lets ingestion be rate-limited per-match without penalizing a player's other activity.
- **Server-authoritative game state is a hard requirement for any plugin**, not a preference — a client-simulated game lets a modified client lie to the event stream, which corrupts the Player Profile with fabricated data. This is why TOSIOS (Colyseus, server-authoritative) remains the right first pick independent of the licensing question.
- **AI Engine is never client-reachable.** The browser never talks to it directly (§7) — only the platform backend does, over an internal-only channel. A player's client cannot query "what does the AI think of me" or attempt to feed it directly.
- **Vendored plugin supply chain**: `npm audit` (or equivalent) on every adopted game's dependency tree before integration, and pinned upstream versions in the manifest (§3.1) so updates are a deliberate action, not silent drift.
- **Carried forward from the existing platform** (flagged in `info.md`, still unresolved): no rate limiting on `/api/auth/login`/`signup`, JWTs are long-lived with no revocation mechanism. Both are pre-existing gaps, not new to this design, but they block a real production launch and should be scheduled explicitly (see §10).

---

## 10. Development Milestones

**M0 — Platform reorg (1–2 weeks)**
Rename/relocate `backend/` → `platform/api/`, `frontend/` → `platform/web/`, no behavior change. Establishes the folder structure (§2) the rest of the plan builds on, with zero functional risk.

**M1 — Event Pipeline + SDK skeleton (2–3 weeks)**
Canonical event schema (§4), ingestion API, the SDK's `client/`/`host/` halves and the sandboxed-iframe boundary — validated with a trivial dummy plugin (a stub game emitting fake events), not yet a real game. Proves the boundary and pipeline before any real game complexity is in the mix.

**M2 — Adaptive AI Engine, modules 1–6 (3–4 weeks)**
Behavior Analysis, Memory Engine, Player Modeling, Pattern Recognition, Strategy Planner, Decision Engine — built and unit-tested against the dummy plugin from M1. Modules 7–10 (Difficulty Calibration, Opponent Personality, Long-Term Memory, Explainability) deliberately deferred — they're refinements on top of a working core loop, not blockers to proving the core loop works.

**M3 — First real plugin: TOSIOS (4–6 weeks)**
Vendor TOSIOS, build its adapter (§3.4), build its Decision Adapter (mapping abstract Decision Engine output to TOSIOS's actual legal actions). This is the first point real gameplay complexity meets the engine — budget the most schedule risk here.

**M4 — Remaining AI Engine modules + Player Dashboard (2–3 weeks)**
Difficulty Calibration, Opponent Personality, Long-Term Memory, Explainability. Ship the Player Card / Profile UI — first real user-facing payoff beyond "the AI plays differently."

**M5 — Production hardening (ongoing, can overlap M3/M4)**
Rate limiting, JWT revocation/refresh, event-log archival policy, plugin dependency audit process, AI Engine-specific observability (are its decisions actually adapting over time, not just "is the server up").

**M6 — Second plugin / marketplace groundwork**
Only after M3 proves the plugin pattern works end-to-end on a real third-party codebase. Candidate: KoalaTower, or revisit Suroi if licensing negotiation (flagged as an open item) has progressed.

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **TOSIOS's low upstream activity means we're on our own for its bugs/security issues.** | Medium — we inherit maintenance burden the original authors won't help with. | Accepted tradeoff, made explicit rather than discovered later: we're vendoring and actively maintaining our fork regardless (§3.4's adapter pattern assumes this). Budget real time for it in M3, don't assume "MIT + stars" means "someone else keeps it healthy." |
| **The sandbox boundary adds real latency to the AI's decision loop** (postMessage round-trip vs. a direct function call). | Medium for real-time games — could miss a frame budget. | Decision Engine must support a "last known good decision" fallback so a slow round-trip never blocks the game loop (already noted in the prior proposal, restated here since it's now load-bearing for the fairness architecture, not just a performance nicety). |
| **Cross-game profile mapping (per-game observation → canonical dimension) is subjective and easy to get wrong**, silently producing a bad AI read that *feels* wrong to players without an obvious bug to point to. | High — this is the actual product; getting it wrong is a product failure, not a crash. | Every profile dimension carries `confidence` explicitly (§5.3/§6) so low-quality mappings are visible and can be down-weighted rather than trusted blindly. Explainability Module (§5.10) doubles as an internal debugging tool for us, not just a player-facing feature — if we can't explain a decision, that's a signal the mapping is off. |
| **Vendoring a third-party codebase we didn't write is a bigger attack surface than code we authored.** | Medium. | Dependency audit before integration (§9), pinned versions, and the sandbox boundary limits what a compromised plugin can actually reach even if something slips through. |
| **"Fewer excellent games" means the whole platform's credibility rests on one launch title (TOSIOS) landing well.** | High — no portfolio effect to fall back on if it underwhelms. | Explicit tradeoff you asked for over "many average ones" — mitigation is schedule discipline (M3 gets the most buffer of any milestone) and treating WARDEN as a low-stakes internal fallback demo if TOSIOS integration runs long, not a second launch pillar. |
| **Pre-existing security gaps (no rate limiting, non-revocable JWTs) get inherited into a bigger, more valuable target.** | High once real usage exists. | Scheduled explicitly as M5, running in parallel rather than being an afterthought after everything else ships. |
| **Suroi licensing negotiation (open item from the prior proposal) may simply fail** (author says no, or wants unaffordable terms). | Low — doesn't block anything, since it was never on the critical path. | Already treated as optional/M6, not a dependency of the M0–M5 plan. No action needed now beyond keeping it on the list. |

---

## Final Game Selection Decision

Per "I prefer fewer excellent games rather than many average ones" — **TOSIOS is the sole launch plugin.** No second game is scheduled before M3 completes and the plugin pattern is proven on it. KoalaTower remains the documented fallback/next-candidate (§10 M6), not a parallel effort — splitting focus across two unproven integrations before either is proven doesn't serve "fewer, excellent" any better than launching with two average ones would.

Re-verified this session (not just carried over from the prior proposal):
- TOSIOS: confirmed MIT, confirmed real gameplay (deathmatch/TDM), confirmed server-authoritative (Colyseus) — the last point specifically re-confirmed as *why* it's still the right pick even knowing upstream activity has slowed to maintenance-mode. Low activity upstream is a real cost (noted in Risks) but not a disqualifier, since we take over active maintenance of our fork regardless.
- Suroi: re-confirmed GPL-3.0 with **no dual-licensing or commercial exception anywhere in the license text** — this closes the licensing question definitively rather than leaving it as an open question; a negotiated exception would require the authors' explicit agreement outside of anything visible in the repo today.

---

## Open Items Carried Forward

1. **Live status of the archived games** — `frontend/public/games/*.html` and the `/play/warden`/`/play/five` routes are currently still live and playable in the running app (see `archive/README.md`). Confirm whether they should stay reachable as the platform's only current content through M0–M2 (no playable AI-driven game exists yet during that window), or come down immediately.
2. **Suroi licensing outreach** — optional, non-blocking, tracked for M6 at earliest.
3. **`info.md` is now stale** relative to this pivot (still describes the game-centric framing). Not rewritten as part of this design doc — flagging so it doesn't quietly mislead anyone who reads it next.

No implementation begins until this is reviewed and approved.
