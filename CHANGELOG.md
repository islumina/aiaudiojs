# Changelog

All notable changes to aiaudiojs are summarized here. Older entries are intentionally compact so AI agents read current behavior first.

## [Unreleased]

- Documentation-only slimming pass: README, stability notes, review backlog, and LLM context were condensed without runtime/API changes.
- Known follow-up: consider guarding the late Howler `load` event after an aborted `load()`.

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
