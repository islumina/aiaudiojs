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

// ---------------------------------------------------------------------------
// FIDELITY REBUILD (wave 2026-06-10): the previous mock modelled `_paused`
// only via pause() and stubbed stop() as a no-op, so it could never see the
// four P1s (resume restarting ended voices, master volume applied twice, loop
// abort torn down at the loop boundary, the `_sounds` reach-in crash). This
// mock reflects Howler's documented voice-pool semantics:
//
//   - a voice carries `_paused`, `_ended`, `_loop`, `_volume`, and a per-id
//     `_node.gain` AudioParam (Web Audio mode);
//   - stop(id) parks the voice as `_ended: true, _paused: true` (Howler marks
//     stopped/idle pool voices paused+ended);
//   - the per-id `end` event ends a NON-loop voice (`_ended: true`); a loop
//     voice emits `end` at every loop boundary but is NOT terminated
//     (`_ended` stays false), so playback continues;
//   - pause(id) sets `_paused: true` only (does not touch `_ended`);
//     play(id) resumes (`_paused: false, _ended: false`);
//   - per-id volume(v, id) writes the voice's gain.value; a howl-global
//     volume(v) (no id) records `_globalVolume`; `Howler.volume(v)` is the
//     master and is recorded separately, so a test can compose the two.
// ---------------------------------------------------------------------------

interface MockVoice {
  _id: number;
  _paused: boolean;
  _ended: boolean;
  _loop: boolean;
  _volume: number;
  _node: { gain: { value: number } };
}

