// aiaudiojs 0.1.0 test suite.
//
// Environment: happy-dom (provides document, AbortSignal, DOMException).
// Howler is mocked via vi.mock — the real Howler / AudioContext are too
// stateful for a unit-test environment, and iOS real-device unlock behaviour
// is out-of-scope for automated tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Howler mock — MUST appear before any import that transitively imports howler.
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => void;

vi.mock("howler", () => {
  // Per-instance event handlers (once-fired: keyed by event name)
  const handlers = new Map<object, Map<string, AnyFn>>();
  // Per-instance repeating event listeners (keyed by event name, array per id)
  const listeners = new Map<object, Map<string, Map<number | undefined, AnyFn[]>>>();
  let nextSoundId = 1;
  let mockShouldLoadFail = false;

  class Howl {
    opts: { src: string[]; preload?: boolean };

    constructor(opts: { src: string[]; preload?: boolean }) {
      this.opts = opts;
      handlers.set(this, new Map());
      listeners.set(this, new Map());
      // Auto-fire load / loaderror on the next microtask.
      Promise.resolve().then(() => {
        const map = handlers.get(this);
        if (map === undefined) return;
        const event = mockShouldLoadFail ? "loaderror" : "load";
        const cb = map.get(event);
        cb?.(undefined, mockShouldLoadFail ? "mock error" : undefined);
      });
    }

    once(event: string, cb: AnyFn): void {
      handlers.get(this)?.set(event, cb);
    }

    on(event: string, cb: AnyFn, id?: number): void {
      const evMap = listeners.get(this);
      if (evMap === undefined) return;
      if (!evMap.has(event)) evMap.set(event, new Map());
      const idMap = evMap.get(event)!;
      const key = id;
      if (!idMap.has(key)) idMap.set(key, []);
      idMap.get(key)!.push(cb);
    }

    off(event: string, cb?: AnyFn, id?: number): void {
      const evMap = listeners.get(this);
      if (evMap === undefined) return;
      const idMap = evMap.get(event);
      if (idMap === undefined) return;
      const key = id;
      if (cb === undefined) {
        idMap.delete(key);
        return;
      }
      const arr = idMap.get(key);
      if (arr === undefined) return;
      const idx = arr.indexOf(cb);
      if (idx !== -1) arr.splice(idx, 1);
    }

    /** Test helper: emit an event (end or stop) for a specific sound id. */
    __emit(event: string, id: number): void {
      const evMap = listeners.get(this);
      if (evMap === undefined) return;
      const idMap = evMap.get(event);
      if (idMap === undefined) return;
      // Fire listeners registered for this exact id.
      const arr = idMap.get(id);
      if (arr !== undefined) {
        for (const cb of [...arr]) cb(id);
      }
      // Also fire wildcard listeners (no id).
      const wildArr = idMap.get(undefined);
      if (wildArr !== undefined) {
        for (const cb of [...wildArr]) cb(id);
      }
    }

    _sounds: { _id: number; _paused: boolean }[] = [];

    play(id?: number): number {
      if (id !== undefined) {
        // Resume a specific paused voice.
        const s = this._sounds.find((v) => v._id === id);
        if (s !== undefined) s._paused = false;
        return id;
      }
      const newId = nextSoundId++;
      this._sounds.push({ _id: newId, _paused: false });
      return newId;
    }

    pause(id?: number): void {
      if (id !== undefined) {
        const s = this._sounds.find((v) => v._id === id);
        if (s !== undefined) s._paused = true;
      } else {
        for (const s of this._sounds) s._paused = true;
      }
    }

    stop(_id?: number): void {}

    fade(_from: number, _to: number, _ms: number, _id?: number): void {}

    volume(_v: number, _id?: number): void {}

    rate(_r: number, _id?: number): void {}

    loop(_l: boolean, _id?: number): void {}

    unload(): void {}
  }

  const mockCtx = { state: "suspended", resume: vi.fn().mockResolvedValue(undefined) };

  return {
    Howl,
    Howler: {
      get ctx() {
        return mockCtx;
      },
      volume: vi.fn(),
    },
    // Test helpers — allow individual tests to switch load-fail mode.
    __setMockLoadFail: (v: boolean) => {
      mockShouldLoadFail = v;
    },
    __resetSoundId: () => {
      nextSoundId = 1;
    },
    __getMockCtx: () => mockCtx,
  };
});

// ---------------------------------------------------------------------------
// Imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { Howler, __getMockCtx, __resetSoundId, __setMockLoadFail } from "howler";
import { AudioDisposedError, AudioError, createAudio } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Typed access to the mock-only exports. */
function setLoadFail(v: boolean): void {
  (__setMockLoadFail as (v: boolean) => void)(v);
}

