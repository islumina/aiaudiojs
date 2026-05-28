# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-28

### Added

- `createAudio({ autoUnlock?, volume?, resumeOnVisibility? })` — fully
  implemented factory; closure-based `Audio` handle; all methods
  destructurable without `this`.
- `audio.unlock()` — resumes `Howler.ctx` (best-effort); idempotent; swallows
  errors from already-running contexts.
- `audio.load(url, signal?)` — wraps `new Howl({ src: [url], preload: true })`
  in a `Promise`; resolves on `onload`, rejects with `AudioError` on
  `loaderror`, rejects with `DOMException("AbortError")` if `signal` fires.
- `audio.crossfade(from, to, { duration, signal? })` — linear-power crossfade
  using `Howl.fade()` on both ramps; resolves after `durationMs` via
  `setTimeout`. Aborting via `signal` clears the timer and resolves
  immediately; the in-progress Howler fade continues silently (Howler 2.x has
  no fade-cancel API). **Equal-power curve is planned for 0.2.0.**
- `Sound.play(opts?)`, `.pause(id?)`, `.stop(id?)` — delegate to Howler;
  `play` applies `volume`, `rate`, `loop` per-id and wires `signal` abort to
  `stop(id)`.
- `Sound.fade(from, to, ms, id?)` — delegates to `Howl.fade`; resolves after
  `ms` via `setTimeout`.
- `Sound.dispose()` / `Audio.dispose()` / `Audio.disposeAll()` — idempotent
  teardown; cascade-disposes Sounds; removes all `document` listeners.
- `sound.nativeHowl` — readonly escape hatch to the underlying `Howl`.
- `audio.volume` getter/setter — clamps to `[0, 1]`; propagates to
  `Howler.volume()`.
- Coverage thresholds tightened to 95/90/100/100 with happy-dom + Howler mock.
- Size budget tightened to 2 KB gzip (shell only; Howler stays external).
- `tsup.config.ts` now sets `minify: true`.
- `vitest.config.ts` now sets `environment: "happy-dom"`.
- `happy-dom ^15.0.0` added to `devDependencies`.

### Decisions / deviations

- **Linear-curve crossfade, not equal-power.** The README and 0.0.1 spec
  described equal-power crossfade via AudioContext `linearRampToValueAtTime`.
  However, Howler 2.x's `Howl.fade()` is a black-box ramp — it does not
  expose the curve or schedule it on the AudioContext timeline directly. Wiring
  `AudioContext.createGain()` + `linearRampToValueAtTime` would require
  bypassing Howler's mixing layer and is architecturally out of scope for a
  0.1.0 thin shell. **Shipping linear for 0.1.0; equal-power planned for
  0.2.0** (will require a GainNode path alongside Howler's mix).
- **Abort-during-crossfade resolves (not rejects).** Howler has no fade-cancel
  API. Clearing the `setTimeout` and calling `resolve()` is the honest
  maximum here. Documented in JSDoc.

## [0.0.1] - 2026-05-28

### Added (scaffold)

- Full package scaffold landed (`package.json`, `tsconfig.json`,
  `tsconfig.test.json`, `tsup.config.ts`, `vitest.config.ts`, `biome.json`,
  `scripts/{verify-exports,check-size,build-llms-full}.mjs`,
  `test/scaffold.test.ts`, `examples/.gitkeep`, `.github/workflows/{ci,publish}.yml`,
  `README.md`, `README_ZHTW.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  `LICENSE`, `llms.txt`, `llms-full.txt`).
- `src/index.ts` is a `throw` stub exposing the frozen 0.1.0 API surface
  (`createAudio`, `Audio`, `Sound`, `AudioOptions`, `PlayOptions`,
  `CrossfadeOptions`, `AudioError`, `AudioDisposedError`). The surface is
  deliberately narrower than Howler.js — only what the ai\*js convention
  needs plus a `sound.nativeHowl` escape hatch (readonly property).
- `pnpm typecheck && pnpm lint && pnpm coverage && pnpm build &&
  pnpm verify:exports && pnpm verify:llms && pnpm check:size` walks clean
  against a single placeholder test.
- Howler.js declared as a required `peerDependency` (`^2.2.4`); also added
  to `devDependencies` so typecheck / build resolves the types locally.
  Not optional — aiaudiojs has nothing to do without it.
- Coverage thresholds temporarily set to `0/0/0/0`; tightened to
  `95/90/100/100` in 0.1.0 with real tests (vitest-environment-happy-dom or
  similar for the AudioContext shim).
- Size budget temporarily set to 3 KB gzip; tightened to the 2 KB shell
  target in 0.1.0 (this is the shell only — Howler.js is the user's deps
  graph, not ours).
- Publish workflow exists but trigger is `workflow_dispatch` only — no
  accidental npm release on tag push until 0.1.0.

### Planned for 0.1.0

- `createAudio({ autoUnlock?, ... })` factory producing an idempotent
  `Audio` handle.
- `audio.unlock()` — bind once to first user gesture (touchstart / mousedown /
  keydown), call `Howler.ctx.resume()`, detach listeners. Idempotent.
- `audio.load(url, signal?)` — wraps `new Howl({ src: [url] })` in a promise
  resolving when `onload` fires; `signal` aborts mid-load.
- `Sound.play(opts?)` returning Howler's sound id so multiple concurrent
  plays of the same buffer are tracked.
- `audio.crossfade(from, to, { duration, signal? })` — first-class
  equal-power crossfade scheduled on the AudioContext timeline (not
  `setInterval`), with `AbortSignal` cancellation.
- `audio.disposeAll()` + per-Sound `dispose()`; both idempotent;
  post-dispose calls throw `AudioDisposedError`.
- `sound.nativeHowl` escape hatch (readonly property) for Howler advanced API.
- iOS Safari unlock retry on `visibilitychange` — best-effort, not a
  WebKit fix (those edge cases are upstream).

### Decision log (carried over from LEARNINGS.md v0.3.0 cycle 預備區)

- **Not a Howler.js fork.** Howler is MIT but its 9.7 KB gzip already
  delivers iOS unlock, HTML5 fallback, spatial, and sprite. Forking the
  13-year-old iOS unlock pipeline would burn weeks for no real gain.
- **Not from-scratch on raw Web Audio.** Same reason: iOS edge cases are
  WebKit-bound; rewriting them would not fix them.
- **Yes: peerDependency thin shell.** The ~1.5–2 KB shell delivers the
  ai\*js conventions Howler doesn't (`dispose()` idempotency, AbortSignal,
  first-class `crossfade()`, named errors) while keeping the proven
  Howler runtime underneath.
