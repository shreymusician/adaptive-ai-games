# @adaptive-ai/tosios-adapter

The Plugin Adapter + Decision Adapter for TOSIOS (`../upstream/`, vendored unmodified from [halftheopposite/TOSIOS](https://github.com/halftheopposite/TOSIOS), MIT). Translates TOSIOS's real, observable Colyseus server state into canonical platform events, and translates Decision Engine `Action`s back into TOSIOS's own existing input path. **Contains no AI logic** — every function here is a deterministic translation, never a decision.

See `../PHASE_10A_REPORT.md` for the full architecture analysis, event/action mapping tables, and known findings. This file covers only how to build/test/extend this package.

## Status

Phase 10A: adapter layer built and tested against real TOSIOS game logic. **Not yet connected to a live server or the rest of the AI pipeline** — see the report's §8/§9 for what Phase 10B needs to do first.

## Build

```
npm run build
```

This first compiles the vendored subset of TOSIOS this package needs (`npm run build:vendor` — see `tsconfig.vendor.json` and `scripts/build-vendor.js`, and the report's §3.1 for why this step exists), then runs this package's own strict `tsc -b`.

## Test

```
npm test
```

Runs `build:vendor` first, then the real test suite (42 tests) — every test in `event-deriver.test.ts`/`decision-adapter.test.ts`/`integration.test.ts` runs against a genuinely instantiated, unmodified TOSIOS `GameState` (`__tests__/fixtures.ts`), never a mock of TOSIOS's own logic.

## Extension guide

- **New canonical event mapping**: add a pure function to `event-mapping.ts`, then either (a) call it from `event-deriver.ts`'s `captureMessage` if TOSIOS already broadcasts a `MessageJSON` for it, or (b) add a diff check to `diffTick` if it only ever shows up as a public schema field changing.
- **New legal action**: add a builder to `action-mapping.ts` (with real tags from `@adaptive-ai/decision-engine`'s consideration files — never invented), then handle its id in `decision-adapter.ts`'s `applyDecision` and offer it conditionally from `getLegalActions`.
- **Pulling an upstream TOSIOS update**: re-vendor into `../upstream/` (see its `PROVENANCE.md`), update the commit hash there, then re-run `npm run build:vendor` and the test suite — any behavior change TOSIOS itself made will surface as a test failure here, not a silent divergence.
- **Never** edit anything under `../upstream/` — if a fix is needed, it belongs in this package (see the report's §4.1–§4.3 for why every current hook point avoids needing to).
