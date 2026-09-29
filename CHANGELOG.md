# Changelog

All notable changes to aiaudiojs are summarized here. Older entries are intentionally compact so AI agents read current behavior first.

## [0.6.0] - 2026-09-29

### Breaking

- `Audio.crossfade()`: on normal completion both curves now stop the `from` voices that were playing when the call started, and the linear incoming fade covers only the voice the call starts, instead of leaving `from` at gain 0 forever (a looping track leaked and a later ping-pong crossfade ramped it back up); both curves now read Howler's `_sounds` for this, so an unsupported Howler shape throws `AudioError` on the linear curve too. Migration: if you relied on `from` playing on silently after the crossfade, call `from.play()` once the promise resolves (or crossfade back to it); after an abort nothing is stopped, so stop or re-fade `from` yourself.
- `Sound.fade()`: now rejects with `AudioError` when `from` or `to` is not a finite number in `[0, 1]` or `ms` is not a finite number `>= 0`, before `Howl.fade()` runs, and reports every failure as a rejection, because such values used to reach Web Audio and throw a raw `TypeError` after side effects (or were silently ignored by Howler above `1`). Migration: clamp volumes to `[0, 1]`, pass a finite `ms >= 0`, and handle failures with `.catch()` or `try { await sound.fade(...) }` instead of a synchronous `try`.
- `Audio.dispose()` / `Audio.disposeAll()`: an in-flight `load()` now rejects with `AudioDisposedError` and its Howl is unloaded at dispose time, instead of waiting for Howler's decode (which may never finish), so a decode failure after dispose also reports `AudioDisposedError` rather than `AudioError`. Migration: treat `AudioDisposedError` from `load()` as teardown, and match it wherever you matched `AudioError` for loads that can fail after dispose.

### Changes

- Added: `CrossfadeOptions.loop` (default `false`) starts the incoming voice looping on both curves; `crossfade(s, s)` is supported (the old voices of `s` stop at completion and the new one keeps playing).
- Changed: `AudioError` messages carry the `aiaudiojs: ` prefix (e.g. `aiaudiojs: cannot crossfade a disposed Sound`, `aiaudiojs: crossfade duration must be a finite number > 0`); match on the class plus a regex rather than the exact text.
- Changed: `dist/index.js` size budget raised from 2,500 B to 2,600 B (maintainer-approved for the 0.6.0 minor; measured 2,576 B after trimming) for fade validation, crossfade completion-stop and `loop`, `clampDelay`, and dispose-time load settling; itemised in `scripts/check-size.mjs`.
- Changed: the unit suites share one spec-faithful Howler mock (`test/howler-mock.ts`: play-lock queuing, the bare-`play()` resume branch, sync-emit and `ctx: null` modes, gain params that enforce the Web Audio curve-overlap and non-finite rules), and `pnpm typecheck` now really type-checks `test/`.
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
- Fixed: `package.json` `exports` nests `types` under `import` and `require` (`require.types` points at `dist/index.d.cts`), so `node16` / `nodenext` CommonJS consumers no longer hit TS1479; `verify-exports` walks nested conditions.
- Fixed: `Sound.fade()` and `crossfade()` delays above 2,147,483,647 ms no longer overflow `setTimeout` and fire at once; one `clampDelay` helper clamps every timer delay (about 24.8 days).
- Fixed: `Sound.play()` throws `AudioError` for a non-finite `rate` before starting a voice, instead of Web Audio throwing a raw `TypeError` after the voice had started.
- Fixed: a `play()` queued behind Howler's play lock and then rejected with `playerror` (HTML5 autoplay) no longer leaves its `play` listener on the Howl.
- Fixed: `crossfade()` with a missing or non-object options argument now rejects with `AudioError`, and a non-`Sound` `from` / `to` throws `AudioError`, instead of a raw `TypeError`.
- Fixed: a non-numeric master `volume` from an untyped JavaScript caller now normalises to `0` like `NaN`, instead of being stored as `NaN`.
- Fixed: `crossfade()`'s completion stop targets the outgoing voice ids captured when the call started, not the captured Howler `Sound` objects' current `_id`; Howler recycles an ended voice's object for the next `play()` with a fresh id, so a `from` voice that ended mid-crossfade and was replaced by a new `from.play()` used to have that new voice stopped at completion.
- Docs: the README / README_ZHTW sharp edge on late Howler `load` events after an abort now says they are ignored (true since 0.5.8); STABILITY.md gains a Behavioral Contract section (no dispatch queue, crossfade completion, timer clamp, error channels, disposal).

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
