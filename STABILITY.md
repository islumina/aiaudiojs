# Stability

aiaudiojs is on the ai*js 1.0-track surface. Public names remain stable unless a future major release says otherwise.

## Stable API

| Surface | Status | Notes |
| --- | --- | --- |
| `createAudio(options?)` | Stable | One controller over Howler's shared audio runtime. |
| `Audio.unlock()` | Stable | Best-effort resume for browser gesture gates. |
| `Audio.load(url, signal?)` | Stable | Rejects with `AbortError` on signal abort and with `AudioDisposedError` when the controller is disposed mid-load. |
| `Audio.crossfade(from, to, opts)` | Stable | `linear` default; `equal-power` requires Web Audio. Stops the outgoing voices on completion; `opts.loop` loops the incoming voice. |
| `Audio.disposeAll()` | Stable | Idempotent teardown for managed sounds, in-flight loads and listeners. |
| `Sound` methods | Stable | `play`, `pause`, `stop`, `resume`, `fade`, `dispose`, `nativeHowl`, `disposed`. |
| Error classes | Stable | `AudioError`, `AudioDisposedError`. |

## Behavioral Contract

- Dispatch: aiaudiojs owns no event dispatcher and no mailbox. The callbacks it registers run inside Howler's own (deferred) event dispatch or the `AbortSignal`'s, and a call you make from one of your Howler or abort listeners runs immediately; nothing is queued. `dispose()` / `disposeAll()` always run immediately and are idempotent.
- Crossfade completion: both curves capture `from`'s playing voices before `to` starts and stop them when the duration elapses, unless `from` was disposed meanwhile. `crossfade(s, s)` stops the old voices of `s` and keeps the new one. The first of completion and abort wins; on abort nothing is stopped and the caller owns both voices.
- Timers: `Sound.fade()` needs a finite `ms >= 0`; `crossfade()` needs a finite `duration > 0` (seconds). A delay above 2,147,483,647 ms (about 24.8 days) is clamped when handed to `setTimeout`; there is no timer chaining.
- Errors: misuse is reported with `AudioError` and a message of the form `aiaudiojs: <subject> must be <constraint>`, checked before any side effect. `load()`, `unlock()` and `fade()` report every failure as a rejection. `play()`, `pause()`, `stop()` and `resume()` throw synchronously. `crossfade()` throws synchronously for a disposed controller, a disposed or non-`Sound` argument, an unexpected Howler shape and the `equal-power` Web Audio preconditions, and rejects for missing options, an invalid `duration` or an already-aborted signal.
- Disposal: `dispose()` / `disposeAll()` unload every managed `Sound` and reject each in-flight `load()` with `AudioDisposedError`, unloading its Howl.

## Boundaries

- Howler remains the only peer runtime. This package does not replace Howler sprites, codecs, or HTML5 fallback behaviour.
- Master volume is shared through Howler global state; multiple controllers can affect each other.
- The master `volume` (option and setter) normalises rather than throws: `NaN` and other non-numeric input become `0`, and values outside `[0, 1]` are clamped.
- `PlayOptions.volume` is per-play gain and defaults to `1`, not the controller master volume.
- `equal-power` crossfade uses Howler/Web Audio internals and may throw under HTML5 fallback.
- Aborted loads reject promptly and unload the Howl; a late Howler `load` event after the abort is ignored.
