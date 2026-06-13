# aiaudiojs Review

Current review state after the 2026-06-10 ai*js pass. Historical fixed items were summarized to keep the repo lightweight.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P2 | `load()` abort race | Open | If Howler emits `load` after an abort rejection, a `Sound` can briefly enter the managed set. Documented; next code pass should add a settled guard and detach listeners. |
| P3 | Multi-instance master volume | Documented | `Howler.volume()` is global, so multiple `Audio` controllers can overwrite master volume. Prefer one controller per app/scene. |
| P3 | Unlock event docs | Fixed in docs | README now lists the actual auto listeners: `touchstart`, `mousedown`, `keydown`. |
| P3 | `PlayOptions.volume` docs | Fixed in docs | Per-play volume defaults to `1`; controller master volume is applied by Howler globally. |

## Fixed Summary

- Dispose and `disposeAll()` are idempotent and unload managed Howls.
- `resume()` filters ended voices and returns `-1` when nothing resumes.
- Equal-power crossfade applies master volume exactly once and aborts Web Audio schedules cleanly.
- HTML5 fallback and unexpected Howler internals throw named `AudioError` rather than orphaning started voices.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:llms`
- `pnpm check:size`
