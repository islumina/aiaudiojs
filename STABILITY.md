# Stability

aiaudiojs is on the ai*js 1.0-track surface. Public names remain stable unless a future major release says otherwise.

## Stable API

| Surface | Status | Notes |
| --- | --- | --- |
| `createAudio(options?)` | Stable | One controller over Howler's shared audio runtime. |
| `Audio.unlock()` | Stable | Best-effort resume for browser gesture gates. |
| `Audio.load(url, signal?)` | Stable | Rejects with `AbortError` on signal abort. |
| `Audio.crossfade(from, to, opts)` | Stable | `linear` default; `equal-power` requires Web Audio. |
| `Audio.disposeAll()` | Stable | Idempotent teardown for managed sounds/listeners. |
| `Sound` methods | Stable | `play`, `pause`, `stop`, `resume`, `fade`, `dispose`, `nativeHowl`, `disposed`. |
| Error classes | Stable | `AudioError`, `AudioDisposedError`. |

## Boundaries

- Howler remains the only peer runtime. This package does not replace Howler sprites, codecs, or HTML5 fallback behavior.
- Master volume is shared through Howler global state; multiple controllers can affect each other.
- `PlayOptions.volume` is per-play gain and defaults to `1`, not the controller master volume.
- `equal-power` crossfade uses Howler/Web Audio internals and may throw under HTML5 fallback.
- Aborted loads reject promptly, but a late Howler internal load event can still occur; dispose during scene teardown.
