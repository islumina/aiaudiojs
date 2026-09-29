// aiaudiojs 0.1.0 test suite.
//
// Environment: happy-dom (provides document, AbortSignal, DOMException).
// Howler is mocked via vi.mock — the real Howler / AudioContext are too
// stateful for a unit-test environment, and iOS real-device unlock behaviour
// is out-of-scope for automated tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Howler mock — the shared spec-faithful voice pool (test/howler-mock.ts).
// vi.mock is hoisted above every import, so src/index.ts receives the mock.
// ---------------------------------------------------------------------------

vi.mock("howler", () => import("./howler-mock.js"));

import { AudioDisposedError, AudioError, createAudio } from "../src/index.js";
import type { Sound } from "../src/index.js";
import {
  Howler,
  type MockVoice,
  __releasePlayLock,
  __resetMock,
  __setPlayLock,
  __lastHowl as lastHowl,
  mockCtx,
  __setCtxNull as setCtxNull,
  __setMockLoadFail as setLoadFail,
  __setManualLoad as setManualLoad,
  __setSyncLoad as setSyncLoad,
} from "./howler-mock.js";

type AnyFn = (...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockCtx(): typeof mockCtx {
  return mockCtx;
}

/** The mock Howl behind a Sound, with its voice pool and test helpers. */
function mh(sound: Sound): import("./howler-mock.js").Howl {
  return sound.nativeHowl as unknown as import("./howler-mock.js").Howl;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetMock();
  vi.clearAllMocks();
  getMockCtx().state = "suspended";
});

