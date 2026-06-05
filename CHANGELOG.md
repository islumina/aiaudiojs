# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.2] - 2026-06-05

### Docs

- Review-driven documentation fixes (`README.md`, `README_ZHTW.md`, `llms.txt`, `llms-full.txt`; plus repo-only `CONTRIBUTING.md`): clarity and accuracy from a cross-package code review. No runtime or API change; `dist` byte-identical to 0.5.1.

## [0.5.1] - 2026-06-02

### Fixed

- **play() AbortSignal listener leak** — The `onAbort` listener added to `signal` in
  `Sound.play()` is now removed on natural sound end and on `stop` (Howler `end`/`stop`
  per-id events), not only when the signal fires. `{ once: true }` is also applied to
  the `addEventListener` call. Reusing a long-lived `AbortController` across many
  `play()` calls no longer accumulates listeners on the signal.

### Added

- **play() leak tests (D8, D9)** — Two new unit tests verify that after a play() whose
  sound ends or stops naturally (without the signal firing), no abort listener remains
  on the signal and a subsequent `.abort()` is a silent no-op.
- **visibilitychange-hidden test (A9)** — New test confirms that `visibilitychange` when
  the page is `hidden` does NOT call `Howler.ctx.resume()` (only `visible` should).
- **Multi-voice from test (G1)** — New equal-power test confirms that when `from` has
  two concurrent active voices, both are ramped by the crossfade.
- **fast-check upgraded to ^4.8.0** — Updated from ^3.23.0; all 61 tests remain green.
  No test-code changes required (fc API used — `fc.assert`, `fc.asyncProperty`,
  `fc.double` — is unchanged between v3 and v4).

### Changed (JSDoc / contract clarifications — no behavior change)

- **`Audio.load()` — F3 limitation documented:** abort after Howler's decode completes
  leaves a briefly-registered Sound that `disposeAll()` will reclaim; documented in
  JSDoc with guidance.
- **`Audio.crossfade()` — F2, F5, F9 contracts documented:**
  - F2: concurrent crossfades on the same Sound — old `AbortController` must not be
    fired once a new crossfade starts, or it overwrites the new schedule.
  - F5: equal-power crossfade assumes `from` is playing at masterVolume; a per-instance
    volume override causes a gain snap/click at the start.
  - F9: `rampSound` throwing mid-crossfade leaves `to` running silently — noted as a
    known defensive edge case.

## [0.4.0] - 2026-05-29

Dependency-reduction cycle release. **No runtime API change** — `src/index.ts` is
byte-identical to 0.3.0, so every existing `import` from `aiaudiojs` behaves exactly
as before.

### Changed (dependencies)