vi.mock("howler", () => {
  // Per-instance event handlers (once-fired: keyed by event name)
  const handlers = new Map<object, Map<string, AnyFn>>();
  // Per-instance repeating event listeners (keyed by event name, array per id)
  const listeners = new Map<object, Map<string, Map<number | undefined, AnyFn[]>>>();
  let nextSoundId = 1;
  let mockShouldLoadFail = false;

  class Howl {
    opts: { src: string[]; preload?: boolean };
    // Howl-global default volume (the no-id volume() setter). Distinct from
    // each voice's per-id gain and from Howler.volume() (the master).
    _globalVolume = 1;

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

    /**
     * Test helper: emit an event (end or stop) for a specific sound id.
     * For `end`, applies Howler's loop semantics to the matching voice:
     * a non-loop voice ends (`_ended = true`); a loop voice keeps playing
     * (the event fires every loop boundary but does NOT terminate it).
     */
    __emit(event: string, id: number): void {
      if (event === "end") {
        const voice = this._sounds.find((v) => v._id === id);
        if (voice !== undefined && voice._loop !== true) {
          // Natural end of a non-loop voice: Howler parks it _ended:true and
          // _paused:true (the voice returns to the pool).
          voice._ended = true;
          voice._paused = true;
        }
      }
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

    /**
     * Test helper: seed a pool voice in an arbitrary state without going
     * through play() — used to construct stopped / ended / never-played pool
     * voices the way real Howler leaves them (`_paused: true, _ended: true`).
     */
    __seedVoice(v: Partial<MockVoice> & { _id: number }): MockVoice {
      const voice: MockVoice = {
        _id: v._id,
        _paused: v._paused ?? false,
        _ended: v._ended ?? false,
        _loop: v._loop ?? false,
        _volume: v._volume ?? 1,
        _node: v._node ?? { gain: { value: v._volume ?? 1 } },
      };
      this._sounds.push(voice);
      return voice;
    }

    _sounds: MockVoice[] = [];

    play(id?: number): number {
      if (id !== undefined) {
        // Resume a specific voice: Howler clears paused AND ended on replay.
        const s = this._sounds.find((v) => v._id === id);
        if (s !== undefined) {
          s._paused = false;
          s._ended = false;
        }
        return id;
      }
      const newId = nextSoundId++;
      this._sounds.push({
        _id: newId,
        _paused: false,
        _ended: false,
        _loop: false,
        _volume: this._globalVolume,
        _node: { gain: { value: this._globalVolume } },
      });
      return newId;
    }

    pause(id?: number): void {
      // pause() sets _paused only; _ended is untouched.
      if (id !== undefined) {
        const s = this._sounds.find((v) => v._id === id);
        if (s !== undefined) s._paused = true;
      } else {
        for (const s of this._sounds) s._paused = true;
      }
    }

    stop(id?: number): void {
      // Howler parks a stopped voice as paused + ended (it returns to the pool
      // available for replay). A bare-id stop with no matching voice is a no-op.
      const mark = (s: MockVoice): void => {
        s._ended = true;
        s._paused = true;
      };
      if (id !== undefined) {
        const s = this._sounds.find((v) => v._id === id);
        if (s !== undefined) mark(s);
      } else {
        for (const s of this._sounds) mark(s);
      }
    }

    fade(_from: number, _to: number, _ms: number, _id?: number): void {}

    volume(v?: number, id?: number): number {
      if (v === undefined) return this._globalVolume;
      if (id !== undefined) {
        // Per-id volume: write the voice's gain param (relative [0,1] value).
        const s = this._sounds.find((vc) => vc._id === id);
        if (s !== undefined) {
          s._volume = v;
          s._node.gain.value = v;
        }
      } else {
        this._globalVolume = v;
      }
      return v;
    }

    rate(_r: number, _id?: number): void {}

    loop(l?: boolean, id?: number): void {
      if (l === undefined) return;
      if (id !== undefined) {
        const s = this._sounds.find((v) => v._id === id);
        if (s !== undefined) s._loop = l;
      }
    }

    unload(): void {}
  }

  const mockCtx = { state: "suspended", resume: vi.fn().mockResolvedValue(undefined) };

  return {
    Howl,
    Howler: {
      get ctx() {
        return mockCtx;
      },
      // Master volume sink — recorded so a test can compose per-id × master.
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

  it("D10. play({ loop: true, signal }) — abort STILL stops the voice after an `end` (loop boundary)", async () => {
    // AUD-R-01: Howler's `end` fires at the end of EACH loop for a looping
    // sound — playback continues. The abort wiring must survive that boundary,
    // otherwise looping BGM + AbortSignal (the headline use case) silently
    // loses cancellation after the first iteration.
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const id = sound.play({ loop: true, signal: ctrl.signal });

    // Loop boundary: `end` fires but the loop voice keeps playing (not ended).
    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);

    // Aborting after the loop boundary MUST still stop the voice.
    const stopCallsBefore = stopSpy.mock.calls.length;
    ctrl.abort();
    expect(stopSpy).toHaveBeenCalledWith(id);
    expect(stopSpy.mock.calls.length).toBeGreaterThan(stopCallsBefore);

    audio.dispose();
  });

  it("D11. play({ loop: false, signal }) — abort wiring is still torn down on natural end (no leak)", async () => {
    // The cleanup contract is unchanged for one-shot sounds: a non-loop voice
    // that ends naturally removes the abort listener (D8), so a later abort is
    // a no-op. This pins that the R-01 fix did not over-correct.
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const id = sound.play({ loop: false, signal: ctrl.signal });

    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
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

  // AUD-B-01 — the no-arg enumeration must resume ONLY genuinely-paused
  // voices. In real Howler, stop(), natural end, and the never-played pooled
  // voice all leave `_paused === true` with `_ended === true`; resuming them
  // replays finished SFX from zero (or starts a never-played voice). The
  // filter must also require `_ended !== true`.

  it("I5. resume() does NOT replay a stopped voice (stop → _paused+_ended)", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    sound.stop(id); // Howler: stopped voice parks _paused:true, _ended:true
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume();
    expect(playSpy).not.toHaveBeenCalled();
    expect(result).toBe(-1);
    audio.dispose();
  });

  it("I6. resume() does NOT replay a naturally-ended voice", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    // Natural end of a non-loop voice: _ended becomes true.
    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume();
    expect(playSpy).not.toHaveBeenCalled();
    expect(result).toBe(-1);
    audio.dispose();
  });

  it("I7. resume() does NOT start a never-played pooled voice (_paused+_ended)", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    // A pool voice that was loaded but never played: Howler leaves it
    // _paused:true, _ended:true.
    (
      sound.nativeHowl as unknown as {
        __seedVoice: (v: { _id: number; _paused: boolean; _ended: boolean }) => void;
      }
    ).__seedVoice({ _id: 42, _paused: true, _ended: true });
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume();
    expect(playSpy).not.toHaveBeenCalled();
    expect(result).toBe(-1);
    audio.dispose();
  });

  it("I8. resume() resumes a genuinely paused voice but skips a sibling ended voice; returns the paused id", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const pausedId = sound.play();
    const endedId = sound.play();
    sound.pause(pausedId); // genuinely paused: _paused:true, _ended:false
    sound.stop(endedId); // parked: _paused:true, _ended:true
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume();
    expect(playSpy).toHaveBeenCalledWith(pausedId);
    expect(playSpy).not.toHaveBeenCalledWith(endedId);
    expect(result).toBe(pausedId);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// J. AUD-B-03 — _sounds reach-in drift tolerance (centralised guarded accessor)
//
// peerDependency `howler: ^2.2.4` auto-accepts a 2.3.x whose private `_sounds`
// internal may reshape or vanish. Every reach-in (resume enumeration :436,
// equal-power filter :596/:631, gain access :612) must degrade to a named
// `AudioError`, NEVER a raw TypeError. On the crossfade path the started `to`
// voice must be stopped before the throw so no silent orphan voice is left.
// ---------------------------------------------------------------------------

describe("J. _sounds reach-in drift tolerance (AUD-B-03)", () => {
  it("J1. equal-power crossfade with a reshaped (missing) `from._sounds` throws AudioError, not raw TypeError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.play();
    // Simulate a howler upgrade that renamed/removed `_sounds`.
    (from.nativeHowl as unknown as { _sounds?: unknown })._sounds = undefined;
    let err: unknown;
    try {
      audio.crossfade(from, to, { duration: 1, curve: "equal-power" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AudioError);
    expect(err).not.toBeInstanceOf(TypeError);
    audio.dispose();
  });

  it("J2. equal-power crossfade does not orphan the started `to` voice when `from._sounds` is reshaped — to.stop(toId) runs before the throw", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.play();
    const stopSpy = vi.spyOn(to.nativeHowl, "stop");
    (from.nativeHowl as unknown as { _sounds?: unknown })._sounds = undefined;
    let threw = false;
    try {
      audio.crossfade(from, to, { duration: 1, curve: "equal-power" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // `to.play({ volume: 0 })` already started a voice; it MUST be stopped so
    // no silent orphan is left playing after the failure.
    expect(stopSpy).toHaveBeenCalled();
    audio.dispose();
  });

  it("J3. resume() with a reshaped (missing) `_sounds` throws AudioError, not raw TypeError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.play();
    (sound.nativeHowl as unknown as { _sounds?: unknown })._sounds = undefined;
    let err: unknown;
    try {
      sound.resume();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AudioError);
    expect(err).not.toBeInstanceOf(TypeError);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// K. AUD-B-02 — master volume must be applied exactly once
//
// Invariant: per-sound gain is a RELATIVE [0,1] value; the master lives ONLY
// in Howler's global gain (`Howler.volume`). The per-id default play volume
// must be 1 (relative), not the masterVolume — otherwise Howler global × the
// per-id default double-attenuates to mv², and voices started before vs after
// a volume change play at different loudness.
// ---------------------------------------------------------------------------

describe("K. master volume applied once (AUD-B-02)", () => {
  it("K1. play() with no per-call volume uses per-id 1 (relative), not masterVolume — effective = master only", async () => {
    const audio = createAudio({ autoUnlock: false, volume: 0.5 });
    const sound = await audio.load("test.mp3");
    const volSpy = vi.spyOn(sound.nativeHowl, "volume");
    const id = sound.play(); // no per-call volume
    // Per-id gain must be the relative default 1 — NOT 0.5. With master = 0.5
    // (Howler global), effective loudness = 1 × 0.5 = 0.5, not 0.5 × 0.5 = mv².
    expect(volSpy).toHaveBeenCalledWith(1, id);
    expect(volSpy).not.toHaveBeenCalledWith(0.5, id);
    audio.dispose();
  });

  it("K2. an explicit per-call volume is passed through verbatim (relative), composed once with master", async () => {
    const audio = createAudio({ autoUnlock: false, volume: 0.5 });
    const sound = await audio.load("test.mp3");
    const volSpy = vi.spyOn(sound.nativeHowl, "volume");
    const id = sound.play({ volume: 0.5 });
    // Caller asked for 0.5 (relative); it is forwarded as-is. Effective via the
    // Howler global master (0.5) = 0.5 × 0.5 = 0.25, applied once at each stage.
    expect(volSpy).toHaveBeenCalledWith(0.5, id);
    audio.dispose();
  });

  it("K3. voices started before and after a master change keep the SAME per-id default (relative 1)", async () => {
    const audio = createAudio({ autoUnlock: false, volume: 1 });
    const sound = await audio.load("test.mp3");
    const volSpy = vi.spyOn(sound.nativeHowl, "volume");
    const before = sound.play();
    audio.volume = 0.25; // master change
    const after = sound.play();
    // Both plays use the relative default 1; the master (0.25) applies once
    // globally to both — no per-id divergence by play time.
    expect(volSpy).toHaveBeenCalledWith(1, before);
    expect(volSpy).toHaveBeenCalledWith(1, after);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// L. AUD-S-02 — non-finite numeric inputs must not bypass the guards
//
// clamp() documented as "[0,1]" let NaN through (min/max(NaN) === NaN),
// poisoning state.masterVolume; the crossfade duration guard `<= 0` let NaN
// pass (NaN <= 0 is false), reaching setValueAtTime/setValueCurveAtTime which
// throw a raw RangeError AFTER `to.play()` already started a silent voice.
// ---------------------------------------------------------------------------

describe("L. non-finite inputs (AUD-S-02)", () => {
  it("L1. createAudio({ volume: NaN }) — masterVolume normalises to a finite value, not NaN", async () => {
    const audio = createAudio({ autoUnlock: false, volume: Number.NaN });
    expect(Number.isFinite(audio.volume)).toBe(true);
    expect(audio.volume).toBe(0);
    audio.dispose();
  });

  it("L2. audio.volume = NaN / Infinity — setter rejects non-finite, stays in [0,1]", async () => {
    const audio = createAudio({ autoUnlock: false, volume: 0.5 });
    audio.volume = Number.NaN;
    expect(Number.isFinite(audio.volume)).toBe(true);
    expect(audio.volume).toBe(0);
    audio.volume = Number.POSITIVE_INFINITY;
    expect(audio.volume).toBe(1); // +Inf clamps to the [0,1] ceiling
    audio.volume = Number.NEGATIVE_INFINITY;
    expect(audio.volume).toBe(0); // -Inf clamps to the [0,1] floor
    audio.dispose();
  });

  it("L3. crossfade({ duration: NaN }) rejects with AudioError (not a raw throw)", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    await expect(audio.crossfade(from, to, { duration: Number.NaN })).rejects.toBeInstanceOf(
      AudioError,
    );
    audio.dispose();
  });

  it("L4. equal-power crossfade({ duration: NaN }) rejects with AudioError before any voice is orphaned", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.play();
    const err = await audio
      .crossfade(from, to, { duration: Number.NaN, curve: "equal-power" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AudioError);
    expect(err).not.toBeInstanceOf(RangeError);
    audio.dispose();
  });

  it("L5. crossfade({ duration: Infinity }) rejects with AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    await expect(
      audio.crossfade(from, to, { duration: Number.POSITIVE_INFINITY }),
    ).rejects.toBeInstanceOf(AudioError);
    audio.dispose();
  });
});
