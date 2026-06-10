# aiaudiojs

[![npm version](https://img.shields.io/npm/v/aiaudiojs.svg)](https://www.npmjs.com/package/aiaudiojs)
[![CI](https://github.com/islumina/aiaudiojs/actions/workflows/ci.yml/badge.svg)](https://github.com/islumina/aiaudiojs/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)
[![AI Generated](https://img.shields.io/badge/AI_Generated-Claude_Code_Opus_4.7_Max-blueviolet.svg)](https://www.anthropic.com/claude-code)
[![繁體中文](https://img.shields.io/badge/lang-繁體中文-red.svg)](README_ZHTW.md)

> A thin Web Audio shell over [Howler.js](https://howlerjs.com/). Wraps `Howl` with `dispose()` idempotency, `AbortSignal` cancellation, first-class equal-power `crossfade()`, and the rest of the ai\*js conventions. Howler stays as a `peerDependency` and is reachable via `sound.nativeHowl` when you need its full surface.

Part of the [ai\*js micro-runtime ecosystem](https://github.com/islumina) — see also [aifsmjs](https://github.com/islumina/aifsmjs) (FSM), [aiecsjs](https://github.com/islumina/aiecsjs) (ECS), [aibridgejs](https://github.com/islumina/aibridgejs) (cross-context RPC), [aipooljs](https://github.com/islumina/aipooljs) (object pool), [aiquadtreejs](https://github.com/islumina/aiquadtreejs) (spatial), and [aieventjs](https://github.com/islumina/aieventjs) (event emitter).

> **Status: 0.5.7.** Full implementation live. `createAudio` / `load` / `play` / `pause` / `stop` / `resume` / `fade` / `crossfade` / `dispose` are all wired. Crossfade defaults to linear (backward-compat); opt in to equal-power via `{ curve: 'equal-power' }`. See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Why aiaudiojs

Web Audio on browsers is mature but the cliff is steep, and most of the cliff is iOS Safari. Howler.js has spent 13 years polishing the unlock flow, HTML5 fallback, sprite support, codec detection, and a global AudioContext lifecycle. Throwing that away to write our own is a bad trade. Three reasons to ship a shell instead:

- **Howler.js is MIT, 9.7 KB gzip, and already mature.** Even in its half-dormant 2024-onward state, the API is stable and the iOS unlock pipeline works for the happy path. Rewriting it from scratch would mean rediscovering the same edge cases.
- **The iOS Safari edge cases are WebKit-bound.** iOS 17.4+ regressions on HTML5 streaming, iOS 18 VoiceOver / Audio Ducking quirks, the "5-second relock" — these are WebKit bugs, not Howler bugs. A clean-room reimplementation would catch the same bugs in the same situations.
- **ai\*js conventions are what's missing, not the audio runtime.** `dispose()` idempotency, `AbortSignal` end-to-end, first-class `crossfade()` scheduled on the AudioContext timeline, named errors, typed events — these are ~2 KB of shell code, not 10 KB of runtime.

So `aiaudiojs` is **the ai\*js-shaped audio handle**:

- **Howler.js is a required peer dependency.** Users install both. The shell never bundles Howler.
- **`dispose()` is idempotent everywhere.** Top-level `audio.disposeAll()` and per-sound `sound.dispose()` are both safe to call any number of times; subsequent operations throw `AudioDisposedError`.
- **`AbortSignal` end-to-end.** `audio.load(url, signal)` aborts in-flight network; `sound.play({ signal })` stops the instance when the signal aborts; `audio.crossfade(a, b, { duration, signal })` resolves early on abort. On the default linear curve the underlying `Howl.fade()` ramps cannot be cancelled mid-flight (they continue silently; the promise just stops blocking you); the `equal-power` curve schedules on the AudioContext timeline and DOES cancel the in-flight ramp on abort (`cancelScheduledValues` then `setValueAtTime`).
- **First-class `crossfade()`.** Defaults to a linear-curve fade via `Howl.fade()`. Opt in to equal-power — a perceptually-flat sin/cos ramp on the `AudioContext` timeline via `GainNode.gain.setValueCurveAtTime` — with `{ curve: 'equal-power' }`, shipped in 0.3.0.
- **Escape hatch via `sound.nativeHowl`.** When you need Howler's sprite API, custom HTML5 element, or any advanced feature the shell deliberately doesn't expose.
- **iOS unlock retry on `visibilitychange`.** Best-effort fix for the "context suspends after background" pattern. Doesn't pretend to solve every WebKit bug.

What this is **not**: not a 3D spatial framework (Howler's spatial plugin exists; use it directly if you need it), not a synth / MIDI engine, not a sprite generator (use the `audiosprite` CLI), not an audio worklet host. The shell is deliberately narrow.

---

## Quick Start

```bash
pnpm add aiaudiojs howler
```

```typescript
import { createAudio } from "aiaudiojs";

const audio = createAudio({
  autoUnlock: true,        // bind to first user gesture; default true
  resumeOnVisibility: true, // best-effort iOS Safari recover
});

// 1. Load. Returns a Promise<Sound>; signal aborts mid-load.
const zap = await audio.load("zap.mp3");
const bgm1 = await audio.load("level1.mp3");
const bgm2 = await audio.load("level2.mp3");

// 2. Play. Returns Howler's sound id so you can target this instance later.
const zapId = zap.play({ volume: 0.8 });
bgm1.play({ loop: true });

// 3. Crossfade between two loaded sounds. Default curve is linear via
//    Howl.fade() on both ramps; pass `curve: 'equal-power'` for a
//    perceptually-flat sin/cos schedule on the AudioContext timeline.
await audio.crossfade(bgm1, bgm2, { duration: 2 });
await audio.crossfade(bgm1, bgm2, { duration: 2, curve: "equal-power" });

// 4. Escape hatch — reach into Howler for the advanced surface.
const howl = zap.nativeHowl;
howl.fade(1, 0, 500, zapId); // direct Howler call

// 5. Tear down.
audio.disposeAll(); // every sound this Audio created
```

---

## ⚠️ Audio unlock must happen inside a user gesture

> **Browsers (and iOS Safari especially) start the `AudioContext` _suspended_. It only resumes from inside a real user gesture — a `touchstart` / `mousedown` / `keydown` / `pointerdown` / `click` handler. Unlock MUST happen _inside_ that gesture handler, before your first `play()` — preloading with `load()` beforehand is fine, since `load()` only fetches and decodes and never resumes the context. Calling `play()` before the context is unlocked produces silence on iOS.**

Two ways to satisfy the rule:

- **`autoUnlock: true` (default).** `createAudio` binds a one-shot `touchstart` / `mousedown` / `keydown` listener on `document` that calls `Howler.ctx.resume()` on the first gesture, then detaches itself. For most apps this is all you need — but the gesture still has to come from the **real user**, so don't expect sound from `play()` calls made before the user has interacted (preloading with `load()` is fine).
- **`autoUnlock: false` + manual [`audio.unlock()`](#api-sketch).** Wire your own gesture handler and `await audio.unlock()` inside it when you control the first interaction (e.g. a "Tap to start" screen). `unlock()` is idempotent — but call it _inside_ the gesture handler (as below): it asks the browser to resume the context once, and a call made outside a gesture is ignored, so the unlock must ride a real interaction.

```typescript
// Manual unlock from your own "Tap to start" button.
const audio = createAudio({ autoUnlock: false });

startButton.addEventListener("pointerdown", async () => {
  await audio.unlock();              // inside the gesture, before any play()
  const bgm = await audio.load("title.mp3");
  bgm.play({ loop: true });
});
```

`resumeOnVisibility: true` (default) additionally re-attempts `resume()` when the tab returns to the foreground — a best-effort fix for the iOS "context suspends after backgrounding" pattern. It is **not** a substitute for the initial gesture; the first unlock still has to ride a user interaction.

See [`AudioOptions.autoUnlock`](#api-sketch) and [`Audio.unlock()`](#api-sketch) for the precise contract; full JSDoc is in [`src/index.ts`](src/index.ts).

---

## Capabilities / Limitations

| Will do (v1)                                              | Won't do                                              |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `createAudio({ autoUnlock, volume, resumeOnVisibility })` | Multi-AudioContext orchestration (Safari caps at 4)   |
| iOS unlock on first user gesture                          | Solve WebKit bugs we don't own (#1744 etc.)           |
| `load(url, signal)` with abort support                    | Worker-side audio decode (no `OfflineAudioContext`)   |
| `play / pause / stop / fade` per Sound                    | Audio worklets / DSP graph composition                |
| `crossfade()` (linear default + equal-power opt-in)         | MIDI / synth / oscillator-driven sound              |
| `dispose()` idempotent; post-dispose throws               | 3D spatial (use Howler's spatial plugin directly)     |
| `sound.nativeHowl` escape hatch (readonly property)       | Sprite generator CLI (use `audiosprite`)              |
| Howler as `peerDependency`                                | Bundling Howler (keep it in user's deps graph)        |

---

## API sketch

```typescript
import type { Howl } from "howler";

interface AudioOptions {
  autoUnlock?: boolean;        // default true
  volume?: number;             // master, default 1
  resumeOnVisibility?: boolean; // default true
}

interface PlayOptions {
  volume?: number;
  rate?: number;
  loop?: boolean;
  signal?: AbortSignal;
}

type CrossfadeCurve = "linear" | "equal-power";

interface CrossfadeOptions {
  duration: number;            // seconds
  signal?: AbortSignal;
  curve?: CrossfadeCurve;      // default "linear" (backward-compat)
}

interface Sound {
  play(opts?: PlayOptions): number;
  pause(id?: number): void;
  stop(id?: number): void;
  fade(from: number, to: number, ms: number, id?: number): Promise<void>;
  dispose(): void;
  readonly nativeHowl: Howl;
  readonly disposed: boolean;
}

interface Audio {
  unlock(): Promise<void>;
  load(url: string, signal?: AbortSignal): Promise<Sound>;
  crossfade(from: Sound, to: Sound, opts: CrossfadeOptions): Promise<void>;
  volume: number;
  dispose(): void;
  disposeAll(): void;
  readonly disposed: boolean;
}

class AudioError extends Error {}
class AudioDisposedError extends Error {}

function createAudio(opts?: AudioOptions): Audio;
```

Full JSDoc lives in [`src/index.ts`](src/index.ts).

---

## Recipe: ship audio before your assets exist (app-side placeholder)

Sometimes the game loop is ready before the sound designer is — you want a
"feedback beep" on hit/score _today_ and you'll swap in the real `.mp3` later.

aiaudiojs deliberately **does not** ship a built-in synth or oscillator —
MIDI / synth / oscillator is an explicit [non-goal](#capabilities--limitations).
But you don't need one in the library: the same Web Audio context Howler
uses is reachable through `Howler.ctx` (unlocked by that first user gesture), so a placeholder tone is
~10 lines of **your own app code** using the standard
[`OscillatorNode`](https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode).
Later, when the asset exists, you `load()` it and play through aiaudiojs (or
reach the underlying Howl via the [`sound.nativeHowl`](#api-sketch) escape
hatch) — and you delete the placeholder.

> **This is application-side code, not a library feature.** aiaudiojs adds
> nothing here; the snippet below lives in _your_ project. It is shown only so
> the unlock + AudioContext story is end-to-end.

```typescript
import { createAudio } from "aiaudiojs";
import { Howler } from "howler"; // already your peer dependency

const audio = createAudio({ autoUnlock: true });

// --- APP-SIDE placeholder. Not part of aiaudiojs. Delete once real SFX land.
// Plays a short beep on the SAME AudioContext aiaudiojs/Howler uses, so once
// the user gesture unlocks it the beep inherits it — no second context, no extra unlock.
function beep(freq = 440, ms = 80, gain = 0.2): void {
  const ctx = Howler.ctx;          // shared context (suspended until a gesture resumes it)
  if (!ctx) return;                // HTML5-fallback mode: no Web Audio context
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(ctx.destination);
  const now = ctx.currentTime;
  // Tiny attack/release ramp avoids the click a hard start/stop produces.
  const attack = Math.min(0.005, ms / 2000); // keep attack <= release for tiny ms
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.linearRampToValueAtTime(0, now + ms / 1000);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.01);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

// Today: placeholder feedback.
onPlayerHit(() => beep(220, 60));   // app-side oscillator

// Later, when assets exist: swap to a real loaded Sound and drop `beep`.
const hit = await audio.load("sfx/hit.mp3");
onPlayerHit(() => hit.play({ volume: 0.8 }));
// Need Howler's sprite/advanced API for the real asset? Reach in:
//   const howl = hit.nativeHowl;
```

Because the placeholder runs on `Howler.ctx`, the [unlock
rule](#-audio-unlock-must-happen-inside-a-user-gesture) above still applies —
the first `beep()` only makes sound after the user has interacted with the page.

---

## Roadmap

| Version    | Adds                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **0.0.1**  | Scaffold landed — frozen API surface as a `throw` stub; full config + CI walk clean.                                                |
| **0.1.0**  | First npm release. `createAudio` / `load` / `play` / `pause` / `stop` / `fade` / `crossfade` / `dispose` implemented. Shell ≤ 2 KB. |
| **0.2.0**  | Skipped — version number reserved; no release. Aligns with the v0.3 cross-package limitation cycle (all sibling packages ship 0.3.x simultaneously). |
| **0.3.0**  | Equal-power crossfade via `{ curve: 'equal-power' }` — sin/cos curves scheduled directly on each sound's Web Audio `_node.gain` (`setValueCurveAtTime`); 64-sample curves; `STABILITY.md`. Stays within the 2 KB gzip shell budget. |
| **0.4.0**  | Dependency-reduction cycle. `howler` stays a required peer dependency — there is no Howler-free core to extract (see ["Why aiaudiojs"](#why-aiaudiojs)); devDependencies aligned to the ai\*js family, lockfile deduped, `pnpm audit` clean. Stability freeze: the 0.3.x surface is frozen on the 1.0 track. No runtime API change. |
| **0.5+**   | TBD — driven by v0.5 shmup integration feedback (stage→boss equal-power BGM crossfade + heavy SFX). Spatial audio (PannerNode / HRTF) is experimental, targeted at v0.7.                       |

---

## License

[MIT](LICENSE). Howler.js is also [MIT](https://github.com/goldfire/howler.js/blob/master/LICENSE.md).
