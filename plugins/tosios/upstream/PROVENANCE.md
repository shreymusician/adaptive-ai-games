# Vendoring provenance

This directory is a byte-identical, unmodified copy of [halftheopposite/TOSIOS](https://github.com/halftheopposite/TOSIOS) (MIT licensed — see `LICENSE`), vendored for the Adaptive AI Platform's first game plugin integration (Phase 10).

- **Upstream repository:** https://github.com/halftheopposite/TOSIOS
- **Vendored commit:** `98de136e524d25c5877adc9523c9445bc2b4a262`
- **Upstream commit date:** 2025-12-21T17:07:25+01:00
- **Vendored on:** 2026-08-06
- **Excluded from vendoring:** `.git/` (history — this file is the provenance record instead), `images/` (README banner/screenshot assets, not functional code, not needed for server-side integration)
- **Verification:** `diff -rq` against a fresh clone of the above commit reports zero differences for every file under `packages/`.

Do not hand-edit any file under this directory. If a fix or upstream update is needed, re-vendor from a newer upstream commit and update this file's commit hash — see `plugins/README.md` for the expected `upstream/` / `adapter/` split this convention exists to preserve (adapter code lives in `../adapter/`, never here).
