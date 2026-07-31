# Adaptive AI Gaming Platform — Architectural Redesign Proposal

**Status:** Research complete. No implementation has been started. This document is for review and approval before any code is written.

**Scope:** Per direction change — stop building original games; adopt existing high-quality open-source games and inject a reusable, platform-wide Adaptive AI Engine into them. The AI is the product; the games are the medium.

---

## 0. Existing Codebase — What We're Building On

Before proposing changes, here's what already exists and what of it survives the pivot.

| Layer | Current State | Fate Under New Direction |
|---|---|---|
| Auth (email/password + Google OAuth, JWT, bcrypt) | Built, working, verified end-to-end | **Keeps.** Account system is orthogonal to which games run on the platform. |
| `Player` model (MongoDB/Mongoose) | Email, name, passwordHash, googleId | **Extends.** Becomes the root of the new `PlayerProfile` (see §8). |
| `GameMemory` / `GameSession` models | Keyed by `playerId` + `gameType`, opaque `data: Mixed` blob | **Replaced.** Opaque blobs can't support cross-game analysis or a queryable behavioral profile — needs a structured schema (§10). |
| Express API surface (`/api/memory/:gameType`, `/api/match`, `/api/stats/:gameType`) | Simple CRUD, JWT-protected, correctly scoped per-user | **Superseded** by an event-ingestion API (§11) — the platform needs to receive *streams* of gameplay events, not just final "did you win" summaries. |
| React shell (routing, `AuthContext`, `ProtectedRoute`, `LandingPage`) | Built, working | **Keeps.** Becomes the game-launcher/profile-dashboard shell. |
| WARDEN / THE FIVE (standalone HTML5 Canvas games, iframe-embedded) | Working tech demos, bugs fixed last session | **Frozen as proof-of-concept.** Not deleted, not iterated on further. They remain useful as a reference implementation of "what an adaptive opponent feels like," and as a first (already-working) test bed for the new Adaptive AI Engine once it exists — since we own their source outright, they're actually the *easiest* possible integration target to validate the engine against before tackling a third-party codebase. |

**Recommendation:** keep WARDEN as **Plugin #0** — the first game wired into the new Adaptive AI Engine — purely as an integration test, before attempting a harder third-party codebase. It's a known quantity with zero licensing risk and we already understand its event surface completely.

---

## 1. Recommended Browser Games to Adopt

I evaluated candidates across genres (shooter, battle royale, MMORPG, racing, tower defense, deckbuilder, bomberman-style arena), verifying license and activity **directly against each repository** rather than trusting search-engine summaries — two of the initial search results were wrong about licensing (BrowserQuest was reported as "MIT," it's actually MPL-2.0; Suroi was reported as "MIT," it's actually GPL-3.0). This matters: a wrong license call here is a legal liability, not a technicality.

### Tier 1 — Recommended

