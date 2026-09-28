# aiaudiojs Review

Current review state after the 2026-09-28 ai*js pass. Historical fixed items were summarized to keep the repo lightweight.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P2 | Crossfade leaves the outgoing voice running at gain 0 | Open | Neither crossfade path stops `from` after the ramp; a looping outgoing voice plays silently forever and a later ping-pong crossfade ramps it back up (doubled/out-of-phase audio). Fix: capture and stop the ramped `from` voice ids on completion; scope the linear `to` fade to the new voice id instead of every pool voice. |
| P2 | `crossfade()` cannot produce a looping incoming track | Open | `to.play({volume:0})` always applies a per-id `loop(false)`, overriding even a Howl-level `nativeHowl.loop(true)`, and the started id is discarded. Fix: add a `loop` (and optionally `volume`) option to `CrossfadeOptions`, passed through to `to.play()`. |
| P3 | `Sound.fade` does not validate `from`/`to`/`ms` | Open | Unlike `crossfade`, non-finite values reach Howler's Web Audio calls and throw a raw `TypeError` instead of rejecting; huge `ms` overflows `setTimeout` and fires immediately. deferred: the fix changes `fade`'s public contract (rejecting inputs it silently accepted before) and also needs a shared timer-delay clamp with `crossfade`'s abort helper, so it needs its own reviewed change rather than a same-pass P3 patch. Fix: reject `AudioError` for non-finite/negative `from`/`to`/`ms` (matching `crossfade`'s wording) and clamp/chunk timer delays above 2^31-1 ms. |
| P3 | Howler mock fidelity gaps hide hotspot bugs | Open | The shared mocks diverge from real Howler 2.2.4 (always-async `load` emit, `ctx: undefined` instead of `null`, no `_playLock` queueing, no AudioParam curve-overlap rule, `play()` always creates a new voice), so several fixed hotspots (aiaudiojs-1, -2, -5, -6, -9, -10) and edge cases (dispose mid-load, dispose mid-crossfade, `crossfade(s, s)`, ping-pong crossfades, a throwing `onAbort`) have no regression coverage in the fast mock suite. deferred: extending the mock to be spec-faithful (sync-emit constructor mode, `ctx: null`, `_playLock` queueing, a curve-overlap-enforcing gain param) plus the full aiaudiojs-1..12 regression matrix is a standalone test-infrastructure project, not a same-pass patch. Fix: add the fidelity modes above, then backfill regression tests per finding. |
| P3 | Multi-instance master volume | Documented | `Howler.volume()` is global, so multiple `Audio` controllers can overwrite master volume. Prefer one controller per app/scene. |

## Fixed Summary

- Dispose and `disposeAll()` are idempotent and unload managed Howls.
- `resume()` filters ended voices and returns `-1` when nothing resumes.
- Equal-power crossfade applies master volume exactly once and aborts Web Audio schedules cleanly.
- HTML5 fallback and unexpected Howler internals throw named `AudioError` rather than orphaning started voices.
- `load()`'s settled guard (0.5.8) detaches both lifecycle listeners on the first of load/loaderror/abort, so a late Howler `load` after an already-rejected abort never adds an orphaned `Sound`.
- `load()` settles even when Howler emits `load`/`loaderror` synchronously inside `new Howl()` (buffer-cache hits, missing/unsupported codecs, `Howler.noAudio`).
- `unlock()` and equal-power crossfade treat Howler's `ctx === null` (not `undefined`) as "no AudioContext", and `unlock()` never throws synchronously.
- `disposeAll()` rejects an in-flight `load()` with `AudioDisposedError` instead of leaving an unreclaimable `Sound` behind.
- An equal-power crossfade abort whose gain-freeze throws still settles the returned promise instead of hanging forever.
- Equal-power crossfade reports a suspended/not-running `AudioContext` with its own `AudioError` instead of the misleading HTML5-fallback message.
- `Sound.play()` always starts a new voice — a bare Howler `play()` no longer resumes and clobbers the one existing paused voice.
- `resume()` no longer replays a voice whose `play()` is still queued behind the AudioContext, which used to double-start its buffer source.
- Equal-power crossfade schedules ramps as piecewise `linearRampToValueAtTime` points instead of `setValueCurveAtTime`, so mid-ramp Howler gain writes (fade / resume / a following crossfade) no longer throw `NotSupportedError`.
- `play({signal})`'s teardown reads the live per-id loop flag (not the flag captured at `play()` time) and treats a per-id `playerror` as terminal, so the abort wiring can no longer go stale or leak on an HTML5 autoplay rejection.
- `autoUnlock` listens on activation-triggering events (`touchend` / `pointerup` / `keydown`, not `touchstart`) and keeps retrying until `resume()` actually leaves the context running.
- JSDoc for `PlayOptions.volume`, `AudioOptions.volume`, `Audio.volume`, `CrossfadeOptions.signal`, `Sound.resume`, `Sound.dispose`, `Audio.dispose`/`disposeAll`, and the `load()` F3 remark now match implemented behaviour.

## Verification Baseline

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:docs`
- `pnpm verify:exports`
- `pnpm verify:llms`
- `pnpm check:size`
