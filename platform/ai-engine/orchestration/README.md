# @adaptive-ai/orchestration

Phase 6.5 — the runtime workflow that connects the already-implemented AI
Engine modules together. Before this package existed, Event Pipeline, Memory
Engine, Player Modeling, and Pattern Recognition were each complete and
independently tested, but nothing called them in sequence: events were
stored and never analyzed. This package is that missing connective layer.

**This package performs no intelligence.** Every judgment call (a player's
aggression score, what counts as a pattern, an episode's salience) is made
entirely inside the module that owns it. This package only sequences calls,
isolates failures, and persists/publishes a record of what happened.

## Runtime architecture

```
Gameplay Events
      |
      v
Event Pipeline (POST /api/events/batch — auth, validation, dedup, storage)
      |
      v
OrchestratingEventProcessor (wraps EventProcessor; detects MatchEnded)
      |
      v
MatchOrchestrator.ingestEvent() -- per event, live during the match
      |
      v
MatchOrchestrator.completeMatch() -- once, on MatchEnded
      |
      +--> Memory Engine: commitMatch()          [fatal on failure]
      |         (Working Memory destroyed, Short-Term Memory persisted)
      |
      +--> Player Modeling: processMatch()        [isolated failure]
      |         (updates Semantic Memory, may store episodes)
      |
      +--> Pattern Recognition: processMatch()    [isolated failure]
      |         (reads Player Modeling's own-run result; tolerates null)
      |
      v
MatchProcessingReport
      |
      +--> ReportStore.save()          (durable, matchProcessingReports)
      +--> EventEmitter 'match:completed'  (published, in-process)
      +--> returned synchronously to the HTTP caller
      |
      v
Dashboard API (GET /api/dashboard/...) — proves the pipeline ran
```

## Orchestration workflow — deterministic execution order

1. Match ends (a `MatchEnded` canonical event is ingested)
2. Working Memory committed / Short-Term Memory stored — one atomic call
   into Memory Engine's own `commitMatch()`. **Fatal on failure**: nothing
   downstream has anything to read, so the error propagates immediately as
   `MemoryCommitFailedError` and no further stage runs.
3. Player Modeling executed — updates Semantic Memory, proposes/stores
   episode candidates as its own side effect.
4. Pattern Recognition executed — reads Player Modeling's own-run result
   (or `null`, an explicitly allowed input) and updates the pattern store.
5. Report persisted (`ReportStore`) and published (`match:completed` event).

No caller can reorder or skip a stage — `MatchOrchestrator.completeMatch()`
is the only entry point, and it always runs stages 2-4 in this exact order.

## API endpoints

Mounted by `OrchestrationStack` (this package's composition root):

**Event ingestion** (`eventRouter` — @adaptive-ai/event-pipeline's own
router, unmodified, wired to `OrchestratingEventProcessor` instead of a
plain `EventProcessor`):
- `POST /api/events/batch` — now returns an additional `orchestration` field
  (a `MatchProcessingReport`) whenever the submitted batch contained
  `MatchEnded`.
- `GET /api/events/match/:matchId`, `/player/:playerId`, `/game/:gameId`, `/replay`, `/health`, `/metrics` — unchanged.

**Dashboard read API** (`dashboardRouter`, this package):
- `GET /api/dashboard/players/:playerId/profile?gameId=`
- `GET /api/dashboard/players/:playerId/dimensions?gameId=`
- `GET /api/dashboard/players/:playerId/dimensions/:dimension/history?gameId=&limit=`
- `GET /api/dashboard/players/:playerId/patterns?gameId=&category=&state=&minConfidence=` (gameId required)
- `GET /api/dashboard/players/:playerId/patterns/:patternId/history?gameId=`
- `GET /api/dashboard/players/:playerId/episodes?gameId=&sortBy=`
- `GET /api/dashboard/matches/:matchId/report`
- `GET /api/dashboard/players/:playerId/reports?limit=`

## Integration tests

`src/__tests__/integration.test.ts` drives the full HTTP surface with
nothing bypassed — real auth (match-scoped JWT-like tokens), real rate
limiting, real validation, real storage, real orchestration, real dashboard
reads — against an in-memory `FakeDb` (no network access to a real `mongod`
in this sandbox; same convention every other AI-engine package already
uses). Covers: a full match end to end, a match split across three network
batches, and cross-match token isolation.

`src/__tests__/failure-handling.test.ts` verifies the isolation contract
directly: a thrown Player Modeling error still lets Pattern Recognition run
and memory commit stand; a thrown Pattern Recognition error doesn't hide a
successful Player Modeling result; a Memory Engine commit failure is fatal
but leaves in-process state intact for a safe retry.

## Performance report

From `src/__tests__/performance.test.ts` (see `src/__tests__/results/performance-results.json`
for raw numbers) — measured against the in-memory `FakeDb`, so these are
upper bounds on **application-logic** overhead, not real MongoDB I/O or HTTP
latency:

| Scenario | Result |
|---|---|
| Single match, 100/500/1000 events | Completes in single-digit milliseconds; per-event ingest cost does not grow with event count |
| 25 concurrent matches, 20 events each | All complete correctly with zero cross-contamination between players/matches |
| 50 sequential matches, 50 events each | Working/Short-Term Memory in-process maps return to size 0 after every match — no per-match leak |
| Database writes for one 17-event match | Exactly 1 `matchMemories` write, 1 `matchProcessingReports` write, append-only version counts ≥ current-pointer counts |

## Error recovery strategy

| Failure | Effect | Recovery |
|---|---|---|
| Memory commit fails | `completeMatch()` throws `MemoryCommitFailedError`; nothing downstream runs | In-process Short-Term Memory is untouched (Memory Engine's own `commit()` never partially applies) — the same `completeMatch()` call can be retried once the underlying issue clears |
| Player Modeling throws | Recorded as a `StageError`; Pattern Recognition still runs (with a `null` player-modeling result); report status is `partial` | Match memory and any Pattern Recognition output are already durable; a caller can re-run `playerModelingEngine.processMatch()` directly against the same `MatchMemoryRecord` to backfill |
| Pattern Recognition throws | Recorded as a `StageError`; report status is `partial` | Same backfill approach via `patternRecognitionEngine.processMatch()` |
| Both throw | Both errors recorded; memory commit still stands | Report status is `partial` with two `StageError` entries |
| An ingest-time event arrives after the match already completed | Logged and skipped for that one event; the rest of the batch is unaffected (events are already durably stored by the inner `EventProcessor` regardless) | N/A — by design, a completed match is never reopened via `ingestEvent`/`completeMatch` |

## Known limitations

- **Single-process pub/sub.** `MatchOrchestrator`'s `match:completed` event
  is a plain Node `EventEmitter` — it does not fan out across multiple
  server instances. A multi-instance deployment needs a real message broker
  (or every instance reading `ReportStore` on its own cadence) to observe
  completions raised by a sibling process.
- **No per-route authorization on the dashboard API.** Every dashboard route
  trusts `playerId` from the URL; nothing here verifies the requesting
  session actually belongs to that player. It is designed to sit behind
  whatever auth middleware the host app already applies (platform/api's
  session JWT) — adding a "does this session own this playerId" check is
  host-app policy, not this package's job, but it is not implemented
  anywhere yet.
- **At-least-once event ingestion, not exactly-once end to end.** The Event
  Pipeline's own per-match sequence-number dedup prevents the same event
  from being stored twice, but `MatchOrchestrator`'s own
  `completedMatchIds` set is in-process only — a process restart mid-match
  forgets which matches it already completed. Memory Engine's `matchMemories`
  unique index on `matchId` is the real backstop (a second `commitMatch()`
  for the same match fails loudly rather than double-writing), so this is
  safe, just not silent.
- **Pattern Recognition does not generate its own episodes yet.** Episode
  candidates in a `MatchProcessingReport` currently only ever come from
  Player Modeling's own heuristic (a notable dimension swing) — Pattern
  Recognition's README already flags richer, pattern-driven salience
  scoring as future work.
- **`OrchestratingEventProcessor` reconstructs events from the request body,
  not from storage.** This avoids an extra database round trip, and is safe
  because `validateBatch()` is provably all-or-nothing on schema errors
  (see its own doc comment in `orchestrating-processor.ts`), but it does
  mean a batch whose *storage* silently diverged from its *request body*
  (which should never happen — `EventProcessor` stores exactly what it
  received) would go undetected by this package specifically.
