# aiaudiojs

[![npm version](https://img.shields.io/npm/v/aiaudiojs.svg)](https://www.npmjs.com/package/aiaudiojs)
[![CI](https://github.com/yshengliao/aiaudiojs/actions/workflows/ci.yml/badge.svg)](https://github.com/yshengliao/aiaudiojs/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-brightgreen.svg)](LICENSE)
[![AI Generated](https://img.shields.io/badge/AI_Generated-Claude_Code_Opus_4.7_Max-blueviolet.svg)](https://www.anthropic.com/claude-code)
[![English](https://img.shields.io/badge/lang-English-blue.svg)](README.md)

> 一個架在 [Howler.js](https://howlerjs.com/) 上的薄殼 Web Audio 套件。把 `Howl` 包進 `dispose()` 冪等、`AbortSignal` 取消、一級 equal-power `crossfade()`，以及其他 ai\*js convention。Howler 仍是 `peerDependency`，需要它的進階 API 時可以透過 `sound.nativeHowl` 直接拿到。

隸屬 [ai\*js micro-runtime 生態系](https://github.com/yshengliao) ─ 另見 [aifsmjs](https://github.com/yshengliao/aifsmjs)（FSM）、[aiecsjs](https://github.com/yshengliao/aiecsjs)（ECS）、[aibridgejs](https://github.com/yshengliao/aibridgejs)（cross-context RPC）、[aipooljs](https://github.com/yshengliao/aipooljs)（物件池）、[aiquadtreejs](https://github.com/yshengliao/aiquadtreejs)（空間分割）、[aieventjs](https://github.com/yshengliao/aieventjs)（event emitter）。

> **狀態：0.4.0。** 完整實作上線。`createAudio` / `load` / `play` / `pause` / `stop` / `fade` / `crossfade` / `dispose` 全部接通。Crossfade 預設使用 linear（向下相容）；透過 `{ curve: 'equal-power' }` 切換 equal-power 模式。0.4.0 是降依賴 + stability-freeze release —— 相較 0.3.0 無 runtime API 變更，`howler` 維持 required peer dependency（見 [「為什麼有 aiaudiojs」](#為什麼有-aiaudiojs)）。

---

## 為什麼有 aiaudiojs

瀏覽器的 Web Audio 已經成熟，但門檻很陡 ── 而那道陡坡大部分是 iOS Safari。Howler.js 花了 13 年把 unlock flow、HTML5 fallback、sprite、codec 偵測、全域 AudioContext 生命週期磨光滑。把它丟掉自己寫，是個壞 trade。三個理由（完整評估在 [LEARNINGS.md](../LEARNINGS.md)）：

- **Howler.js 是 MIT、9.7 KB gzip、已經夠成熟。** 即使是 2024 後半休眠狀態，API 已經穩定、iOS unlock pipeline 對 happy path 也工作。從零重寫只是重新發現同樣 edge case 而已。
- **iOS Safari 的 edge case 是 WebKit 病。** iOS 17.4+ 對 HTML5 streaming 的 regression、iOS 18 VoiceOver / Audio Ducking 詭異情境、「5 秒重新鎖定」── 這些是 WebKit bug，不是 Howler bug。clean-room 重寫只是在相同情況踩相同雷。
- **缺的是 ai\*js convention，不是 audio runtime。** `dispose()` 冪等、`AbortSignal` 全程、一級 `crossfade()` 跑在 AudioContext timeline、具名 error、typed event ── 這些是 ~2 KB 殼層程式碼，不是 10 KB runtime。

所以 `aiaudiojs` 就是 **ai\*js 形狀的音訊 handle**：

- **Howler.js 是 required peer dependency。** 使用者裝兩個。殼層永遠不打包 Howler。
- **`dispose()` 處處冪等。** 頂層 `audio.disposeAll()` 與每個 sound 的 `sound.dispose()` 都可重複呼叫；之後的操作拋 `AudioDisposedError`。
- **`AbortSignal` 貫穿全程。** `audio.load(url, signal)` 取消網路請求、`sound.play({ signal })` 在 abort 時 stop 該 instance、`audio.crossfade(a, b, { duration, signal })` 在 abort 時提早 resolve。預設 linear curve 的底層 `Howl.fade()` ramp 無法中途取消（會靜靜跑完，但 promise 不再卡你）；`equal-power` curve 排程在 AudioContext timeline，abort 時會真正取消進行中的 ramp（`cancelScheduledValues` 後 `setValueAtTime`）。
- **一級 `crossfade()`。** 預設使用 `Howl.fade()` 的 linear-curve fade。傳入 `{ curve: 'equal-power' }` 可改用感知響度恆定的 sin/cos ramp，排程在 `AudioContext` timeline（`GainNode.gain.setValueCurveAtTime`），在 0.3.0 正式發布。
- **逃生口透過 `sound.nativeHowl`。** 需要 Howler 的 sprite API、自訂 HTML5 element、或任何殼層刻意不暴露的進階功能時用。
- **`visibilitychange` 時重試 iOS unlock。** 對「背景化後 context 自動 suspend」做 best-effort 補救。不假裝能解所有 WebKit bug。

明確**不做**的：不做 3D spatial framework（Howler 有 spatial plugin，直接用即可）、不做 synth / MIDI engine、不做 sprite generator（用 `audiosprite` CLI）、不做 audio worklet host。殼層刻意收窄。

---

## Quick Start

```bash
pnpm add aiaudiojs howler
```

```typescript
import { createAudio } from "aiaudiojs";

const audio = createAudio({
  autoUnlock: true,         // 綁第一個 user gesture；預設 true
  resumeOnVisibility: true, // iOS Safari best-effort 恢復
});

// 1. 載入。回傳 Promise<Sound>；signal 可在中途 abort。
const zap = await audio.load("zap.mp3");
const bgm1 = await audio.load("level1.mp3");
const bgm2 = await audio.load("level2.mp3");

// 2. 播放。回傳 Howler 的 sound id，可用來 target 這個 instance。
const zapId = zap.play({ volume: 0.8 });
bgm1.play({ loop: true });

// 3. 兩個 Sound 之間 crossfade。預設 curve 為 linear，雙邊跑 Howl.fade()；
//    傳 `curve: 'equal-power'` 改走 AudioContext timeline 的 sin/cos 排程，
//    切換瞬間感知響度恆定（v0.5 shmup stage→boss 切換正是這個 use case）。
await audio.crossfade(bgm1, bgm2, { duration: 2 });
await audio.crossfade(bgm1, bgm2, { duration: 2, curve: "equal-power" });

// 4. 逃生口 ── 直接拿 Howler 做進階操作。
const howl = zap.nativeHowl;
howl.fade(1, 0, 500, zapId); // 直接打 Howler

// 5. 拆除。
audio.disposeAll(); // 這個 Audio 建出的所有 sound
```

---

## 能做 / 不做

| 會做（v1）                                                  | 不會做                                                |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `createAudio({ autoUnlock, volume, resumeOnVisibility })`   | 多個 AudioContext 編排（Safari 上限 4 個）            |
| 第一個 user gesture 時 unlock iOS                           | 修不屬於我們的 WebKit bug（#1744 等）                 |
| `load(url, signal)` 支援 abort                              | Worker 端 audio decode（不做 `OfflineAudioContext`）  |
| 每個 Sound 的 `play / pause / stop / fade`                  | Audio worklet / DSP graph 編排                        |
| `crossfade()`（linear 預設 + equal-power opt-in）           | MIDI / synth / oscillator 驅動的音訊                  |
| `dispose()` 冪等；dispose 後呼叫拋錯                        | 3D spatial（直接用 Howler 的 spatial plugin）         |
| `sound.nativeHowl` 逃生口（唯讀 property）                  | Sprite generator CLI（用 `audiosprite`）              |
| Howler 設為 `peerDependency`                                | 打包 Howler（讓它留在使用者 deps graph）              |

---

## API 草稿

```typescript
import type { Howl } from "howler";

interface AudioOptions {
  autoUnlock?: boolean;        // 預設 true
  volume?: number;             // master，預設 1
  resumeOnVisibility?: boolean; // 預設 true
}

interface PlayOptions {
  volume?: number;
  rate?: number;
  loop?: boolean;
  signal?: AbortSignal;
}

type CrossfadeCurve = "linear" | "equal-power";

interface CrossfadeOptions {
  duration: number;            // 秒
  signal?: AbortSignal;
  curve?: CrossfadeCurve;      // 預設 "linear"（backward-compat）
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

完整 JSDoc 在 [`src/index.ts`](src/index.ts)。

---

## Roadmap

| 版本       | 加入內容                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **0.0.1**  | Scaffold 落地 ── 凍結 API surface 為 `throw` stub；完整配置 + CI 跑得起來。                                                              |
| **0.1.0**  | 第一個 npm release。`createAudio` / `load` / `play` / `pause` / `stop` / `fade` / `crossfade` / `dispose` 實作完。殼層 ≤ 2 KB。          |
| **0.2.0**  | 跳號 ── 版號保留、無 release。對齊 v0.3 cross-package limitation cycle（所有兄弟套件同期發布 0.3.x）。                                   |
| **0.3.0**  | Equal-power crossfade via `{ curve: 'equal-power' }` ── sin/cos 曲線直接排在各 sound 的 Web Audio `_node.gain`（`setValueCurveAtTime`）；64-sample 曲線；`STABILITY.md`。維持在 2 KB gzip 殼層 budget 內。 |
| **0.4.0**  | 降依賴 cycle。`howler` 維持 required peer dependency ── 沒有 howler-free 的 core 可拆（見 [「為什麼有 aiaudiojs」](#為什麼有-aiaudiojs)）；devDependencies 對齊 ai\*js 家族、lockfile deduped、`pnpm audit` clean。Stability freeze：0.3.x surface 凍結於 1.0 track。無 runtime API 變更。 |
| **0.5+**   | TBD ── 由 v0.5 shmup 整合回饋驅動（stage→boss equal-power BGM crossfade + heavy SFX）。Spatial audio（PannerNode / HRTF）為 experimental，鎖定 v0.7。                                                 |

---

## License

[MIT](LICENSE)。Howler.js 同樣是 [MIT](https://github.com/goldfire/howler.js/blob/master/LICENSE.md)。
