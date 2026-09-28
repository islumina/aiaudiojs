# Changelog

All notable changes to aiaudiojs are summarized here. Older entries are intentionally compact so AI agents read current behavior first.

## [Unreleased]

- Fixed: `load()` now settles even when Howler emits `load` / `loaderror` synchronously inside `new Howl()` (buffer-cache hits, missing/unsupported codecs, `Howler.noAudio`) — the lifecycle listeners are now passed as constructor options so they are attached before Howler can emit.
- Fixed: `unlock()` and equal-power `crossfade()` now treat `Howler.ctx === null` (real Howler's "no AudioContext" value, not `undefined`) as no context; `unlock()` no longer throws synchronously under the HTML5 fallback, SSR, or a jsdom-style test environment.
- Fixed: `disposeAll()` now rejects an in-flight `load()` with `AudioDisposedError` and unloads its Howl, instead of letting it resolve a live `Sound` that no later `disposeAll()` could reclaim.
- Fixed: an equal-power `crossfade()` whose abort-time gain freeze throws (e.g. an engine that keeps an in-progress `setValueCurveAtTime` on `cancelScheduledValues`) now still settles the returned promise instead of hanging forever.
- Fixed: equal-power `crossfade()` now reports a suspended/not-running `AudioContext` with its own `AudioError` instead of the misleading "HTML5 fallback active" message.
- Fixed: `Sound.play()` now always starts a new voice via the `__default` sprite — a bare Howler `play()` no longer resumes (and clobbers the volume/rate/loop of) the one existing paused voice.
- Fixed: `resume()` no longer replays a voice whose `play()` is still queued behind the AudioContext (play-locked or not yet running), which used to register a second Howler start and orphan the first buffer source.
- Fixed: equal-power `crossfade()` now schedules its sin/cos ramps as piecewise `linearRampToValueAtTime` points instead of `setValueCurveAtTime`, so a Howler gain write during the ramp (`Sound.fade`, `resume`, a following linear `crossfade`, `nativeHowl.volume`/`mute`) no longer throws a raw `NotSupportedError`.
- Fixed: `play({ signal })`'s teardown now reads the live per-id loop flag instead of the flag captured at `play()` time, so flipping `loop` via `nativeHowl` after `play()` no longer tears down (or leaks) the abort wiring at the wrong moment; a per-id `playerror` (HTML5 autoplay rejection) is now also treated as terminal cleanup.
- Fixed: `autoUnlock` now listens on activation-triggering events (`touchend` / `pointerup` / `keydown`) instead of `touchstart`, and keeps retrying on every such gesture until `Howler.ctx.resume()` actually leaves the context running.

## [0.5.9] - 2026-06-29

- Fixed: `resume(id)` no longer replays stopped / naturally-ended pooled voices — the id path now shares the ended-voice guard with the no-arg path.

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
