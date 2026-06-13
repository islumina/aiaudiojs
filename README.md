# aiaudiojs

Thin Web Audio shell over Howler.js with ai*js lifecycle conventions: idempotent `dispose()`, `AbortSignal` support, explicit `unlock()`, and first-class `crossfade()`.

> **Status: 0.5.7 - stable 1.0-track surface.** Howler remains a peer dependency; the package ships the root entry only.

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

`autoUnlock` defaults to `true` and attaches `touchstart`, `mousedown`, and `keydown` listeners. Browsers still require the resume attempt to happen inside a real user gesture; call `audio.unlock()` from your first trusted UI event when in doubt.

## Core API

- `createAudio(options?)` returns an `Audio` controller. Options: `autoUnlock`, `volume`, `resumeOnVisibility`.
- `audio.unlock()` resumes Howler's shared `AudioContext`.
- `audio.load(url, signal?)` resolves to a reusable `Sound`; `AbortSignal` rejects with `AbortError`.
- `sound.play(options?)` returns Howler's numeric sound id. `PlayOptions.volume` is per-sound gain and defaults to `1`; the Audio instance master volume is applied globally by Howler.
- `sound.pause(id?)`, `sound.stop(id?)`, `sound.resume(id?)`, `sound.fade(from, to, ms, id?)`, `sound.dispose()`.
- `audio.crossfade(from, to, { duration, curve, signal })` supports `linear` and `equal-power`.
- `audio.disposeAll()` unloads every managed sound and removes unlock/visibility listeners.

## Sharp Edges

- Howler volume is global. Multiple `Audio` instances can overwrite each other's master volume; prefer one controller per app or scene.
- `load()` aborts unload the Howl and reject, but Howler may still emit a late internal `load` event after decode work has already started. If you abort uncertain loads, call `disposeAll()` during scene teardown.
- `equal-power` crossfade requires Web Audio mode and Howler internals with a gain node. HTML5 fallback throws `AudioError`; callers may retry with `linear`.
- The `linear` crossfade path delegates to `Howl.fade()`. Aborting clears this wrapper's timer, but Howler's internal ramp cannot be cancelled.
- URLs are passed directly to Howler. Validate untrusted URLs before calling `load()`.

## AI Context

- Short index: [`llms.txt`](llms.txt)
- Full generated context: [`llms-full.txt`](llms-full.txt)
- Stability contract: [`STABILITY.md`](STABILITY.md)
- Current review backlog: [`REVIEW.md`](REVIEW.md)
- Release history: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
