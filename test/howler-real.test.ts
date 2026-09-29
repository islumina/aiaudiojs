// aiaudiojs — regression suite against the REAL howler core.
//
// Environment: happy-dom. Every other test file vi.mock()s howler; this one
// runs howler 2.2.4 itself over a stub AudioContext (see fake-web-audio.ts), so
// it pins wrapper bugs that only show up with Howler's actual event timing,
// buffer cache and play-lock queuing.

import { Howler } from "howler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioDisposedError, AudioError, createAudio } from "../src/index.js";
import type { Audio, Sound } from "../src/index.js";
import {
  SpecParam,
  WAV,
  WAV2,
  WAV3,
  active,
  installFakeWebAudio,
  loadFlushed,
  quietHowler,
  resetHowler,
  settledWithin,
  voices,
} from "./fake-web-audio.js";

let fake: ReturnType<typeof installFakeWebAudio> | undefined;

afterEach(() => {
  resetHowler(Howler);
  fake?.restore();
  fake = undefined;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// R1. load() when Howler emits load / loaderror inside `new Howl()`
// ---------------------------------------------------------------------------

describe("R1. load() with a synchronous Howler emit inside the constructor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeWebAudio("running");
  });

  it("R1a. a second load() of the same URL (buffer-cache hit) still resolves", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const p1 = audio.load(WAV);
    expect(await settledWithin(p1, 50)).toBe("resolved");
    // Cache hit: loadSound -> _emit('load') runs INSIDE new Howl().
    const p2 = audio.load(WAV);
    const howls = (Howler as unknown as { _howls: Array<{ state: () => string }> })._howls;
    expect(howls[howls.length - 1]?.state()).toBe("loaded");
    expect(await settledWithin(p2, 5000)).toBe("resolved");
    audio.disposeAll();
  });

  it("R1b. a URL without an extension ('No codec support', emitted synchronously) rejects with AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = audio.load("/api/sound?id=5");
    p.catch(() => {});
    expect(warn).toHaveBeenCalled();
    expect(await settledWithin(p, 5000)).toBe("rejected");
    await expect(p).rejects.toBeInstanceOf(AudioError);
    audio.disposeAll();
  });

  it("R1c. a malformed base64 data URI (new Howl throws) rejects with AudioError, not a raw DOMException", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const err = await audio.load("data:audio/wav;base64,@@@not-base64@@@").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AudioError);
    audio.disposeAll();
  });
});

// ---------------------------------------------------------------------------
// R2. unlock() with no AudioContext (HTML5 fallback / SSR / jsdom)
// ---------------------------------------------------------------------------

describe("R2. unlock() without an AudioContext", () => {
  it("R2a. resolves (never throws) when Howler.ctx is null", async () => {
    expect(typeof (globalThis as Record<string, unknown>).AudioContext).toBe("undefined");
    const audio = createAudio({ autoUnlock: false });
    const H = Howler as unknown as { ctx: unknown; usingWebAudio: boolean };
    // Real Howler models "no context" as null, never undefined.
    expect(H.ctx).toBeNull();
    expect(H.usingWebAudio).toBe(false);
    let p: Promise<void> | undefined;
    expect(() => {
      p = audio.unlock();
    }).not.toThrow();
    await expect(p).resolves.toBeUndefined();
    audio.disposeAll();
  });
});

// ---------------------------------------------------------------------------
// R3. disposeAll() racing an in-flight load()
// ---------------------------------------------------------------------------