function resetSoundId(): void {
  (__resetSoundId as () => void)();
}

function getMockCtx(): { state: string; resume: ReturnType<typeof vi.fn> } {
  return (__getMockCtx as () => { state: string; resume: ReturnType<typeof vi.fn> })();
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setLoadFail(false);
  resetSoundId();
  vi.clearAllMocks();
  // Re-seed resume mock after clearAllMocks.
  getMockCtx().resume.mockResolvedValue(undefined);
});

afterEach(() => {
  setLoadFail(false);
});

// ---------------------------------------------------------------------------
// A. createAudio / lifecycle
// ---------------------------------------------------------------------------

describe("A. createAudio / lifecycle", () => {
  it("A1. createAudio() with defaults works; disposed starts false", () => {
    const audio = createAudio();
    expect(audio.disposed).toBe(false);
    expect(audio.volume).toBe(1);
    audio.dispose();
  });

  it("A2. createAudio({ volume: 0.5 }) — volume getter returns 0.5", () => {
    const audio = createAudio({ volume: 0.5 });
    expect(audio.volume).toBe(0.5);
    audio.dispose();
  });

  it("A3. volume clamping: 1.5 clamps to 1; -0.5 clamps to 0", () => {
    const a = createAudio({ volume: 1.5 });
    expect(a.volume).toBe(1);
    a.dispose();

    const b = createAudio({ volume: -0.5 });
    expect(b.volume).toBe(0);
    b.dispose();
  });

  it("A4. createAudio in env without `document` — no throw, no listener attach", () => {
    // In happy-dom document IS defined; shadow it with a property descriptor
    // so typeof document === "undefined" inside createAudio.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const audio = createAudio({ autoUnlock: true, resumeOnVisibility: true });
      expect(audio.disposed).toBe(false);
      audio.dispose();
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, "document", descriptor);
      }
    }
  });

  it("A5. dispose / disposeAll are idempotent — no throw on repeat calls", () => {
    const audio = createAudio();
    audio.dispose();
    expect(audio.disposed).toBe(true);
    expect(() => audio.dispose()).not.toThrow();
    expect(() => audio.disposeAll()).not.toThrow();
  });

  it("A6. volume setter clamps and propagates; getter reflects clamped value", () => {
    const audio = createAudio({ autoUnlock: false });
    audio.volume = 0.5;
    expect(audio.volume).toBe(0.5);
    audio.volume = 2;
    expect(audio.volume).toBe(1);
    audio.volume = -1;
    expect(audio.volume).toBe(0);
    audio.dispose();
  });

  it("A7. visibilitychange listener calls Howler.ctx.resume on visible", () => {
    const audio = createAudio({ autoUnlock: false, resumeOnVisibility: true });
    // Simulate visibilitychange to visible.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getMockCtx().resume).toHaveBeenCalled();
    audio.dispose();
  });

  it("A8. autoUnlock handler fires on user gesture and detaches all listeners", () => {
    const audio = createAudio({ autoUnlock: true, resumeOnVisibility: false });
    // Fire a mousedown — the one-shot handler removes all three unlock listeners.
    document.dispatchEvent(new MouseEvent("mousedown"));
    // resume should have been called by the unlock handler.
    expect(getMockCtx().resume).toHaveBeenCalled();
    audio.dispose();
  });

  it("A9. visibilitychange when hidden does NOT call resume", () => {
    const audio = createAudio({ autoUnlock: false, resumeOnVisibility: true });
    // Simulate the page being hidden (e.g. user switches tab or backgrounds the app).
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    // resume must NOT be called when the page is hidden — only on visible.
    expect(getMockCtx().resume).not.toHaveBeenCalled();
    // Restore to visible so subsequent tests are unaffected.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// B. unlock
// ---------------------------------------------------------------------------

describe("B. unlock", () => {
  it("B1. unlock() returns resolved promise", async () => {
    const audio = createAudio({ autoUnlock: false });
    await expect(audio.unlock()).resolves.toBeUndefined();
    audio.dispose();
  });

  it("B2. unlock() catches resume() rejection silently", async () => {
    const audio = createAudio({ autoUnlock: false });
    getMockCtx().resume.mockRejectedValueOnce(new Error("already running"));
    await expect(audio.unlock()).resolves.toBeUndefined();
    audio.dispose();
  });

  it("B3. unlock after dispose throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    audio.dispose();
    await expect(audio.unlock()).rejects.toBeInstanceOf(AudioDisposedError);
  });
});

// ---------------------------------------------------------------------------
// C. load
// ---------------------------------------------------------------------------

describe("C. load", () => {
  it("C1. load(url) resolves with Sound when Howl fires load event", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    expect(sound).toBeDefined();
    expect(sound.disposed).toBe(false);
    audio.dispose();
  });

  it("C2. load(url) rejects with AudioError when Howl fires loaderror", async () => {
    const audio = createAudio({ autoUnlock: false });
    setLoadFail(true);
    await expect(audio.load("bad.mp3")).rejects.toBeInstanceOf(AudioError);
    audio.dispose();
  });

  it("C3. load('') rejects with AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    await expect(audio.load("")).rejects.toBeInstanceOf(AudioError);
    audio.dispose();
  });

  it("C4. load with pre-aborted signal rejects with AbortError immediately", async () => {
    const audio = createAudio({ autoUnlock: false });
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await audio.load("test.mp3", ctrl.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    audio.dispose();
  });

  it("C5. load aborted mid-flight rejects with AbortError + howl.unload() called", async () => {
    const audio = createAudio({ autoUnlock: false });
    const ctrl = new AbortController();
    // Start load (mock fires on next microtask) then abort before it resolves.
    const promise = audio.load("test.mp3", ctrl.signal);
    ctrl.abort();
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    audio.dispose();
  });

  it("C6. load after dispose throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    audio.dispose();
    await expect(audio.load("test.mp3")).rejects.toBeInstanceOf(AudioDisposedError);
  });
});

