# aiaudiojs

Thin Web Audio shell over Howler.js with ai*js lifecycle conventions: idempotent `dispose()`, `AbortSignal` support, explicit `unlock()`, and first-class `crossfade()`.

> **Status: 0.6.0 - stable 1.0-track surface.** Howler remains a peer dependency; the package ships the root entry only.

## Install

```bash
pnpm add aiaudiojs howler
```

```ts
import { createAudio } from "aiaudiojs";
```

## Quick Start

```ts
const audio = createAudio({ volume: 0.8 });

button.addEventListener("click", async () => {
  await audio.unlock();
  const laser = await audio.load("/sfx/laser.ogg");
  const id = laser.play({ volume: 0.5 });
  laser.fade(0.5, 0, 250, id);
});

window.addEventListener("beforeunload", () => audio.disposeAll());
```

`autoUnlock` defaults to `true` and attaches `touchend`, `pointerup`, and `keydown` listeners (activation-triggering events per the HTML spec — `touchstart` is not one, so browsers refuse `resume()` from it). Listeners stay attached, retrying on every such gesture, until `resume()` actually leaves the context running. Browsers still require the resume attempt to happen inside a real user gesture; call `audio.unlock()` from your first trusted UI event when in doubt.

## Core API

- `createAudio(options?)` returns an `Audio` controller. Options: `autoUnlock`, `volume`, `resumeOnVisibility`.
- `audio.unlock()` resumes Howler's shared `AudioContext`.
- `audio.load(url, signal?)` resolves to a reusable `Sound`; `AbortSignal` rejects with `AbortError`.
- `sound.play(options?)` returns Howler's numeric sound id. `PlayOptions.volume` is per-sound gain and defaults to `1`; the Audio instance master volume is applied globally by Howler. A non-finite `rate` throws `AudioError` before any voice starts.
- `sound.pause(id?)`, `sound.stop(id?)`, `sound.resume(id?)`, `sound.dispose()`.
- `sound.fade(from, to, ms, id?)` needs `from` / `to` as finite numbers in `[0, 1]` and `ms` as a finite number `>= 0`; otherwise the promise rejects with `AudioError`. It never throws synchronously. Delays above 2^31-1 ms (about 24.8 days) are clamped.
- `audio.crossfade(from, to, { duration, curve, signal, loop })` supports `linear` and `equal-power`. When `duration` (seconds) elapses it stops the `from` voices that were playing when it started. `crossfade({ loop: true })` starts the incoming voice looping. `crossfade(s, s)` restarts `s` under a crossfade.
- `audio.disposeAll()` unloads every managed sound, rejects in-flight loads with `AudioDisposedError`, and removes unlock/visibility listeners.

## Sharp Edges

- Howler volume is global. Multiple `Audio` instances can overwrite each other's master volume; prefer one controller per app or scene.
- An aborted `load()` rejects with `AbortError` and unloads the Howl; a late Howler `load` event after the abort is ignored, so no `Sound` is created.
- `equal-power` crossfade requires Web Audio mode and Howler internals with a gain node. HTML5 fallback throws `AudioError`; callers may retry with `linear`.
- The `linear` crossfade path delegates to `Howl.fade()`. Aborting clears this wrapper's timer, but Howler's internal ramp cannot be cancelled.
- Aborting a crossfade stops nothing: after an abort the caller owns both voices; stop or re-fade `from` yourself.
- URLs are passed directly to Howler. Validate untrusted URLs before calling `load()`.

## AI Context

- Short index: [`llms.txt`](llms.txt)
- Full generated context: [`llms-full.txt`](llms-full.txt)
- Stability contract: [`STABILITY.md`](STABILITY.md)
- Current review backlog: [`REVIEW.md`](REVIEW.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