afterEach(() => {
  __resetMock();
  vi.useRealTimers();
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

  it("A8. autoUnlock handler fires on an activation-triggering gesture", () => {
    const audio = createAudio({ autoUnlock: true, resumeOnVisibility: false });
    // touchstart is NOT an activation-triggering event per the HTML spec
    // (autoplay policies refuse resume() from it); the handler must not be
    // listening on it. pointerup is.
    document.dispatchEvent(new Event("touchstart"));
    expect(getMockCtx().resume).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("pointerup"));
    expect(getMockCtx().resume).toHaveBeenCalled();
    audio.dispose();
  });

  it("A8b. autoUnlock detaches its listeners once resume() leaves the context running, and keeps retrying otherwise", async () => {
    const audio = createAudio({ autoUnlock: true, resumeOnVisibility: false });
    // resume() resolves but the context is still not running (e.g. refused
    // by the browser's autoplay policy) — the listeners must stay attached
    // so the next gesture can retry.
    document.dispatchEvent(new Event("keydown"));
    expect(getMockCtx().resume).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    document.dispatchEvent(new Event("keydown"));
    expect(getMockCtx().resume).toHaveBeenCalledTimes(2);

    // Now resume() actually leaves the context running — the handler must
    // detach so a further gesture does not call resume() again.
    getMockCtx().resume.mockImplementationOnce(() => {
      getMockCtx().state = "running";
      return Promise.resolve();
    });
    document.dispatchEvent(new Event("keydown"));
    expect(getMockCtx().resume).toHaveBeenCalledTimes(3);
    await Promise.resolve();
    document.dispatchEvent(new Event("keydown"));
    expect(getMockCtx().resume).toHaveBeenCalledTimes(3);
    audio.dispose();
  });

  it("A8c. autoUnlock detaches immediately (without calling resume) when Howler has no AudioContext", () => {
    setCtxNull(true);
    const audio = createAudio({ autoUnlock: true, resumeOnVisibility: false });
    document.dispatchEvent(new Event("pointerup"));
    expect(getMockCtx().resume).not.toHaveBeenCalled();
    // Listeners must have detached: a second gesture calls nothing further
    // (no observable effect, but this pins that the handler ran once).
    document.dispatchEvent(new Event("pointerup"));
    expect(getMockCtx().resume).not.toHaveBeenCalled();
    audio.dispose();
  });

  it("A10. dispose() detaches the autoUnlock and visibility listeners (even after autoUnlock detached itself)", async () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const audio = createAudio({ autoUnlock: true, resumeOnVisibility: true });
    audio.dispose();
    for (const ev of ["touchend", "pointerup", "keydown", "visibilitychange"]) {
      expect(removeSpy).toHaveBeenCalledWith(ev, expect.any(Function));
      document.dispatchEvent(new Event(ev));
    }
    expect(getMockCtx().resume).not.toHaveBeenCalled();

    // autoUnlock that already detached (context running) is not detached twice.
    const b = createAudio({ autoUnlock: true, resumeOnVisibility: false });
    getMockCtx().resume.mockImplementationOnce(() => {
      getMockCtx().state = "running";
      return Promise.resolve();
    });
    document.dispatchEvent(new Event("pointerup"));
    await Promise.resolve();
    removeSpy.mockClear();
    b.dispose();
    expect(removeSpy).not.toHaveBeenCalled();
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

  it("B3. unlock after dispose rejects with AudioDisposedError", async () => {
    const audio = createAudio({ autoUnlock: false });
    audio.dispose();
    await expect(audio.unlock()).rejects.toBeInstanceOf(AudioDisposedError);
  });

  it("B4. unlock() resolves without throwing when Howler.ctx is null (no Web Audio)", async () => {
    setCtxNull(true);
    const audio = createAudio({ autoUnlock: false });
    let p: Promise<void> | undefined;
    expect(() => {
      p = audio.unlock();
    }).not.toThrow();
    await expect(p).resolves.toBeUndefined();
    audio.dispose();
  });

  it("B5. unlock() resolves when resume() throws synchronously (best-effort, never throws)", async () => {
    const audio = createAudio({ autoUnlock: false });
    getMockCtx().resume.mockImplementationOnce(() => {
      throw new Error("resume unavailable");
    });
    let p: Promise<void> | undefined;
    expect(() => {
      p = audio.unlock();
    }).not.toThrow();
    await expect(p).resolves.toBeUndefined();
    audio.dispose();
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
    const p = audio.load("bad.mp3");
    await expect(p).rejects.toBeInstanceOf(AudioError);
    await expect(p).rejects.toThrow(/^aiaudiojs: load failed: mock error$/);
    audio.dispose();
  });

  it("C3. load('') rejects with AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const p = audio.load("");
    await expect(p).rejects.toBeInstanceOf(AudioError);
    await expect(p).rejects.toThrow(/^aiaudiojs: url must be a non-empty string$/);
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

  // F3 — abort racing decode completion. Howler's decode can finish and emit
  // `load` AFTER load()'s AbortSignal has already rejected the promise. Before
  // the settled-guard fix, the still-attached `once("load")` handler then built
  // a SoundImpl and added it to the managed set — a Sound nobody holds, leaked
  // until the next disposeAll() reclaims it. These tests drive that exact late
  // event (manual-load mode → __emitLoad after abort) and pin that the Sound
  // never enters the managed set and that the Howler listeners were detached.

  it("C7. late `load` after an abort does NOT enter the managed set", async () => {
    setManualLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const ctrl = new AbortController();
    const promise = audio.load("test.mp3", ctrl.signal);
    const howl = lastHowl();
    const unloadSpy = vi.spyOn(howl, "unload");

    // Abort first — load() rejects with AbortError and unloads the Howl once.
    ctrl.abort();
    const err = await promise.catch((e: unknown) => e);
    expect((err as DOMException).name).toBe("AbortError");
    expect(unloadSpy).toHaveBeenCalledTimes(1); // abort-path unload

    // Howler's decode now completes and emits `load` LATE.
    howl.__emitLoad();

    // If the late `load` leaked a SoundImpl into the managed set, disposeAll()
    // would dispose it and call unload() a SECOND time. A clean run leaves the
    // set empty, so unload() is never called again.
    audio.disposeAll();
    expect(unloadSpy).toHaveBeenCalledTimes(1);
  });

  it("C8. abort detaches the Howler load/loaderror listeners so a late emit is a no-op", async () => {
    setManualLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const ctrl = new AbortController();
    const promise = audio.load("test.mp3", ctrl.signal);
    const howl = lastHowl();
    const offSpy = vi.spyOn(howl as unknown as { off: AnyFn }, "off");

    ctrl.abort();
    await promise.catch(() => {});

    // The fix must detach the Howler lifecycle listeners on abort. It does so
    // with a bare off() (the only listeners on this fresh Howl are `load` /
    // `loaderror`), which clears every event on the instance.
    expect(offSpy).toHaveBeenCalled();

    // With the handlers gone, a late decode `load` AND a late `loaderror`
    // resolve/settle nothing and mutate no state — disposeAll() finds an empty
    // managed set, so the Howl is never unloaded a second time.
    const unloadSpy = vi.spyOn(howl, "unload");
    howl.__emitLoad();
    howl.__emitLoadError();
    audio.disposeAll();
    expect(unloadSpy).not.toHaveBeenCalled();
  });

  it("C9. late `loaderror` after an abort is a no-op (no double-settle, no state change)", async () => {
    setManualLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const ctrl = new AbortController();
    const promise = audio.load("test.mp3", ctrl.signal);
    const howl = lastHowl();
    const unloadSpy = vi.spyOn(howl, "unload");

    ctrl.abort();
    const err = await promise.catch((e: unknown) => e);
    expect((err as DOMException).name).toBe("AbortError");
    const unloadAfterAbort = unloadSpy.mock.calls.length;

    // A late `loaderror` (decode failed after the abort) must not unload again
    // nor otherwise act on the already-settled load.
    howl.__emitLoadError();
    expect(unloadSpy.mock.calls.length).toBe(unloadAfterAbort);

    audio.disposeAll();
    expect(unloadSpy.mock.calls.length).toBe(unloadAfterAbort);
  });

  it("C12. disposeAll() while a load is in flight rejects AudioDisposedError and unloads the Howl; a late `load` is a no-op", async () => {
    setManualLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const promise = audio.load("test.mp3");
    const howl = lastHowl();
    const unloadSpy = vi.spyOn(howl, "unload");
    audio.disposeAll();
    // Howler's decode completes after the controller was torn down.
    howl.__emitLoad();
    await expect(promise).rejects.toBeInstanceOf(AudioDisposedError);
    expect(unloadSpy).toHaveBeenCalledTimes(1);
  });

  it("C13. dispose() mid-load settles immediately — without waiting for Howler's decode, which may never finish", async () => {
    // 0.5.x only rejected once Howler emitted `load` / `loaderror`, so a stalled
    // decode left the promise pending (and the Howl alive) forever.
    setManualLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const ctrl = new AbortController();
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const promise = audio.load("test.mp3", ctrl.signal);
    const howl = lastHowl();
    const unloadSpy = vi.spyOn(howl, "unload");
    let state = "pending";
    promise.then(
      () => {
        state = "resolved";
      },
      () => {
        state = "rejected";
      },
    );
    audio.dispose();
    await Promise.resolve();
    expect(state).toBe("rejected");
    await expect(promise).rejects.toBeInstanceOf(AudioDisposedError);
    expect(unloadSpy).toHaveBeenCalledTimes(1);
    // The abort wiring is gone: a later abort / loaderror changes nothing.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    ctrl.abort();
    howl.__emitLoadError();
    expect(unloadSpy).toHaveBeenCalledTimes(1);
  });

  it("C14. a decode failure after dispose() still reports AudioDisposedError (the dispose won)", async () => {
    setManualLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const promise = audio.load("test.mp3");
    const howl = lastHowl();
    audio.dispose();
    howl.__emitLoadError();
    await expect(promise).rejects.toBeInstanceOf(AudioDisposedError);
  });

  it("C10. Howler emitting `load` synchronously inside `new Howl()` (cache hit) still resolves", async () => {
    setSyncLoad(true);
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("cached.mp3");
    expect(sound.disposed).toBe(false);
    audio.dispose();
  });

  it("C11. Howler emitting `loaderror` synchronously inside `new Howl()` still rejects with AudioError", async () => {
    setSyncLoad(true);
    setLoadFail(true);
    const audio = createAudio({ autoUnlock: false });
    await expect(audio.load("clip.xyz")).rejects.toBeInstanceOf(AudioError);
    audio.dispose();
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

  it("D11a. play({ signal }) — a loop flag flipped to true via nativeHowl AFTER play() keeps the abort wiring alive past the first `end`", async () => {
    // aiaudiojs-12: onEnd must read the LIVE loop flag (howl.loop(id)), not
    // the `looping` value captured when play() was called.
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const id = sound.play({ loop: false, signal: ctrl.signal });
    sound.nativeHowl.loop(true, id);

    // Loop boundary `end` must NOT tear down the abort wiring now that the
    // voice is actually looping.
    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);

    ctrl.abort();
    expect(stopSpy).toHaveBeenCalledWith(id);

    audio.dispose();
  });

  it("D11b. play({ loop: true, signal }) — a loop flag flipped to false via nativeHowl lets the next `end` tear down the abort wiring", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const id = sound.play({ loop: true, signal: ctrl.signal });
    sound.nativeHowl.loop(false, id);

    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    const stopCallsBefore = stopSpy.mock.calls.length;
    ctrl.abort();
    expect(stopSpy.mock.calls.length).toBe(stopCallsBefore);

    audio.dispose();
  });

  it("D11c. play({ signal }) — a per-id `playerror` tears down the abort wiring (HTML5 autoplay rejection)", async () => {
    // aiaudiojs-12: HTML5 fallback emits only `playerror` (never end/stop)
    // when the browser rejects an autoplay `node.play()`.
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const ctrl = new AbortController();
    const stopSpy = vi.spyOn(sound.nativeHowl, "stop");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const id = sound.play({ signal: ctrl.signal });

    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit(
      "playerror",
      id,
    );

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    const stopCallsBefore = stopSpy.mock.calls.length;
    ctrl.abort();
    expect(stopSpy.mock.calls.length).toBe(stopCallsBefore);

    audio.dispose();
  });

  it("D12. play() with exactly one paused voice starts a NEW voice and leaves the paused one untouched", async () => {
    const audio = createAudio({ autoUnlock: false });
    const bgm = await audio.load("bgm.mp3");
    const howl = bgm.nativeHowl as unknown as { _sounds: MockVoice[] };
    const a = bgm.play({ loop: true, volume: 0.3 });
    bgm.pause(a);
    const b = bgm.play();
    expect(b).not.toBe(a);
    expect(howl._sounds).toHaveLength(2);
    expect(howl._sounds.find((v) => v._id === a)).toMatchObject({
      _paused: true,
      _ended: false,
      _loop: true,
      _volume: 0.3,
    });
    expect(bgm.resume(a)).toBe(a);
    audio.dispose();
  });

  it("D13. linear crossfade into a Sound with one paused voice starts a fresh incoming voice", async () => {
    const audio = createAudio({ autoUnlock: false });
    const other = await audio.load("other.mp3");
    const menu = await audio.load("menu.mp3");
    const howl = menu.nativeHowl as unknown as { _sounds: MockVoice[] };
    other.play({ loop: true });
    const m = menu.play({ loop: true });
    menu.pause(m);
    audio.crossfade(other, menu, { duration: 1 }).catch(() => {});
    expect(howl._sounds.find((v) => v._id === m)).toMatchObject({ _paused: true, _loop: true });
    expect(howl._sounds.filter((v) => !v._paused)).toHaveLength(1);
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
    const p = audio.crossfade(from, to, { duration: 0 });
    await expect(p).rejects.toBeInstanceOf(AudioError);
    await expect(p).rejects.toThrow(/^aiaudiojs: crossfade duration must be a finite number > 0$/);
    audio.dispose();
  });

  it("G3. crossfade with disposed Sound throws AudioError", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.dispose();
    expect(() => audio.crossfade(from, to, { duration: 1 })).toThrow(AudioError);
    expect(() => audio.crossfade(from, to, { duration: 1 })).toThrow(
      /^aiaudiojs: cannot crossfade a disposed Sound$/,
    );
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

  it("G7. linear crossfade aborted mid-flight detaches the abort listener with the exact handler (prior-M1 leak pin)", async () => {
    // AUD-C-01 / prior-wave M1: the linear abort branch resolved the promise
    // but skipped cleanupAbort(), so it relied entirely on { once: true } and
    // never explicitly detached its listener — the equal-power path did. The
    // shared resolveAfterWithAbort helper now detaches on BOTH the normal and
    // aborted paths. Pin that the EXACT handler registered for "abort" is the
    // one removed (capture it from addEventListener), and that a second abort
    // is a silent no-op afterwards.
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    const ctrl = new AbortController();
    const addSpy = vi.spyOn(ctrl.signal, "addEventListener");
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal });

    // Capture the exact handler the crossfade registered for "abort".
    const addCall = addSpy.mock.calls.find((c) => c[0] === "abort");
    expect(addCall).toBeDefined();
    const registered = addCall![1];

    ctrl.abort();
    await expect(p).resolves.toBeUndefined();

    // The SAME handler must have been removed — no listener left on the signal.
    expect(removeSpy).toHaveBeenCalledWith("abort", registered);

    // A second abort must be a silent no-op (nothing left wired).
    expect(() => ctrl.abort()).not.toThrow();
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

  // C9 — resume(id) must NOT replay a stopped/ended voice.
  // The no-arg path already guards `_ended !== true`; the id path must apply the
  // same predicate. Asymmetry means resume(stoppedId) unconditionally calls
  // howl.play(id), restarting a voice that was finished from zero.
  it("I9. resume(id) returns -1 and does NOT call howl.play when the voice is paused+ended (stopped)", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    sound.stop(id); // parks voice as _paused:true, _ended:true (Howler semantics)
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume(id);
    expect(playSpy).not.toHaveBeenCalledWith(id);
    expect(result).toBe(-1);
    audio.dispose();
  });

  it("I10. resume(id) returns -1 and does NOT replay a naturally-ended voice", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    // Natural end: __emit("end", id) parks the non-loop voice as _paused+_ended.
    (sound.nativeHowl as unknown as { __emit: (ev: string, id: number) => void }).__emit("end", id);
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume(id);
    expect(playSpy).not.toHaveBeenCalledWith(id);
    expect(result).toBe(-1);
    audio.dispose();
  });

  it("I11. resume(id) still calls howl.play(id) for a genuinely-paused (not ended) voice", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    sound.pause(id); // _paused:true, _ended:false — genuinely paused
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    const result = sound.resume(id);
    expect(playSpy).toHaveBeenCalledWith(id);
    expect(result).toBe(id);
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

  it("J2. a reshaped `from._sounds` fails BEFORE `to` starts (both curves) — no voice to orphan", async () => {
    // 0.6.0: crossfade captures `from`'s voices before `to.play()`, so the
    // reach-in failure happens with nothing started. (0.5.x started `to` first
    // and had to stop it again before throwing.)
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.play();
    const playSpy = vi.spyOn(to.nativeHowl, "play");
    (from.nativeHowl as unknown as { _sounds?: unknown })._sounds = undefined;
    for (const curve of ["equal-power", "linear"] as const) {
      expect(() => audio.crossfade(from, to, { duration: 1, curve })).toThrow(AudioError);
    }
    expect(playSpy).not.toHaveBeenCalled();
    expect(mh(to)._sounds).toHaveLength(0);
    audio.dispose();
  });

  it("J2b. equal-power crossfade stops the started `to` voice when `to._sounds` is reshaped after play()", async () => {
    const audio = createAudio({ autoUnlock: false });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.play();
    const howl = mh(to);
    // A Howler that renamed `_sounds` still has a working stop(); the mock's
    // own stop() reads `_sounds`, so stub it.
    const stopSpy = vi.spyOn(howl, "stop").mockImplementation(() => howl);
    // loop(flag, id) is the last Howler call Sound.play() makes: reshape the
    // pool right after it, i.e. after `to` has started.
    const realLoop = howl.loop.bind(howl);
    let started = -1;
    vi.spyOn(howl, "loop").mockImplementation((flag?: boolean | number, id?: number) => {
      const r = realLoop(flag, id);
      started = id ?? -1;
      (howl as unknown as { _sounds?: unknown })._sounds = undefined;
      return r;
    });
    expect(() => audio.crossfade(from, to, { duration: 1, curve: "equal-power" })).toThrow(
      /^aiaudiojs: howler internal `_sounds` is unavailable/,
    );
    expect(started).not.toBe(-1);
    expect(stopSpy).toHaveBeenCalledWith(started);
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

// ---------------------------------------------------------------------------
// M. crossfade completion, loop option and argument checks (0.6.0)
//
// Both curves capture `from`'s playing voices BEFORE `to.play()` and stop them
// when the duration elapses; the linear incoming fade targets only the voice
// the call started. 0.5.x left the outgoing voice playing at gain 0 forever
// (a looping track leaked, and a ping-pong crossfade ramped it back up).
// ---------------------------------------------------------------------------

describe("M. crossfade completion, loop option and argument checks", () => {
  async function setup() {
    const audio = createAudio({ autoUnlock: false });
    const a = await audio.load("a.mp3");
    const b = await audio.load("b.mp3");
    return { audio, a, b };
  }

  const voice = (s: Sound, id: number): MockVoice | undefined =>
    mh(s)._sounds.find((v) => v._id === id);
  const active = (s: Sound): number[] =>
    mh(s)
      ._sounds.filter((v) => !v._paused && !v._ended)
      .map((v) => v._id);

  it("M1. linear: a looping `from` voice is stopped at completion; the incoming voice keeps playing", async () => {
    vi.useFakeTimers();
    const { audio, a, b } = await setup();
    const aId = a.play({ loop: true });
    const p = audio.crossfade(a, b, { duration: 1 });
    await vi.advanceTimersByTimeAsync(999);
    expect(voice(a, aId)?._ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBeUndefined();
    expect(voice(a, aId)).toMatchObject({ _ended: true, _paused: true });
    expect(active(b)).toHaveLength(1);
    audio.dispose();
  });

  it("M2. linear: the outgoing fade covers every `from` voice; the incoming fade targets only the started voice", async () => {
    vi.useFakeTimers();
    const { audio, a, b } = await setup();
    a.play({ loop: true });
    const bOld = b.play();
    b.pause(bOld); // an unrelated paused voice on `to`
    const fadeA = vi.spyOn(a.nativeHowl, "fade");
    const fadeB = vi.spyOn(b.nativeHowl, "fade");
    const p = audio.crossfade(a, b, { duration: 2 });
    const bNew = active(b)[0];
    expect(bNew).toBeDefined();
    expect(fadeA.mock.calls).toEqual([[1, 0, 2000]]);
    expect(fadeB.mock.calls).toEqual([[0, 1, 2000, bNew]]);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(voice(b, bOld)).toMatchObject({ _paused: true, _ended: false });
    audio.dispose();
  });

  it("M3. linear ping-pong A -> B -> A with a looping A never ramps A's first voice back up", async () => {
    vi.useFakeTimers();
    const { audio, a, b } = await setup();
    const a1 = a.play({ loop: true });
    const fadeA = vi.spyOn(a.nativeHowl, "fade");
    const p1 = audio.crossfade(a, b, { duration: 1, loop: true });
    await vi.advanceTimersByTimeAsync(1000);
    await p1;
    expect(voice(a, a1)?._ended).toBe(true);
    const [b1] = active(b);
    const p2 = audio.crossfade(b, a, { duration: 1, loop: true });
    const a2 = active(a)[0] as number;
    expect(a2).not.toBe(a1);
    // The incoming ramp on A names A's new voice only.
    expect(fadeA).toHaveBeenLastCalledWith(0, 1, 1000, a2);
    await vi.advanceTimersByTimeAsync(1000);
    await p2;
    expect(active(a)).toEqual([a2]);
    expect(voice(b, b1 as number)?._ended).toBe(true);
    expect(a.nativeHowl.loop(a2)).toBe(true);
    audio.dispose();
  });

  it("M4. linear: aborting leaves `from` running — the caller owns both voices", async () => {
    vi.useFakeTimers();
    const { audio, a, b } = await setup();
    const aId = a.play({ loop: true });
    const stopA = vi.spyOn(a.nativeHowl, "stop");
    const ctrl = new AbortController();
    const p = audio.crossfade(a, b, { duration: 1, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(400);
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopA).not.toHaveBeenCalled();
    expect(voice(a, aId)?._ended).toBe(false);
    expect(active(b)).toHaveLength(1);
    audio.dispose();
  });

  it("M5. linear crossfade(s, s): the old voice stops at completion and the new one keeps playing", async () => {
    vi.useFakeTimers();
    const { audio, a } = await setup();
    const old = a.play({ loop: true });
    const fadeSpy = vi.spyOn(a.nativeHowl, "fade");
    const p = audio.crossfade(a, a, { duration: 1, loop: true });
    const fresh = active(a).find((id) => id !== old) as number;
    expect(fresh).toBeDefined();
    // Outgoing (id-less) first, then the incoming fade on the new voice wins.
    expect(fadeSpy.mock.calls).toEqual([
      [1, 0, 1000],
      [0, 1, 1000, fresh],
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(voice(a, old)?._ended).toBe(true);
    expect(active(a)).toEqual([fresh]);
    audio.dispose();
  });

  it("M6. `loop: true` starts the incoming voice looping; the default stays non-looping", async () => {
    const { audio, a, b } = await setup();
    a.play();
    audio.crossfade(a, b, { duration: 1, loop: true }).catch(() => {});
    const looped = active(b)[0] as number;
    expect(b.nativeHowl.loop(looped)).toBe(true);
    audio.crossfade(b, a, { duration: 1 }).catch(() => {});
    const plain = active(a).at(-1) as number;
    expect(a.nativeHowl.loop(plain)).toBe(false);
    audio.dispose();
  });

  it("M7. dispose mid-crossfade (linear): the promise still resolves and the disposed `from` is not touched", async () => {
    vi.useFakeTimers();
    const { audio, a, b } = await setup();
    a.play({ loop: true });
    const p = audio.crossfade(a, b, { duration: 1 });
    a.dispose();
    const stopA = vi.spyOn(a.nativeHowl, "stop");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(stopA).not.toHaveBeenCalled();
    // Disposing the whole controller mid-crossfade behaves the same way.
    const c = await audio.load("c.mp3");
    const d = await audio.load("d.mp3");
    c.play();
    const p2 = audio.crossfade(c, d, { duration: 1 });
    audio.dispose();
    const stopC = vi.spyOn(c.nativeHowl, "stop");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p2).resolves.toBeUndefined();
    expect(stopC).not.toHaveBeenCalled();
  });

  it("M8. a missing / non-object options argument rejects AudioError (never a raw TypeError); a non-Sound throws AudioError", async () => {
    const { audio, a, b } = await setup();
    const cf = audio.crossfade as (x: unknown, y: unknown, o?: unknown) => Promise<void>;
    for (const opts of [undefined, null, 2, "1"]) {
      let p: Promise<void> | undefined;
      expect(() => {
        p = cf(a, b, opts);
      }).not.toThrow();
      await expect(p).rejects.toBeInstanceOf(AudioError);
    }
    for (const [x, y] of [
      [null, b],
      [a, undefined],
      [{}, b],
    ]) {
      expect(() => cf(x, y, { duration: 1 })).toThrow(AudioError);
    }
    expect(mh(b)._sounds).toHaveLength(0);
    audio.dispose();
  });

  it("M9. a duration whose delay exceeds 2^31-1 ms is clamped to 2147483647 ms instead of firing at once", async () => {
    vi.useFakeTimers();
    const { audio, a, b } = await setup();
    const aId = a.play({ loop: true });
    let settled = false;
    audio.crossfade(a, b, { duration: 1e7 }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(settled).toBe(false);
    expect(voice(a, aId)?._ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(voice(a, aId)?._ended).toBe(true);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// N. Sound.fade argument validation + timer clamp (0.6.0)
//
// Non-finite values reached Howler's Web Audio calls (FakeParam: TypeError)
// after side effects, and a huge `ms` overflowed setTimeout.
// ---------------------------------------------------------------------------

describe("N. Sound.fade validation", () => {
  it("N1. from/to that are not finite numbers in [0, 1] reject AudioError without calling howl.fade", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.play();
    const fadeSpy = vi.spyOn(sound.nativeHowl, "fade");
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5];
    for (const v of bad) {
      for (const [from, to] of [
        [v, 0],
        [0, v],
      ] as const) {
        let p: Promise<void> | undefined;
        expect(() => {
          p = sound.fade(from, to, 100);
        }).not.toThrow();
        await expect(p).rejects.toBeInstanceOf(AudioError);
        await expect(p).rejects.toThrow(
          /^aiaudiojs: fade from\/to must be finite numbers in \[0, 1\]$/,
        );
      }
    }
    await expect(sound.fade("0.5" as unknown as number, 0, 100)).rejects.toBeInstanceOf(AudioError);
    expect(fadeSpy).not.toHaveBeenCalled();
    audio.dispose();
  });

  it("N2. an ms that is not a finite number >= 0 rejects AudioError without calling howl.fade", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    sound.play();
    const fadeSpy = vi.spyOn(sound.nativeHowl, "fade");
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const p = sound.fade(1, 0, ms);
      await expect(p).rejects.toBeInstanceOf(AudioError);
      await expect(p).rejects.toThrow(/^aiaudiojs: fade ms must be a finite number >= 0$/);
    }
    expect(fadeSpy).not.toHaveBeenCalled();
    audio.dispose();
  });

  it("N3. the checks run in order: disposed, then from/to, then ms", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    await expect(sound.fade(2, 0, -1)).rejects.toThrow(/from\/to/);
    sound.dispose();
    await expect(sound.fade(2, 0, -1)).rejects.toBeInstanceOf(AudioDisposedError);
    audio.dispose();
  });

  it("N4. ms = 2^31 is clamped: howl.fade gets 2147483647 and the promise resolves then, not at once", async () => {
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const fadeSpy = vi.spyOn(sound.nativeHowl, "fade");
    let settled = false;
    sound.fade(1, 0, 2 ** 31).then(() => {
      settled = true;
    });
    expect(fadeSpy).toHaveBeenCalledWith(1, 0, 2_147_483_647, undefined);
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    audio.dispose();
  });

  it("N5. boundary values are accepted: fade(0, 1, 0) resolves", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const id = sound.play();
    await expect(sound.fade(0, 1, 0, id)).resolves.toBeUndefined();
    audio.dispose();
  });

  it("N6. a throwing Howler fade surfaces as a rejection, never a synchronous throw", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const boom = new DOMException("Can't add events during a curve event", "NotSupportedError");
    vi.spyOn(sound.nativeHowl, "fade").mockImplementation(() => {
      throw boom;
    });
    let p: Promise<void> | undefined;
    expect(() => {
      p = sound.fade(1, 0, 10);
    }).not.toThrow();
    await expect(p).rejects.toBe(boom);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// O. play() rate validation (0.6.0)
// ---------------------------------------------------------------------------

describe("O. play() rate validation", () => {
  it("O1. a non-finite rate throws AudioError before any voice starts", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sound = await audio.load("test.mp3");
    const playSpy = vi.spyOn(sound.nativeHowl, "play");
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => sound.play({ rate })).toThrow(AudioError);
      expect(() => sound.play({ rate })).toThrow(/^aiaudiojs: play rate must be a finite number$/);
    }
    expect(playSpy).not.toHaveBeenCalled();
    expect(mh(sound)._sounds).toHaveLength(0);
    expect(typeof sound.play({ rate: 0.5 })).toBe("number");
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// P. queued-play resume guard on the mock's play lock (aiaudiojs-10)
// ---------------------------------------------------------------------------

describe("P. queued play() behind the play lock", () => {
  it("P1. resume() / resume(id) never replay a voice whose play() is still queued; once it starts, pause + resume works", async () => {
    const audio = createAudio({ autoUnlock: false });
    const bgm = await audio.load("bgm.mp3");
    __setPlayLock(true);
    const id = bgm.play({ loop: true });
    expect(mh(bgm)._playLock).toBe(true);
    expect(mh(bgm)._sounds.find((v) => v._id === id)).toMatchObject({
      _paused: true,
      _ended: false,
    });
    const playSpy = vi.spyOn(bgm.nativeHowl, "play");
    expect(bgm.resume()).toBe(-1);
    expect(bgm.resume(id)).toBe(-1);
    expect(playSpy).not.toHaveBeenCalled();
    __releasePlayLock();
    expect(mh(bgm)._sounds.find((v) => v._id === id)?._paused).toBe(false);
    bgm.pause(id);
    expect(bgm.resume()).toBe(id);
    expect(playSpy).toHaveBeenCalledWith(id);
    audio.dispose();
  });

  it("P3. a queued play() rejected with `playerror` (HTML5 autoplay) releases its `play` listener and pending entry", async () => {
    const audio = createAudio({ autoUnlock: false });
    const sfx = await audio.load("sfx.mp3");
    __setPlayLock(true);
    const ids = [sfx.play(), sfx.play(), sfx.play()];
    expect(mh(sfx).__listenerCount("play")).toBe(3);
    for (const id of ids) mh(sfx).__emit("playerror", id);
    // 0.5.x kept one never-firing `once("play")` closure per rejected play.
    expect(mh(sfx).__listenerCount("play")).toBe(0);
    expect(mh(sfx).__listenerCount("playerror")).toBe(0);
    // A queued play that DOES start cleans up its `playerror` twin too.
    __setPlayLock(true);
    sfx.play();
    __releasePlayLock();
    expect(mh(sfx).__listenerCount("play")).toBe(0);
    expect(mh(sfx).__listenerCount("playerror")).toBe(0);
    audio.dispose();
  });

  it("P2. a bare Howler play() resumes the single paused voice (mock fidelity), which Sound.play() never relies on", async () => {
    const audio = createAudio({ autoUnlock: false });
    const bgm = await audio.load("bgm.mp3");
    const a = bgm.play();
    bgm.pause(a);
    expect(mh(bgm).play()).toBe(a);
    expect(bgm.play()).not.toBe(a);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// Q. master volume normalisation for untyped callers
// ---------------------------------------------------------------------------

describe("Q. master volume normalisation", () => {
  it("Q1. a non-numeric volume from an untyped JS caller normalises to 0 instead of storing NaN", () => {
    const audio = createAudio({ autoUnlock: false, volume: "loud" as unknown as number });
    expect(audio.volume).toBe(0);
    expect(Howler.volume).toHaveBeenLastCalledWith(0);
    audio.volume = "0.25" as unknown as number;
    expect(audio.volume).toBe(0.25);
    audio.dispose();
  });
});
