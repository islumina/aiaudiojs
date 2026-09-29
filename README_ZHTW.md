# aiaudiojs

以 Howler.js 為底層的薄 Web Audio 包裝，補上 ai*js 家族慣例：`dispose()` 可重複呼叫、`AbortSignal`、明確的 `unlock()`，以及 `crossfade()`。

> **狀態：0.6.0 - 穩定 1.0 軌道 API。** Howler 維持 peer dependency；此套件只提供 root entry。

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

`autoUnlock` 預設為 `true`，會掛上 `touchend`、`pointerup`、`keydown`（HTML 規範中會觸發 user activation 的事件；`touchstart` 不算，瀏覽器會拒絕從它呼叫的 `resume()`）。監聽器會持續保留、每次手勢都重試，直到 `resume()` 真的讓 context 變成 running 才會移除。瀏覽器仍要求 resume 發生在真實 user gesture 內；最保險的做法是在第一個可信 UI 事件中呼叫 `audio.unlock()`。

## 核心 API

- `createAudio(options?)` 回傳 `Audio` 控制器。選項包含 `autoUnlock`、`volume`、`resumeOnVisibility`。
- `audio.unlock()` resume Howler 共用的 `AudioContext`。
- `audio.load(url, signal?)` 載入後回傳可重用的 `Sound`；中途 abort 會以 `AbortError` 拒絕。
- `sound.play(options?)` 回傳 Howler 的 sound id。`PlayOptions.volume` 是單次播放增益，預設為 `1`；Audio instance 的 master volume 由 Howler 全域套用。`rate` 不是有限數值時，會在啟動任何 voice 前丟出 `AudioError`。
- `sound.pause(id?)`、`sound.stop(id?)`、`sound.resume(id?)`、`sound.dispose()`。
- `sound.fade(from, to, ms, id?)` 的 `from` / `to` 必須是 `[0, 1]` 範圍內的有限數值，`ms` 必須是 `>= 0` 的有限數值；否則回傳的 promise 會以 `AudioError` 拒絕。它不會同步丟出例外。超過 2^31-1 ms（約 24.8 天）的延遲會被截為上限值。
- `audio.crossfade(from, to, { duration, curve, signal, loop })` 支援 `linear` 與 `equal-power`。`duration`（秒）結束時，會停止呼叫當下正在播放的 `from` voices。`crossfade({ loop: true })` 讓新開始的 voice 循環播放。`crossfade(s, s)` 會以 crossfade 重新播放 `s`。
- `audio.disposeAll()` 卸載所有受管 sound、以 `AudioDisposedError` 拒絕進行中的載入，並移除 unlock / visibility listeners。

## 注意事項

- Howler volume 是全域狀態。多個 `Audio` instance 會互相覆寫 master volume；建議每個 app 或 scene 只保留一個 controller。
- 被 abort 的 `load()` 會以 `AbortError` 拒絕並 unload Howl；abort 之後 Howler 才送出的 late `load` 事件會被忽略，不會建立 `Sound`。
- `equal-power` crossfade 需要 Web Audio mode 與 Howler gain node。HTML5 fallback 會丟 `AudioError`；可改用 `linear`。
- `linear` crossfade 交給 `Howl.fade()`。Abort 只會清掉此 wrapper 的 timer，不能取消 Howler 內部 ramp。
- Crossfade 被 abort 時不會停止任何 voice：abort 之後兩個 voice 都由呼叫端負責；請自行 stop 或重新 fade `from`。
- URL 會直接交給 Howler；不可信輸入必須先自行驗證。

## AI Context

- 短索引：[`llms.txt`](llms.txt)
- 完整生成內容：[`llms-full.txt`](llms-full.txt)
- 穩定度契約：[`STABILITY.md`](STABILITY.md)
- 目前 review backlog：[`REVIEW.md`](REVIEW.md)
- 版本紀錄：[`CHANGELOG.md`](CHANGELOG.md)

## License

MIT