describe("R3. disposeAll() racing an in-flight load()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeWebAudio("running");
  });

  it("R3a. a load started before disposeAll() rejects with AudioDisposedError and unloads its Howl", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const p = audio.load(WAV); // decode in flight
    p.catch(() => {});
    audio.disposeAll();
    expect(await settledWithin(p, 50)).toBe("rejected");
    await expect(p).rejects.toBeInstanceOf(AudioDisposedError);
    expect((Howler as unknown as { _howls: unknown[] })._howls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R5. equal-power crossfade while the AudioContext is not running
// ---------------------------------------------------------------------------

describe("R5. equal-power crossfade while the AudioContext is suspended", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // resume() never settles: no user gesture has arrived yet.
    fake = installFakeWebAudio("suspended", () => new Promise<void>(() => {}));
  });

  it("R5a. throws an AudioError that does not blame the HTML5 fallback, and starts no voice", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const H = Howler as unknown as { state: string; usingWebAudio: boolean };
    expect(H.usingWebAudio).toBe(true);
    expect(H.state).toBe("suspended");
    const from = await loadFlushed(audio, WAV);
    const to = await loadFlushed(audio, WAV2);
    expect((from.nativeHowl as unknown as { _webAudio: boolean })._webAudio).toBe(true);
    const fromId = from.play({ loop: true });
    const fv = voices(from).find((v) => v._id === fromId);
    // Queued behind once('resume'): paused but not ended.
    expect(fv?._paused).toBe(true);
    expect(fv?._ended).toBe(false);
    let err: unknown;
    try {
      audio.crossfade(from, to, { duration: 1, curve: "equal-power" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).message).not.toContain("HTML5 fallback");
    // Nothing was queued on `to`.
    expect(voices(to).every((v) => v._ended)).toBe(true);
    audio.disposeAll();
  });
});

// ---------------------------------------------------------------------------
// R6. play() with a single paused voice
// ---------------------------------------------------------------------------

describe("R6. play() with a single paused voice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeWebAudio("running");
  });

  it("R6a. play() starts a NEW voice and leaves the paused one untouched", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const bgm = await loadFlushed(audio, WAV);
    const a = bgm.play({ loop: true, volume: 0.3 });
    await vi.advanceTimersByTimeAsync(1);
    bgm.pause(a);
    const va = voices(bgm).find((v) => v._id === a);
    expect(va).toMatchObject({ _paused: true, _ended: false, _loop: true, _volume: 0.3 });
    const b = bgm.play();
    expect({
      newVoice: b !== a,
      voiceCount: voices(bgm).length,
      aStillPaused: va?._paused,
      aLoop: va?._loop,
      aVolume: va?._volume,
      resumeA: bgm.resume(a),
    }).toEqual({
      newVoice: true,
      voiceCount: 2,
      aStillPaused: true,
      aLoop: true,
      aVolume: 0.3,
      resumeA: a,
    });
    audio.disposeAll();
  });

  it("R6b. a linear crossfade into a Sound with one paused voice starts a fresh voice", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const other = await loadFlushed(audio, WAV);
    const menu = await loadFlushed(audio, WAV2);
    other.play({ loop: true });
    const m = menu.play({ loop: true });
    await vi.advanceTimersByTimeAsync(1);
    menu.pause(m);
    const vm = voices(menu).find((v) => v._id === m);
    audio.crossfade(other, menu, { duration: 1 }).catch(() => {});
    expect(vm).toMatchObject({ _paused: true, _loop: true });
    expect(active(menu)).toHaveLength(1);
    expect(active(menu)[0]?._id).not.toBe(m);
    audio.disposeAll();
  });
});

// ---------------------------------------------------------------------------
// R9. resume() before the first gesture (play queued behind the context)
// ---------------------------------------------------------------------------

