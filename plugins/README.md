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

Empty. Per `PLATFORM_V2_DESIGN.md`'s development milestones and the approved implementation order, the first plugin (`tosios`) is integrated in Phase 10, only after the Plugin SDK, Event Pipeline, Memory Engine, Player Modeling, Pattern Recognition, Strategy Planner, Decision Engine, and Explainability have each independently passed testing.
