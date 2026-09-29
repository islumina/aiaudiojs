# aiaudiojs Review

Current review state after the 2026-09-29 ai*js 0.6.0 pass. Historical fixed items were summarised to keep the repo lightweight.

## Current Known Issues / Backlog

| Priority | Area | Status | Notes |
| --- | --- | --- | --- |
| P3 | Multi-instance master volume | Documented | `Howler.volume()` is global, so multiple `Audio` controllers can overwrite master volume. Prefer one controller per app/scene. |
| P3 | Family numeric-validation rule outside `fade` / `crossfade` / `play` rate | Deferred | The ai*js 0.6.0 rule says a non-finite numeric argument reports `AudioError`, but three lenient paths remain: the master `volume` (option and setter) normalises `NaN` to `0` and clamps to `[0, 1]` (a documented, tested AUD-S-02 contract); `PlayOptions.volume` outside `[0, 1]` (including `NaN`) is silently ignored by Howler; non-integer sound ids are no-ops in Howler. deferred: each is a new throw on a previously lenient, documented path that the 0.6.0 decisions did not cover, and `play()` volume/rate ranges (`> 1`, `rate <= 0`) need a maintainer call on the contract to freeze at 1.0. Only the crashing case (a non-finite `rate`, which threw a raw Web Audio `TypeError` after the voice had started) was fixed in 0.6.0. |

## Fixed Summary

- Dispose and `disposeAll()` are idempotent, unload managed Howls, and reject every in-flight `load()` with `AudioDisposedError` immediately (0.6.0; earlier releases waited for Howler's decode, which may never finish).
- `load()` settles on the first of load / loaderror / abort / dispose and detaches every listener, so a late Howler `load` never adds an orphaned `Sound` (0.5.8); it also settles when Howler emits synchronously inside `new Howl()`.
- `unlock()` and equal-power crossfade treat Howler's `ctx === null` as "no AudioContext", and `unlock()` never throws synchronously.
- `resume()` filters ended voices, returns `-1` when nothing resumes, and never replays a voice whose `play()` is still queued behind the AudioContext; a queued play rejected with `playerror` no longer leaks its `play` listener (0.6.0).
- `Sound.play()` always starts a new voice, rejects a non-finite `rate` with `AudioError` before starting one (0.6.0), and its `signal` teardown reads the live loop flag and treats `playerror` as terminal.
- `Sound.fade()` rejects `AudioError` for `from` / `to` outside finite `[0, 1]` and for a non-finite or negative `ms`, before `Howl.fade()` runs, and never throws synchronously (0.6.0).
- Crossfade stops, when the duration elapses, the outgoing voices whose ids it captured before `to` started (ids, not Howler's recyclable `Sound` objects, so a `from` voice started mid-crossfade is left playing), scopes the linear incoming fade to the new voice, supports `crossfade(s, s)` and ping-pong crossfades, and adds `CrossfadeOptions.loop`; abort stops nothing (0.6.0).
- Every `setTimeout` delay goes through one `clampDelay` helper (2,147,483,647 ms), so huge fade / crossfade durations no longer fire at once (0.6.0).
- Equal-power crossfade applies master volume exactly once, schedules piecewise `linearRampToValueAtTime` ramps (no `setValueCurveAtTime` window for Howler's gain writes to collide with), freezes cleanly on abort even when the freeze throws, and reports a suspended context with its own `AudioError`.
- HTML5 fallback and unexpected Howler internals throw named `AudioError` rather than orphaning started voices; crossfade reads `from`'s voices before `to` starts (0.6.0).
- `crossfade()` reports a missing options argument or a non-`Sound` with `AudioError` instead of a raw `TypeError`, and every `AudioError` message carries the `aiaudiojs: ` prefix (0.6.0).
- `autoUnlock` listens on activation-triggering events (`touchend` / `pointerup` / `keydown`) and keeps retrying until `resume()` leaves the context running.
- `package.json` `exports` nests `types` under `import` / `require` (`require.types` → `dist/index.d.cts`), fixing TS1479 for `node16` / `nodenext` CommonJS consumers; `verify-exports` walks nested conditions and `test/exports.test.ts` type-checks both (0.6.0).
- The unit suites share one spec-faithful Howler mock (`test/howler-mock.ts`) with play-lock queuing, the bare-`play()` resume branch, sync-emit and `ctx: null` modes, and gain params enforcing the Web Audio curve-overlap and non-finite rules, with a regression test per finding above; `pnpm typecheck` covers `test/` (0.6.0).
- `dist/index.js` budget is 2,600 B for 0.6.0 (measured 2,576 B); the reasons are itemised in `scripts/check-size.mjs`.
- JSDoc for `PlayOptions`, `AudioOptions.volume`, `Audio.volume`, `CrossfadeOptions`, `Sound.resume`, `Sound.fade`, `Sound.dispose`, `Audio.dispose` / `disposeAll`, `Audio.load` and `Audio.crossfade` matches implemented behaviour.

## Verification Baseline

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm coverage`
- `pnpm verify:docs`
- `pnpm build`
- `pnpm verify:exports`
- `pnpm verify:llms`
- `pnpm check:size`
- `pnpm prepublishOnly` runs all of the above in CI order.