| Game | Repo | Verdict |
|---|---|---|
| **TOSIOS** (The Open-Source IO Shooter) | [halftheopposite/TOSIOS](https://github.com/halftheopposite/TOSIOS) | **Primary recommendation.** MIT license, clean TypeScript monorepo, real deathmatch/team-deathmatch gameplay already shipped, PixiJS client + Colyseus authoritative server — the server-authoritative model is exactly what a "never cheats, never reads hidden state" AI opponent needs (see §7's fairness boundary). |

### Tier 2 — Viable but smaller

| Game | Repo | Verdict |
|---|---|---|
| **KoalaTower** | [Shik3i/KoalaTower](https://github.com/Shik3i/KoalaTower) | MIT, genuinely excellent architecture (game logic as pure functions, 400+ tests, clean render/logic separation) — but explicitly labeled alpha software with ~1 star / 0 forks. Effectively a solo project. Good as a second integration target once the engine is proven, not as a launch pillar. |

### Tier 3 — Excellent games, rejected on licensing

These would otherwise be strong picks. Listed so the decision is visible and revisitable (e.g. if direct licensing negotiation with the authors is ever on the table).

| Game | Repo | License | Why Rejected |
|---|---|---|---|
| **Suroi** (2D battle royale, surviv.io-inspired) | [HasangerGames/suroi](https://github.com/HasangerGames/suroi) | GPL-3.0 | Strong copyleft — a commercial closed platform built on GPL-3.0 code would need to release the *entire combined work's* source, including our AI engine, under GPL-3.0. Not compatible with a proprietary AI-engine business model. High code quality (TS, PixiJS, Bun, ~480 stars) otherwise makes this the best-in-class candidate. |
| **Mk48.io** (naval combat .io game) | [SoftbearStudios/mk48](https://github.com/SoftbearStudios/mk48) | AGPL-3.0 | Even stronger than GPL — AGPL's network clause means *running it as a hosted service* triggers the source-release obligation, not just distributing it. Also Rust/WebAssembly, which makes instrumenting gameplay events from our Node/TS AI engine significantly harder (no shared runtime to hook into directly; would require a custom WASM↔JS event bridge or protocol-level packet sniffing). Double disqualifier. |
| **Slay the Web** (Slay the Spire–style deckbuilder) | [oskarrough/slaytheweb](https://github.com/oskarrough/slaytheweb) | AGPL-3.0 | Same network-copyleft problem. Worth noting for its architecture, though: it's explicitly built as "a stable, UI-agnostic game engine with an example UI" — logic and rendering are fully decoupled. That's the right pattern for *our* plugin adapters (§5), even though we can't use this particular codebase. |
| **Kaetram** (BrowserQuest-derived MMORPG) | [Kaetram/Kaetram-Open](https://github.com/Kaetram/Kaetram-Open) | MPL-2.0 + a supplementary "Omnia Public License" | MPL-2.0 alone (file-level copyleft) would be workable — we could keep Kaetram's own files MPL-licensed while keeping our AI engine and new files proprietary. But Kaetram's added OPL clause requires visible credit *and* that any derivative stay open-source, which conflicts with a closed commercial platform. Also transitioning to maintenance-only cadence (updates every 2–4 weeks, no new content). |

### Rejected outright (tutorials / non-production)

| Game | Repo | Why Rejected |
|---|---|---|
| **javascript-racer** | [jakesgordon/javascript-racer](https://github.com/jakesgordon/javascript-racer) | MIT-licensed, 1.2k stars — but the author explicitly states in the README this is a teaching exercise, not "a project I plan on polishing into a finished state." Global variables, JS embedded directly in HTML, no AI opponents implemented (only mentioned as a "someday" item). Fails the "not a tutorial" bar by the author's own description. |
| **HTML5 Bombergirl** | [MattSkala/html5-bombergirl](https://github.com/MattSkala/html5-bombergirl) | MIT, and notably *already has AI bots* — good precedent for the genre. But built on Bower + EaselJS (both effectively dead tooling since ~2016), local-device-only multiplayer, no visible recent maintenance. Would require a near-total rewrite to bring current, which defeats the purpose of "adopt, don't rebuild." |

### Candidate comparison table (full criteria)

| Game | License | Stack | Activity | Code Quality | Build System | Integration Ease | AI Difficulty | Commercial OK? | Est. Effort |
|---|---|---|---|---|---|---|---|---|---|
| TOSIOS | MIT | TS, PixiJS, Colyseus, Node | Moderate (open issues/PRs) | Good — clean monorepo | Yarn workspaces, Docker | **Easy** — pure JS/TS, server-authoritative | **Low-Med** | ✅ Yes | 3–5 weeks |
| KoalaTower | MIT | Svelte 5, TS, PixiJS v8 | Low (alpha, tiny community) | Excellent (pure-fn systems, tests) | SvelteKit | Easy | Low | ✅ Yes, with community-risk caveat | 2–4 weeks |
| Suroi | GPL-3.0 | TS, PixiJS, Bun, uWebSockets | High (~480★, active) | Excellent | Bun/Vite | Easy technically | Low | ❌ No | N/A |
| Mk48.io | AGPL-3.0 | Rust/WASM, Yew | Moderate | Good | Cargo/Trunk | **Hard** (WASM boundary) | Med-High | ❌ No | N/A |
| Slay the Web | AGPL-3.0 | JS/TS, Astro | High (1,637 commits) | Excellent (engine/UI split) | Bun/Astro | Easy | Low (turn-based) | ❌ No | N/A |
| Kaetram | MPL-2.0 + OPL | TS | Low-moderate (maintenance mode) | Good | Node | Medium | Medium (MMO-scale state) | ⚠️ Conditional | N/A |
| javascript-racer | MIT | Vanilla JS/Canvas | None (frozen tutorial) | Poor (intentionally) | None | N/A — reject | N/A | N/A | N/A |
| Bombergirl | MIT | Vanilla JS, EaselJS, Bower | Stale | Fair, dated | Bower (dead) | Hard (dead tooling) | N/A — reject | N/A | N/A |

**Bottom line recommendation:** launch the new platform direction with **WARDEN (internal, Plugin #0) → TOSIOS (Plugin #1)**. Revisit Suroi if/when direct licensing terms can be negotiated with HasangerGames — it's otherwise the single best-fit candidate in this entire search.

---

## 2. Licensing Analysis

**Ground rule going forward:** every adopted game must carry MIT, Apache-2.0, or BSD (2/3-clause). No GPL/AGPL family, no "source-available with commercial restriction" licenses, no licenses with field-of-use restrictions. MPL-2.0 is a case-by-case maybe — its copyleft is file-level (only modified *files of the licensed project* must stay MPL; new files we write, including the entire AI engine, are unaffected) — but any additional supplementary license terms (like Kaetram's OPL) must be reviewed individually since they can smuggle in stronger obligations.

**Practical compliance mechanics for MIT/Apache/BSD adoptees:**
- Preserve the original LICENSE file and copyright notice inside the vendored game's directory.
- Keep a `THIRD_PARTY_NOTICES.md` at the platform root listing every adopted game, its license, and a link to the upstream repo — standard practice, low overhead, avoids any "where did this code come from" ambiguity later (including for investors/acquirers doing diligence).
- Track upstream via a git submodule or a vendored-with-patch-file approach (§12 touches on this) so security fixes upstream can be pulled in without losing our instrumentation patches.

---

## 3. Architecture Redesign

High-level shift: from "one repo, one app" to **platform core + swappable game plugins**, all feeding a single shared AI engine.

```
┌─────────────────────────────────────────────────────────────┐
│                        PLATFORM SHELL                        │
│   (React) Auth · Game Launcher · Player Dashboard · Profile  │
└───────────────────────────┬───────────────────────────────────┘
                             │
                 ┌───────────┴────────────┐
                 │     GAME PLUGIN HOST     │   (iframe or Web Worker
                 │   (loads one plugin at    │    sandbox per game)
                 │      a time, mediates)    │
                 └───────────┬────────────┘
                             │  standardized event contract (§5)
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐    ┌────────▼───────┐   ┌────────▼───────┐
│ Plugin: WARDEN│    │ Plugin: TOSIOS │   │ Plugin: (future)│
│  (ours, JS)   │    │ (adopted, TS)  │   │                 │
└───────┬──────┘    └────────┬───────┘   └────────┬───────┘
        └────────────────────┼────────────────────┘
                              │
                 ┌────────────▼─────────────┐
                 │   GAMEPLAY EVENT STREAM    │  (§9)
                 └────────────┬─────────────┘
                              │
                 ┌────────────▼─────────────┐
                 │   ADAPTIVE AI ENGINE       │  (§7 — the product)
                 │ Behavior Analysis          │
                 │ → Player Profile           │
                 │ → Strategy Planner         │
                 │ → Opponent Decision System │
                 └────────────┬─────────────┘
                              │  legal-action decisions only
                              │  (never direct state mutation)
                 ┌────────────▼─────────────┐
                 │   back into the game's own │
                 │   normal action-execution  │
                 │   system (§7 fairness       │
                 │   boundary)                 │
                 └───────────────────────────┘
```

This directly mirrors the pipeline you specified: **Game Plugin → Gameplay Event Stream → Adaptive AI Engine → Behavior Analysis → Player Profile → Memory Database → Strategy Planner → Opponent Decision System** — with one addition: a **fairness boundary** where the Decision System's output re-enters the game through the *same* action-execution path a human player's input would (§7). That boundary is what makes "never cheats" enforceable in code, not just a design intention.

---

## 4. Plugin System Design

Every adopted (or internally built) game becomes a **Game Plugin**: a self-contained package with a standard manifest and three integration surfaces.

### 4.1 Plugin manifest

```ts
interface GamePlugin {
  id: string;                    // "tosios", "warden"
  version: string;
  entryUrl: string;               // static asset path, served in sandboxed iframe
  eventSchemaVersion: string;     // which canonical event taxonomy version it targets
  supportsAIOpponent: boolean;
  license: { spdxId: string; noticeUrl: string };
}
```

### 4.2 The three integration surfaces

1. **Event Emitter (game → platform).** The plugin's own code is patched (a thin adapter layer, not a fork of core logic) to call a single injected function, `platform.emit(canonicalEvent)`, at meaningful gameplay moments. Canonical event taxonomy (§9) is shared across all plugins so the AI Engine never needs game-specific code.

2. **Decision Channel (platform → game).** For AI-controlled entities, the plugin exposes a narrow interface: `getLegalActions(entityId): Action[]` and `submitDecision(entityId, action: Action)`. Critically, this is the *same* interface the plugin's own input-handling code uses for human players — the AI Engine cannot call any other function, cannot write to game state directly, and cannot query anything the interface doesn't expose. This is enforced by running each plugin in a **sandboxed iframe with a `postMessage`-only bridge** to the platform shell — there is no shared JS heap, so "reach around the interface and poke at internals" is not physically possible, not merely discouraged by convention.

3. **Replay/Spectator Feed (optional, read-only).** The same event stream doubles as a replay format — useful for debugging the AI's decisions and, longer-term, a feature players might enjoy ("show me what it learned").

### 4.3 Why the sandbox boundary matters here specifically

You were explicit that the AI must never read hidden state or secretly gain stats. A convention ("please don't call that function") is not a guarantee. A `postMessage` iframe boundary *is* one — the AI Engine process literally cannot reach into the game's memory. This is the same threat model as "don't trust the client," applied to our own AI instead of external cheaters.

---

## 5. Adaptive AI Engine Architecture

The engine is a standalone service (own repo/package), consumed by every plugin identically.

```
GameplayEventStream
        │
        ▼
┌───────────────────┐
│ Behavior Analysis   │  stateless-ish stream processors, one per
│  (per-match)        │  behavioral dimension (aim, movement, timing…)
└─────────┬──────────┘
          ▼
┌───────────────────┐
│ Player Profile      │  running aggregate, updated incrementally
│  Updater             │  after every match (Bayesian-ish update, not
└─────────┬──────────┘  a full recompute — keeps it cheap)
          ▼
┌───────────────────┐
│ Memory Database      │  persisted profile + per-game observation log
└─────────┬──────────┘
          ▼
┌───────────────────┐
│ Strategy Planner     │  turns "player dodges left 70%" into an
│                       │  actionable *plan* ("bias ambush spawns right")
└─────────┬──────────┘
          ▼
┌───────────────────┐
│ Opponent Decision     │  per-tick/per-decision-point: given current
│  System               │  game state + plan + legal actions, choose one
└───────────────────┘
```

**Why split Strategy Planner from Decision System?** The Planner operates on a slower cadence (once per match, or every few seconds) and reasons about *tendencies* ("this player rushes low-HP targets"). The Decision System runs every game tick and reasons about *the current moment* ("is a low-HP target visible right now"). Conflating them either makes the AI too twitchy (recomputing full strategy every frame, expensive and incoherent) or too slow to react (only re-deciding once a match). Keeping them separate mirrors how a human "reads" an opponent over a match while still reacting to the immediate moment.

**Reused across every game:** Behavior Analysis, Player Profile Updater, Memory Database, and the Strategy Planner's core reasoning are all game-agnostic — they operate on the canonical event taxonomy (§9), not game-specific code. Only the **Opponent Decision System's action space** is game-specific (a "flank" decision means something different in TOSIOS vs. a bomberman-style game), so each plugin supplies a small **Decision Adapter** that translates an abstract intent (`{intent: 'flank', urgency: 0.7}`) from the shared Planner into that game's concrete legal action.

This is the "no duplicated AI logic" requirement made concrete: ~80% of the engine (analysis, profile, memory, planning) is shared; only the thin decision-adapter layer is per-game.

---

## 6. Player Profile

### 6.1 Dimensions tracked (per your list, organized into stable categories)

| Category | Dimensions |
|---|---|
| **Reflexes** | Reaction Time, Decision Speed, Mechanical Skill |
| **Precision** | Aim Accuracy, Pattern Repetition (how exploitable their timing is) |
| **Temperament** | Aggression, Risk Tolerance, Confidence, Panic Threshold |
| **Spatial habits** | Movement Style, Preferred Combat Distance, Preferred Routes, Escape Behavior, Exploration |
| **Tactical habits** | Favorite Weapons, Favorite Abilities, Offensive Habits, Defensive Habits, Target Prioritization |
| **Meta** | Strategic Skill, Preferred Playstyle (archetype label, e.g. "Ambusher"), Weaknesses, Strengths, Adaptability |

### 6.2 Representation

Each dimension is stored as **(value, confidence, sample size, last-updated)**, not a bare number — mirroring what the original games already did well (their `depth` metric, `1 - e^(-runs/k)`, expressing "how much the AI trusts this read"). That pattern generalizes cleanly to every dimension:

```ts
interface ProfileDimension {
  value: number;        // normalized 0–1 or a domain-specific unit (ms, px, etc.)
  confidence: number;   // 0–1, grows with sample size, decays slowly with disuse
  samples: number;
  lastUpdated: Date;
}

interface PlayerProfile {
  playerId: ObjectId;
  perGame: Record<gameId, GameSpecificProfile>;   // e.g. favorite weapon is per-game
  crossGame: Record<dimensionKey, ProfileDimension>; // reaction time generalizes
  updatedAt: Date;
}
```

Low-confidence dimensions should have **proportionally muted influence** on the Decision System — a brand-new player facing an AI with near-zero confidence in its read should feel a fair, "vanilla" opponent, exactly like WARDEN and THE FIVE's existing `depth` scaling already does. That design principle is one of the best things about the current tech demos and should carry forward unchanged.

---

## 7. Memory System Redesign

Two layers, matching the per-game vs. cross-game split:

1. **Per-game observation log** — raw-ish, high-volume, e.g. "match 4821: dodged left 8/11 times boss wound up." This is what individual games' Strategy Planners consult for game-specific tactics.
2. **Cross-game behavioral profile** — the distilled, generalized dimensions from §6, updated by *every* game the player touches, consulted by any game's Planner for the "meta" read (aggression, reaction time, risk tolerance transfer across genres even though "favorite weapon" doesn't).

Aggregation from (1) into (2) happens via a scheduled job (or event-driven on match-end) that maps each game's specific observations onto the canonical dimension taxonomy through a per-plugin **mapping table** — e.g., TOSIOS's "shots fired while retreating" maps to the canonical `riskTolerance` dimension with some weight; WARDEN's "swings into recovery window" maps to the same dimension with a different weight. This is how cross-game intelligence (§8) becomes possible without hand-writing bespoke logic for every game pair.

---

## 8. Cross-Game Player Intelligence

Once the mapping in §7 exists, a player-facing profile view becomes straightforward to produce — directly matching the example you gave:

```
Aggression: 84%
Reaction Speed: 182ms
Risk Taking: 91%
Exploration: 72%
Favorite Strategy: Ambush
Preferred Range: Close Combat
Accuracy: High
Decision Confidence: Medium
Adaptability: Excellent
```

This becomes a real platform feature (a "Player Card" page), not just internal AI fuel — reinforcing that the AI/profile *is* the product, visible and legible to the player, not a black box.

**Cold-start handling:** a player's first game ever contributes to the cross-game profile with low confidence; their second game (even a different genre) already benefits from the confidence the first game built in shared dimensions like reaction time and risk tolerance. This is the concrete payoff of building the engine platform-wide instead of per-game — day-one players of Game #2 already feel "known" if they've played Game #1.

---

## 9. Database Redesign

Moving from MongoDB's current opaque `GameMemory.data: Mixed` to a structured, queryable schema. Staying on MongoDB (Atlas) — no need to change database technology, the document model still fits well, but the schema needs real structure.

```
players                 (existing — extended, not replaced)
  _id, email, name, passwordHash?, googleId?, createdAt, updatedAt

playerProfiles           (NEW — replaces opaque GameMemory blobs)
  playerId, crossGame: { [dimensionKey]: ProfileDimension },
  perGame: { [gameId]: GameSpecificProfile }, updatedAt

gameplayEvents            (NEW — append-only event log, §11)
  playerId, gameId, matchId, seq, ts, type, payload, schemaVersion

matches                    (evolves current GameSession)
  playerId, gameId, opponentType: 'ai'|'human', outcome, duration,
  aiSnapshotId  (which profile-state version the AI used, for audit/replay)

games                       (NEW — plugin registry)
  gameId, name, version, license: {spdxId, noticeUrl}, entryUrl,
  eventSchemaVersion, active: boolean
```

**Indexing:** `gameplayEvents` needs a compound index on `{playerId, gameId, ts}` for the aggregation jobs, and probably a TTL or archival policy once volume grows (raw event logs are the highest-volume collection by far — see §12).

**Migration path from current schema:** `GameMemory`/`GameSession` data is low-value legacy (mostly our own test data at this point) — no complex migration needed, just a clean cutover once the new schema ships.

---

## 10. Event Pipeline Design

```
[Plugin, in sandboxed iframe]
   │  platform.emit(canonicalEvent)  — synchronous, in-memory
   ▼
[Plugin Host, in parent frame]
   │  postMessage batch, ~every 250ms or on buffer threshold
   ▼
[Platform Client SDK]
   │  batches, retries, backpressure-aware
   ▼
[Ingestion API]  POST /api/events/batch  (JWT-authenticated, per-match)
   │
   ├──▶ [gameplayEvents collection]  (raw log, append-only)
   │
   └──▶ [Behavior Analysis stream processors]  (near-real-time, in-process
         or a lightweight queue — Redis Streams or MongoDB Change Streams
         are enough at this scale; no need for Kafka yet)
              │
              ▼
        [Player Profile Updater]  → playerProfiles collection
```

### Canonical event taxonomy (starting set, extensible per-plugin)

`PlayerMoved`, `PlayerDamaged`, `PlayerHealed`, `PlayerDied`, `AbilityUsed`, `AbilityOnCooldownAttempt` (they mistimed it — valuable signal), `TargetAcquired`, `TargetSwitched`, `ItemPicked`, `MatchStarted`, `MatchEnded`, `DecisionPoint` (a moment the AI could have acted differently, for later evaluation of its own choices).

Every event carries `{playerId, gameId, matchId, seq, ts, type, payload}` — `payload` is game-specific but `type` is drawn from the shared taxonomy so Behavior Analysis processors don't need per-game branching for the common cases.

---

## 11. Scalability Considerations

- **Event volume is the real scaling concern**, not player count. A single active match can emit dozens of events per second. Batching client-side (§10) and writing in bulk server-side is required from day one, not an optimization to defer.
- **Behavior Analysis should be horizontally scalable and stateless per-batch** — each batch of events for a given match can be processed independently and the resulting deltas merged into the profile, rather than requiring a single process to hold "the" in-memory state for a match.
- **Raw event log growth**: plan for archival/rollup from day one — e.g., raw events older than 30 days get compacted into per-match summary documents, keeping the hot collection small. This also naturally bounds MongoDB Atlas costs.
- **AI Decision System latency budget**: if a game runs a real-time tick loop (like WARDEN/TOSIOS), the Decision System must return a choice within the game's frame budget or the plugin needs a "last known good decision" fallback — never block the game loop waiting on the AI Engine. For turn-based or discrete-decision games (bomberman-style, deckbuilders) this constraint relaxes significantly, which is a real argument for including at least one non-real-time genre in the roadmap (easier AI Engine latency profile to get right first).
- **Multi-region**: not a near-term concern given current scale, but the plugin-sandbox architecture (each game plugin is a static asset bundle) is CDN-friendly regardless, so this isn't foreclosed later.

---

## 12. Security Considerations

- **The fairness boundary (§5.3) is also a security boundary.** Sandboxed iframes with a `postMessage`-only bridge mean a compromised or malicious plugin (including a poorly-vetted third-party one down the line) cannot reach into platform state, and the AI Engine cannot reach into plugin internals. Same mechanism serves both "AI must not cheat" and "plugin must not exfiltrate other players' data."
- **JWT-authenticated event ingestion**, scoped per-match (a short-lived match token, not the long-lived session JWT, should authorize event submission — limits blast radius if a match token leaks, and lets us rate-limit per-match rather than per-account).
- **Server-authoritative game state remains mandatory** for any game with competitive stakes — this is exactly why TOSIOS (Colyseus, server-authoritative) is the stronger pick over a purely client-simulated game. If the *client* is the source of truth for HP/position/hits, a modified client can lie to our event stream and corrupt the AI's read of that player — not "the AI cheats," but "the AI gets fed cheated data," which is an equally real trust problem worth flagging even though it's the inverse of what you asked about.
- **Rate limiting and auth hardening** flagged in the existing `info.md` as a known gap (no throttling on `/api/auth/login`/`signup`) carries forward as a blocker for the new platform's production launch, not just a nice-to-have.
- **Vendored third-party code review**: before instrumenting any adopted game, do a basic security pass on its dependency tree (`npm audit` at minimum) — we're taking on their supply chain, not just their gameplay code.

---

## 13. Deployment Strategy

- **Plugin packages ship as static assets** (same pattern already proven with WARDEN/THE FIVE's iframe embedding) — served from the frontend's static host or a dedicated CDN-backed bucket as the plugin count grows, versioned by `gameId@version` path so multiple plugin versions can coexist during rollout.
- **AI Engine as its own deployable service**, not bolted into the main Express backend — it has a different scaling profile (CPU/memory bound by behavior analysis and profile updates) than the auth/API backend (I/O bound). Keeping them separate now avoids a painful split later. Communicates with the main backend via the shared MongoDB and/or an internal API — no need for a message broker at current scale, but the service boundary should exist from the start even if deployed on the same box initially.
- **Environment/config**: extends the existing `.env` pattern already in place (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `MONGODB_URI`) with per-plugin config (event schema version pins, feature flags per game).
- **Staged rollout per plugin**: each new game plugin gets its own feature flag, so WARDEN/TOSIOS/future games can be enabled independently without a platform-wide deploy gate.

---

## 14. Development Roadmap

**Phase 0 — Engine skeleton, validated against a known game (2–3 weeks)**
- Build the canonical event taxonomy, `gameplayEvents` schema, ingestion API, and a minimal Behavior Analysis pipeline.
- Wire WARDEN (Plugin #0) into it as the first integration test — replace its ad-hoc `mem` object with real calls into the new engine. Low risk (we own the code), immediately validates the whole pipeline end-to-end.

**Phase 1 — Player Profile + Strategy Planner (2–3 weeks)**
- Build the `playerProfiles` schema, the incremental profile updater, and a first version of the Strategy Planner for WARDEN specifically.
- Ship the "Player Card" UI (§8) — even single-game, it's a real user-facing payoff to point to.

**Phase 2 — First third-party plugin: TOSIOS (3–5 weeks)**
- Fork/vendor TOSIOS, build its plugin adapter (event emitter + decision channel), build its game-specific Decision Adapter.
- This is where the plugin *system* (not just the engine) gets proven — first time a game we didn't write is wired in.

**Phase 3 — Cross-game intelligence (2 weeks)**
- Build the per-game→canonical dimension mapping tables for both plugins.
- Validate that a player's WARDEN behavior measurably informs their day-one TOSIOS opponent, and vice versa.

**Phase 4 — Platform hardening (ongoing, parallel to above)**
- Rate limiting, event-log archival, plugin security review process, monitoring/observability for the AI Engine specifically (are its decisions actually adapting, or stuck — needs its own dashboards, not just server uptime).

**Phase 5 — Second and third third-party plugin**
- Revisit Suroi if licensing can be negotiated; otherwise KoalaTower is next in line, or a fresh search for a newly-released MIT game closer to launch time (this space moves fast — worth re-running the candidate search before committing).

---

## Open Questions for You

1. **Suroi licensing negotiation** — worth reaching out to HasangerGames directly, given it's otherwise the best-fit candidate found? Dual-licensing or a commercial exception isn't unheard of for solo/small-team OSS projects.
2. **How much of TOSIOS's existing gameplay do we keep vs. reskin?** Adopting the engine/architecture is one thing; whether the platform's identity wants "TOSIOS as-is with an adaptive AI" or a reskinned/renamed variant is a product call, not an engineering one.
3. **Priority order** — confirm Phase 2's target is TOSIOS specifically, or whether KoalaTower (smaller, but a non-real-time genre, which is a genuinely easier first third-party integration for the AI Engine's latency profile) should go first instead.

No implementation will begin until this proposal is reviewed and you confirm direction.