describe("R9. resume() while a play is queued behind a suspended context", () => {
  let resumeNow: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    // One shared deferred = one user gesture.
    const gate = new Promise<void>((r) => {
      resumeNow = () => {
        if (fake !== undefined) fake.ctx().state = "running";
        r();
      };
    });
    fake = installFakeWebAudio("suspended", () => gate);
  });

  async function run(callResume: boolean) {
    const f = fake as NonNullable<typeof fake>;
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const bgm = await loadFlushed(audio, WAV);
    const id = bgm.play({ loop: true });
    const v = voices(bgm).find((x) => x._id === id);
    expect(v?._paused).toBe(true);
    expect(v?._ended).toBe(false);
    // The caller never paused anything.
    const resumeReturned = callResume ? bgm.resume() : undefined;
    const resumeIdReturned = callResume ? bgm.resume(id) : undefined;
    resumeNow();
    await vi.advanceTimersByTimeAsync(10);
    const started = f.ctx().sources.filter((s) => s.start.mock.calls.length > 0);
    bgm.stop(id);
    const stoppedAll = started.every((s) => s.stop.mock.calls.length > 0);
    audio.disposeAll();
    return { resumeReturned, resumeIdReturned, started: started.length, stoppedAll };
  }

  it("R9a. control (no resume()): one buffer source starts and stop() silences it", async () => {
    expect(await run(false)).toEqual({
      resumeReturned: undefined,
      resumeIdReturned: undefined,
      started: 1,
      stoppedAll: true,
    });
  });

  it("R9b. resume() / resume(id) do not re-play a queued voice; one buffer source per voice", async () => {
    expect(await run(true)).toEqual({
      resumeReturned: -1,
      resumeIdReturned: -1,
      started: 1,
      stoppedAll: true,
    });
  });

  it("R9c. once the queued voice has started, a genuine pause + resume() resumes it", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const bgm = await loadFlushed(audio, WAV);
    const id = bgm.play({ loop: true });
    resumeNow();
    await vi.advanceTimersByTimeAsync(10);
    bgm.pause(id);
    expect(bgm.resume()).toBe(id);
    expect(active(bgm).map((v) => v._id)).toEqual([id]);
    audio.disposeAll();
  });
});

// ---------------------------------------------------------------------------
// R10. Howler gain writes during an equal-power ramp (spec-faithful AudioParam)
// ---------------------------------------------------------------------------

describe("R10. Howler gain writes during an equal-power ramp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeWebAudio("running", undefined, () => new SpecParam());
  });

  async function setup(): Promise<{ audio: Audio; a: Sound; b: Sound; c: Sound }> {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const a = await loadFlushed(audio, WAV);
    const b = await loadFlushed(audio, WAV2);
    const c = await loadFlushed(audio, WAV3);
    a.play({ loop: true });
    await vi.advanceTimersByTimeAsync(1);
    const p = audio.crossfade(a, b, { duration: 4, curve: "equal-power" });
    p.catch(() => {});
    // 1 s into the 4 s ramp.
    (fake as NonNullable<typeof fake>).ctx().currentTime = 1;
    return { audio, a, b, c };
  }

  it("R10a. Sound.fade() on the incoming sound mid-ramp returns a promise instead of throwing", async () => {
    const { audio, b } = await setup();
    let threw: unknown;
    try {
      b.fade(1, 0.5, 200).catch(() => {});
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeUndefined();
    audio.disposeAll();
  });

  it("R10b. a linear crossfade b -> c mid-ramp does not throw", async () => {
    const { audio, b, c } = await setup();
    let threw: unknown;
    try {
      audio.crossfade(b, c, { duration: 1 }).catch(() => {});
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeUndefined();
    expect(active(c)).toHaveLength(1);
    audio.disposeAll();
  });

  it("R10c. pause + resume of the incoming voice mid-ramp does not throw", async () => {
    const { audio, b } = await setup();
    const id = active(b)[0]?._id as number;
    b.pause(id);
    let threw: unknown;
    try {
      b.resume(id);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeUndefined();
    audio.disposeAll();
  });

  it("R10d. aborting mid-ramp freezes the gain without throwing and resolves", async () => {
    const audio = createAudio({ autoUnlock: false });
    quietHowler(Howler);
    const a = await loadFlushed(audio, WAV);
    const b = await loadFlushed(audio, WAV2);
    a.play({ loop: true });
    await vi.advanceTimersByTimeAsync(1);
    const ctrl = new AbortController();
    const p = audio.crossfade(a, b, { duration: 1, curve: "equal-power", signal: ctrl.signal });
    (fake as NonNullable<typeof fake>).ctx().currentTime = 0.4;
    expect(() => ctrl.abort()).not.toThrow();
    expect(await settledWithin(p, 10)).toBe("resolved");
    audio.disposeAll();
  });
});