- **`howler` stays a required `peerDependency` (`^2.2.4`).** As the only ai\*js package
  with a runtime peer dependency, aiaudiojs is the flagship of the family v0.4.0
  dependency-reduction cycle. The A / B / C decision was evaluated against the live
  source: every public API — `load()` (`new Howl()`), `unlock()` (`Howler.ctx.resume()`),
  `volume` (`Howler.volume()`), `play` / `pause` / `stop` / `fade`, and both crossfade
  paths — is Howler-backed. There is **no Howler-free subset** to extract into a
  lightweight subpath, and a from-scratch Web Audio shim would have to re-own the iOS
  unlock / HTML5 fallback / sprite WebKit edge cases (and would not fit the 2 KB budget).
  So howler stays — see ["Why aiaudiojs"](README.md#why-aiaudiojs) for the full
  rationale. The honest dependency floor for this package is this one load-bearing peer.
- **devDependencies confirmed aligned to the ai\*js family standard** (biome, @types/node,
  @vitest/coverage-v8, tsup, tsx, typescript, vite, vitest, `pnpm@9.12.3`). `@types/howler`
  and `happy-dom` remain aiaudiojs-specific (Howler types + DOM test environment).
- **Lockfile deduped** (`pnpm dedupe`); **`pnpm audit` reports no known vulnerabilities**.
  Maintainer-side supply-chain hygiene only — devDependency transitives are not shipped
  to consumers.

### Stability

- **0.3.x crossfade surface frozen on the 1.0 track.** `crossfade('linear')` and
  `crossfade('equal-power')` are stable and will not change shape before 1.0; once 1.0
  ships they are frozen for the 1.x line. See [STABILITY.md](STABILITY.md).
- Spatial audio (PannerNode / HRTF) remains **experimental**, deferred to v0.7; its API
  surface is still undefined and nothing is implemented this cycle.

### Decisions

- **No runtime API addition.** This is a deliberate dependency-hygiene + stability-freeze
  release, not a feature release. The family lands on a unified 0.4.0 version line; the
  CHANGELOG is kept honest rather than padded with non-features.
- **Direct 0.4.0 minor, no patch-step.** Patch-stepping is reserved for de-risking
  changes that touch the public surface; this release touches none, so it lands straight
  on 0.4.0.

## [0.3.0] - 2026-05-29

### Added

- **`CrossfadeCurve` type** — `'linear' | 'equal-power'` exported from `aiaudiojs`.
- **`CrossfadeOptions.curve?`** — optional fade-curve selector. Default `'linear'` preserves 0.1.1 behaviour byte-for-byte for every existing caller.
- **equal-power crossfade path** — `crossfade({ curve: 'equal-power' })` schedules perceptually-flat sin/cos ramps (scaled by master volume) **directly on each sound's Web Audio GainNode** (`_node.gain`) via `setValueCurveAtTime`: the outgoing sound follows `cos` (mv → 0), the incoming follows `sin` (0 → mv), so `sin² + cos² = 1` holds the perceived loudness flat through the transition. `Howl.fade()` is NOT invoked in this path. Terminal state matches the linear path (outgoing at 0, incoming at master volume).
- **64-sample sin/cos curves** — built lazily on first equal-power call, shared as module-scope `Float32Array` singletons across all `Audio` instances.
- **`STABILITY.md`** — new file documenting stability guarantees per feature.

### Decisions

- **0.2.0 version skipped.** This release is tagged `0.3.0` to align with the cross-package `v0.3.x` limitation cycle. All sibling packages (`aifsmjs`, `aiecsjs`, `aibridgejs`, `aieventjs`, `aipooljs`, `aiquadtreejs`) are simultaneously shipping 0.3.x. Shipping `0.2.0` in isolation would break the ecosystem's unified versioning signal.
- **Backward compatibility.** Not passing `curve` (or passing `curve: 'linear'`) routes to the original linear path — code is byte-identical to 0.1.1. No existing caller is affected.
- **Scheduled on Howler's own per-sound GainNode, not an overlay.** Howler routes each Web Audio sound as `bufferSource → sound._node (GainNode) → Howler.masterGain`, so `_node.gain` already is the per-sound volume param. The equal-power path schedules the sin/cos curve straight onto it — the same node Howler's own `fade()` uses — rather than inserting and re-routing additional GainNodes. This keeps the shell inside its original **2 KB gzip budget** (no bump needed) and avoids any routing teardown.
- **Three pre-release defects caught and fixed (never shipped).** An earlier overlay design (insert `gainA`/`gainB`, re-route `_node` through them) was found — verified against Howler's source — to be broken three ways: (1) the incoming track was double-attenuated to permanent silence (`to.play({volume:0})` upstream of the overlay), (2) the outgoing track jumped back to full volume when routing was restored, and (3) `from` was re-played, layering a duplicate voice. Scheduling directly on `_node.gain` (above) is correct by construction and eliminates all three.
- **`Howl.fade()` not called in equal-power path.** The two curve paths are mutually exclusive; equal-power owns the gain schedule for the duration of the crossfade.

## [0.1.1] - 2026-05-28

### Changed (CI)

- **`publish.yml` now triggers on `push: tags: ["v*"]`** (was `workflow_dispatch` only). Aligns with the trigger used by `aifsmjs` / `aiecsjs` / `aibridgejs`. Tag push now automatically runs the OIDC trusted publish.
- **`npm publish --provenance --access public`** — the workflow now emits a [sigstore provenance attestation](https://docs.npmjs.com/generating-provenance-statements) so consumers can verify the tarball was built by this workflow on this commit.

No runtime / source / API changes from 0.1.0. **0.1.1 is also the first version to actually land on npm — 0.1.0 was tagged in git but never published to npm.** Production bundles are byte-identical to the 0.1.0 git tag.

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
