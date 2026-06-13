# Changelog

All notable changes to aiaudiojs are summarized here. Older entries are intentionally compact so AI agents read current behavior first.

## [Unreleased]

## [0.5.8] - 2026-06-14

- Fixed: a late Howler `load` / `loaderror` firing after an aborted `load()` no longer adds an orphaned `Sound` to the managed set. `load()` now sets a settled guard and detaches both lifecycle listeners on the first of load/error/abort, so a post-abort event is a no-op.
- Documentation-only slimming pass: README, stability notes, review backlog, and LLM context were condensed without runtime/API changes.

## [0.5.7] - 2026-06-10

- Hardened disposal, resume, and crossfade documentation after the ai*js review wave.
- Clarified `AbortSignal` behavior, Howler peer expectations, and equal-power Web Audio requirements.
- Regenerated `llms-full.txt` from the canonical English docs.

## Older releases

- `0.5.6` added family-aligned SLSA/provenance metadata and release hygiene.
- `0.5.5` through `0.5.1` focused on docs accuracy, dispose semantics, paused-instance resume behavior, and crossfade edge cases.
- `0.4.0` declared the 1.0-track stability surface and kept Howler as the only peer/runtime dependency.
- `0.3.0` introduced equal-power crossfade.
- `0.1.x` established the root API: `createAudio`, `Audio`, `Sound`, `AudioError`, and `AudioDisposedError`.