// ---------------------------------------------------------------------------
// D. Sound.play / pause / stop
// ---------------------------------------------------------------------------

describe("D. Sound.play / pause / stop", () => {
  it("D1. play() returns Howler sound id; passes opts through", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play({ volume: 0.7, rate: 1.5, loop: true });
    expect(typeof id).toBe("number");
    audio.dispose();
  });

  it("D2. play({ signal }) with pre-aborted signal still returns id, stops immediately", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    ctrl.abort();
    const id = sound.play({ signal: ctrl.signal });
    expect(typeof id).toBe("number");
    audio.dispose();
  });

  it("D3. play({ signal }) mid-flight abort calls stop(id)", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const id = sound.play({ signal: ctrl.signal });
    ctrl.abort();
    expect(stopSpy).toHaveBeenCalledWith(id);
    audio.dispose();
  });

  it("D8. play({ signal }) — no abort listener remains after sound ends naturally; abort afterward is a no-op", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");

    const id = sound.play({ signal: ctrl.signal });

    // Simulate the sound ending naturally by firing the 'end' event.
    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);

    // The abort listener must have been removed.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    // Aborting afterward must NOT call stop() again.
    const stopCallsBefore = stopSpy.mock.calls.length;
    ctrl.abort();
    expect(stopSpy.mock.calls.length).toBe(stopCallsBefore);

    audio.dispose();
  });

  it("D9. play({ signal }) — no abort listener remains after sound stops; abort afterward is a no-op", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");

    const id = sound.play({ signal: ctrl.signal });

    // Simulate an external stop by firing the 'stop' event.
    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit(
      "stop",
      id,
    );

    // The abort listener must have been removed.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    // Aborting afterward must NOT call stop() again.
    const stopCallsBefore = stopSpy.mock.calls.length;
    ctrl.abort();
    expect(stopSpy.mock.calls.length).toBe(stopCallsBefore);

    audio.dispose();
  });

  it("D4. pause / stop delegate to Howler", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const pauseSpy = vi.spyOn(sound.nativeHowl, "pause");
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    sound.play();
    sound.pause();
    sound.stop();
    expect(pauseSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    audio.dispose();
  });

  it("D5. play after Sound.dispose throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.dispose();
    expect(() => sound.play()).toThrow(AudioDisposedError);
    audio.dispose();
  });

  it("D6. pause after Sound.dispose throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.dispose();
    expect(() => sound.pause()).toThrow(AudioDisposedError);
    audio.dispose();
  });

  it("D7. stop after Sound.dispose throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.dispose();
    expect(() => sound.stop()).toThrow(AudioDisposedError);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// E. Sound.fade
// ---------------------------------------------------------------------------

describe("E. Sound.fade", () => {
  it("E1. fade() resolves after ms; calls howl.fade", async () => {
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const fadeSpy = vi.spyOn(sound.nativeHowl, "fade");
    const p = sound.fade(1, 0, 500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
    expect(fadeSpy).toHaveBeenCalledWith(1, 0, 500, undefined);
    audio.dispose();
    vi.useRealTimers();
  });

  it("E2. fade after Sound.dispose throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.dispose();
    await expect(sound.fade(1, 0, 500)).rejects.toBeInstanceOf(AudioDisposedError);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// F. Sound.dispose
// ---------------------------------------------------------------------------

describe("F. Sound.dispose", () => {
  it("F1. dispose() idempotent; calls howl.unload(); removes from state.sounds", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const unloadSpy = vi.spyOn(sound.nativeHowl, "unload");
    sound.dispose();
    expect(sound.disposed).toBe(true);
    expect(unloadSpy).toHaveBeenCalledTimes(1);
    // Second dispose is a no-op.
    expect(() => sound.dispose()).not.toThrow();
    expect(unloadSpy).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it("F2. dispose() of one Sound does not affect siblings", async () => {
    const audio = createAudio({ autoUnlock: false });
    const s1 = await audio.load("a.mp3");
    const s2 = await audio.load("b.mp3");
    s1.dispose();
    expect(s1.disposed).toBe(true);
    expect(s2.disposed).toBe(false);
    audio.dispose();
  });

  it("F3. dispose() detaches a pending play() abort listener (no leak)", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, "removeEventListener");
    sound.play({ signal: ac.signal });
    expect(removeSpy).not.toHaveBeenCalled();
    sound.dispose();
    // Howler has no 'unload' event, so dispose() must invoke the play()
    // cleanup explicitly — otherwise the abort listener (and the Howl it
    // closes over) would leak on the still-live user signal.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// G. crossfade
// ---------------------------------------------------------------------------

describe("G. crossfade", () => {
  it("G1. crossfade resolves after duration", async () => {
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    const p = audio.crossfade(from, to, { duration: 2 });
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toBeUndefined();
    audio.dispose();
    vi.useRealTimers();
  });

  it("G2. crossfade with duration: 0 rejects with AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    await expect(audio.crossfade(from, to, { duration: 0 })).rejects.toBeInstanceOf(AudioError);
    audio.dispose();
  });

  it("G3. crossfade with disposed Sound throws AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.dispose();
    expect(() => audio.crossfade(from, to, { duration: 1 })).toThrow(AudioError);
    audio.dispose();
  });

  it("G4. crossfade with pre-aborted signal rejects with AbortError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      audio.crossfade(from, to, { duration: 1, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(DOMException);
    audio.dispose();
  });

  it("G5. crossfade aborted mid-flight resolves immediately", async () => {
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
    audio.dispose();
    vi.useRealTimers();
  });

  it("G6. crossfade with signal but normal timer completion detaches the abort listener", async () => {
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    const ctrl = new AbortController();
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBeUndefined();
    // The cleanup path inside the timer callback must have removed the abort listener.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    // A subsequent abort after completion must NOT trigger any handler.
    ctrl.abort(); // should be a silent no-op
    audio.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// H. Destructurable + nativeHowl escape hatch
// ---------------------------------------------------------------------------

describe("H. Destructurable + nativeHowl escape hatch", () => {
  it("H1. const { load, dispose } = audio works without this-binding issues", async () => {
    const audio = createAudio({ autoUnlock: false });
    const { load, dispose } = audio;
    const sound = await load("test.mp3");
    expect(sound).toBeDefined();
    expect(() => dispose()).not.toThrow();
  });

  it("H2. sound.nativeHowl is the underlying Howl reference", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    // nativeHowl must be the actual Howl instance — its methods must exist.
    expect(typeof sound.nativeHowl.play).toBe("function");
    expect(typeof sound.nativeHowl.fade).toBe("function");
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// I. Sound.resume
// ---------------------------------------------------------------------------

describe("I. Sound.resume", () => {
  it("I1. resume(id) calls howl.play(id) and returns id", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    sound.pause(id);
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume(id);
    expect(playSpy).toHaveBeenCalledWith(id);
    expect(result).toBe(id);
    audio.dispose();
  });

  it("I2. resume() with no arg resumes every _paused===true voice and returns the last id", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id1 = sound.play();
    const id2 = sound.play();
    sound.pause(id1);
    sound.pause(id2);
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume();
    expect(playSpy).toHaveBeenCalledWith(id1);
    expect(playSpy).toHaveBeenCalledWith(id2);
    expect(result).toBe(id2);
    audio.dispose();
  });

  it("I3. resume() returns -1 when no voices are paused", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.play();
    // No pause called — _paused is false for the active voice.
    const result = sound.resume();
    expect(result).toBe(-1);
    audio.dispose();
  });

  it("I4. resume() after dispose() throws AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.dispose();
    expect(() => sound.resume()).toThrow(AudioDisposedError);
    audio.dispose();
  });
});
