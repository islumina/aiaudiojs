// aiaudiojs — regression suite against the REAL howler core.
//
// Environment: happy-dom. Every other test file vi.mock()s howler; this one
// runs howler 2.2.4 itself over a stub AudioContext (see fake-web-audio.ts), so
// it pins wrapper bugs that only show up with Howler's actual event timing,
// buffer cache and play-lock queuing.

import { Howler } from "howler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioDisposedError, AudioError, createAudio } from "../src/index.js";
import {
  WAV,
  WAV2,
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
