# plugins/

Each subdirectory here is one game plugin — a vendored third-party game (or an internally built one) wrapped in the Game SDK's three-surface contract (Events, Legal Actions, Metadata). See `PLATFORM_V2_DESIGN.md` §3 for the Plugin SDK specification and §3.4 for the adapter pattern used to integrate a third-party codebase without forking its core logic.

Expected structure per plugin (from `PLATFORM_V2_DESIGN.md` §2):

```
plugins/<plugin-id>/
├── upstream/     # unmodified-as-possible vendored source, tracked so upstream
│                 #   fixes are easy to pull
├── adapter/      # our event-emitter + decision-channel glue — the only code
│                 #   we intentionally diverge with
└── manifest.json # GamePluginManifest
```

## Status

**Phase 10A complete for `tosios`** — the real TOSIOS repository is vendored (`plugins/tosios/upstream/`, unmodified, see its `PROVENANCE.md`), and the Plugin Adapter + Decision Adapter are built and tested (`plugins/tosios/adapter/`, 42/42 tests passing against real TOSIOS game logic, zero upstream modifications). See `plugins/tosios/PHASE_10A_REPORT.md` for the full architecture analysis, event/action mapping tables, and known findings.

**Not yet done (Phase 10B):** connecting the adapter to a live Colyseus server, wiring it through the Event Pipeline/AI Orchestration/Decision Engine end-to-end, and running actual matches to observe adaptation. The Phase 10A report's §6 documents one genuine architectural finding (the SDK's per-plugin-mount model assumes one player per mount; TOSIOS is one room with many players) that needs resolving before that wiring can start.
