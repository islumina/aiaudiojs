# aiaudiojs

以 Howler.js 為底層的薄 Web Audio 包裝，補上 ai*js 家族慣例：`dispose()` 可重複呼叫、`AbortSignal`、明確的 `unlock()`，以及 `crossfade()`。

> **狀態：0.5.7 - 穩定 1.0 軌道 API。** Howler 維持 peer dependency；此套件只提供 root entry。

## 安裝

```bash
pnpm add aiaudiojs howler
```

```ts
import { createAudio } from "aiaudiojs";
```

## 快速開始

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

`autoUnlock` 預設為 `true`，會掛上 `touchstart`、`mousedown`、`keydown`。瀏覽器仍要求 resume 發生在真實 user gesture 內；最保險的做法是在第一個可信 UI 事件中呼叫 `audio.unlock()`。

## 核心 API

- `createAudio(options?)` 回傳 `Audio` 控制器。選項包含 `autoUnlock`、`volume`、`resumeOnVisibility`。
- `audio.unlock()` resume Howler 共用的 `AudioContext`。
- `audio.load(url, signal?)` 載入後回傳可重用的 `Sound`；中途 abort 會以 `AbortError` 拒絕。
- `sound.play(options?)` 回傳 Howler 的 sound id。`PlayOptions.volume` 是單次播放增益，預設為 `1`；Audio instance 的 master volume 由 Howler 全域套用。
- `sound.pause(id?)`、`sound.stop(id?)`、`sound.resume(id?)`、`sound.fade(from, to, ms, id?)`、`sound.dispose()`。
- `audio.crossfade(from, to, { duration, curve, signal })` 支援 `linear` 與 `equal-power`。
- `audio.disposeAll()` 卸載所有受管 sound，並移除 unlock / visibility listeners。

## 注意事項

- Howler volume 是全域狀態。多個 `Audio` instance 會互相覆寫 master volume；建議每個 app 或 scene 只保留一個 controller。
- `load()` 被 abort 時會 unload Howl 並 reject，但 Howler 在 decode 已啟動後仍可能送出 late `load`。若你會 abort 不確定的載入，scene teardown 時請呼叫 `disposeAll()`。
- `equal-power` crossfade 需要 Web Audio mode 與 Howler gain node。HTML5 fallback 會丟 `AudioError`；可改用 `linear`。
- `linear` crossfade 交給 `Howl.fade()`。Abort 只會清掉此 wrapper 的 timer，不能取消 Howler 內部 ramp。
- URL 會直接交給 Howler；不可信輸入必須先自行驗證。

## AI Context

- 短索引：[`llms.txt`](llms.txt)
- 完整生成內容：[`llms-full.txt`](llms-full.txt)
- 穩定度契約：[`STABILITY.md`](STABILITY.md)
- 目前 review backlog：[`REVIEW.md`](REVIEW.md)
- 版本紀錄：[`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
