// aiaudiojs v0.3.0 — equal-power crossfade test suite.
//
// Environment: happy-dom (provides AbortSignal, DOMException).
// Howler is mocked in this file with an extended mock that exposes
// _sounds (with per-sound _node.gain AudioParam), __setHtml5Mode,
// __resetSoundId, __getMockCtx, and __forceCtxUndefined helpers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Extended Howler mock — MUST appear before any import that uses howler.
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => void;

vi.mock("howler", () => {
  const handlers = new Map<object, Map<string, AnyFn>>();
  let nextSoundId = 1;
  let mockHtml5Mode = false;
  let forceCtxUndefined = false;

  function makeMockGainParam() {
    return {
      value: 1,
      setValueAtTime: vi.fn(),
      setValueCurveAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    };
  }

  const mockCtx = {
    state: "running",
    currentTime: 0,
    resume: vi.fn().mockResolvedValue(undefined),
    // createGain is kept so audio.test.ts mock compatibility is not needed
    // here; this file is separate. We keep it to avoid crashing if any code
    // path touches it, but the new equal-power src does NOT call createGain.
    createGain: vi.fn(() => ({
      gain: makeMockGainParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };

  class Howl {
    _sounds: Array<{ _id: number; _node: { gain?: ReturnType<typeof makeMockGainParam> } | {} }> =
      [];
    opts: { src: string[]; preload?: boolean };
    fade = vi.fn();
    volume = vi.fn();
    rate = vi.fn();
    loop = vi.fn();
    stop = vi.fn();
    pause = vi.fn();
    unload = vi.fn();

    constructor(opts: { src: string[]; preload?: boolean }) {
      this.opts = opts;
      handlers.set(this, new Map());
      Promise.resolve().then(() => {
        const map = handlers.get(this);
        if (map === undefined) return;
        const cb = map.get("load");
        cb?.(undefined, undefined);
      });
    }

    once(event: string, cb: AnyFn): void {
      handlers.get(this)?.set(event, cb);
    }

    play(): number {
      const id = nextSoundId++;
      // Web Audio mode: _node has a .gain AudioParam.
      // HTML5 mode: _node has no .gain.
      const node = mockHtml5Mode ? ({} as {}) : { gain: makeMockGainParam() };
      this._sounds.push({ _id: id, _node: node });
      return id;
    }
  }

  function __setHtml5Mode(v: boolean): void {
    mockHtml5Mode = v;
  }

  function __resetSoundId(): void {
    nextSoundId = 1;
  }

  function __getMockCtx() {
    return mockCtx;
  }

  function __forceCtxUndefined(v: boolean): void {
    forceCtxUndefined = v;
  }

  return {
    Howl,
    Howler: {
      get ctx() {
        return forceCtxUndefined ? undefined : mockCtx;
      },
      volume: vi.fn(),
    },
    __setHtml5Mode,
    __resetSoundId,
    __getMockCtx,
    __forceCtxUndefined,
  };
});

// ---------------------------------------------------------------------------
// Imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { __forceCtxUndefined, __getMockCtx, __resetSoundId, __setHtml5Mode } from "howler";
import { AudioDisposedError, AudioError, createAudio } from "../src/index.js";

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

function setHtml5Mode(v: boolean): void {
  (__setHtml5Mode as (v: boolean) => void)(v);
}

function resetSoundId(): void {
  (__resetSoundId as () => void)();
}

function getMockCtx(): ReturnType<typeof __getMockCtx> {
  return (__getMockCtx as () => ReturnType<typeof __getMockCtx>)();
}

function forceCtxUndefined(v: boolean): void {
  (__forceCtxUndefined as (v: boolean) => void)(v);
}

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

async function makeAudioWithSounds() {
  const audio = createAudio({ autoUnlock: false });
  const from = await audio.load("a.mp3");
  const to = await audio.load("b.mp3");
  return { audio, from, to };
}

// Helper: get the gain param from the first _sound of a nativeHowl.
type GainParam = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setValueCurveAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
};

function getFirstGain(sound: { nativeHowl: { _sounds: Array<{ _node?: { gain?: GainParam } }> } }) {
  const node = sound.nativeHowl._sounds[0]?._node as { gain?: GainParam } | undefined;
  return node?.gain;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setHtml5Mode(false);
  forceCtxUndefined(false);
  resetSoundId();
  vi.clearAllMocks();
  getMockCtx().currentTime = 0;
  getMockCtx().resume.mockResolvedValue(undefined);
});

afterEach(() => {
  setHtml5Mode(false);
  forceCtxUndefined(false);
});

// ---------------------------------------------------------------------------
// Group A — backward-compat (linear path)
// ---------------------------------------------------------------------------

describe("A. backward-compat linear path", () => {
  it("A1: no curve option calls Howl.fade() on both sounds; no _node.gain.setValueCurveAtTime; resolves after duration", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    const fadeSpy = vi.spyOn(from.nativeHowl, "fade");
    const fadeSpy2 = vi.spyOn(to.nativeHowl, "fade");
    const p = audio.crossfade(from, to, { duration: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(fadeSpy).toHaveBeenCalledTimes(1);
    expect(fadeSpy2).toHaveBeenCalledTimes(1);
    // No gain scheduling in linear path.
    const fromGain = getFirstGain(
      from as unknown as {
        nativeHowl: { _sounds: Array<{ _node?: { gain?: GainParam } }> };
      },
    );
    const toGain = getFirstGain(
      to as unknown as {
        nativeHowl: { _sounds: Array<{ _node?: { gain?: GainParam } }> };
      },
    );
    // to's play is called in linear path too; but gain scheduling should not happen.
    if (fromGain !== undefined) {
      expect(fromGain.setValueCurveAtTime).not.toHaveBeenCalled();
    }
    if (toGain !== undefined) {
      expect(toGain.setValueCurveAtTime).not.toHaveBeenCalled();
    }
    audio.dispose();
    vi.useRealTimers();
  });

  it("A2: curve: 'linear' is identical to no curve — calls Howl.fade(), no setValueCurveAtTime", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    const fadeSpy = vi.spyOn(from.nativeHowl, "fade");
    const fadeSpy2 = vi.spyOn(to.nativeHowl, "fade");
    const p = audio.crossfade(from, to, { duration: 1, curve: "linear" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(fadeSpy).toHaveBeenCalledTimes(1);
    expect(fadeSpy2).toHaveBeenCalledTimes(1);
    audio.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Group B — equal-power baseline
// ---------------------------------------------------------------------------

describe("B. equal-power baseline", () => {
  it("B1: incoming (to) is started via to.play({ volume: 0 })", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play(); // from is assumed already playing
    const toPlaySpy = vi.spyOn(to.nativeHowl, "play");
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(toPlaySpy).toHaveBeenCalled();
    audio.dispose();
    vi.useRealTimers();
  });

  it("B2: from.nativeHowl.play is NOT called by the crossfade (only the setup call counts)", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play(); // setup call
    const fromPlaySpy = vi.spyOn(from.nativeHowl, "play");
    const countBefore = fromPlaySpy.mock.calls.length; // should be 0 since we just spied
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    // crossfade must not have called from.nativeHowl.play
    expect(fromPlaySpy.mock.calls.length).toBe(countBefore);
    audio.dispose();
    vi.useRealTimers();
  });

  it("B3: Howl.fade() is NOT called in equal-power path", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const fadeSpy = vi.spyOn(from.nativeHowl, "fade");
    const fadeSpy2 = vi.spyOn(to.nativeHowl, "fade");
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(fadeSpy).not.toHaveBeenCalled();
    expect(fadeSpy2).not.toHaveBeenCalled();
    audio.dispose();
    vi.useRealTimers();
  });

  it("B4: from's _node.gain.setValueCurveAtTime called once with Float32Array(64) and correct duration; cancelScheduledValues then setValueAtTime called first (order)", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    // from must have a sound already; the crossfade will use from's existing _sounds
    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _id: number; _node: { gain: GainParam } }>;
    };
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    const fromGain = fromHowl._sounds[0]!._node.gain;
    expect(fromGain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    const curveCall = fromGain.setValueCurveAtTime.mock.calls[0]!;
    expect(curveCall[0]).toBeInstanceOf(Float32Array);
    expect((curveCall[0] as Float32Array).length).toBe(64);
    expect(curveCall[2]).toBe(2);

    // Order: cancelScheduledValues → setValueAtTime → setValueCurveAtTime
    const cancelOrder = fromGain.cancelScheduledValues.mock.invocationCallOrder[0]!;
    const setAtTimeOrder = fromGain.setValueAtTime.mock.invocationCallOrder[0]!;
    const setCurveOrder = fromGain.setValueCurveAtTime.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(setAtTimeOrder);
    expect(setAtTimeOrder).toBeLessThan(setCurveOrder);
    audio.dispose();
    vi.useRealTimers();
  });

  it("B5: to's _node.gain.setValueAtTime(0, now) called before setValueCurveAtTime", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    // to's _sounds gets populated by to.play({ volume: 0 }) inside crossfadeEqualPower.
    const toHowl = to.nativeHowl as unknown as {
      _sounds: Array<{ _id: number; _node: { gain: GainParam } }>;
    };
    const toGain = toHowl._sounds[0]!._node.gain;

    expect(toGain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
    // setValueAtTime(0, now) is called on to's gain
    expect(toGain.setValueAtTime).toHaveBeenCalled();
    const setAtTimeCall = toGain.setValueAtTime.mock.calls[0]!;
    expect(setAtTimeCall[0]).toBe(0);

    // Order check: cancelScheduledValues → setValueAtTime → setValueCurveAtTime
    const cancelOrder = toGain.cancelScheduledValues.mock.invocationCallOrder[0]!;
    const setAtOrder = toGain.setValueAtTime.mock.invocationCallOrder[0]!;
    const setCurveOrder = toGain.setValueCurveAtTime.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(setAtOrder);
    expect(setAtOrder).toBeLessThan(setCurveOrder);
    audio.dispose();
    vi.useRealTimers();
  });

  it("B6: endpoint scaling — from curve[0] ≈ mv, curve[63] ≈ 0; to curve[0] ≈ 0, curve[63] ≈ mv (mv=1)", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    const toHowl = to.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    const fromGain = fromHowl._sounds[0]!._node.gain;
    const toGain = toHowl._sounds[0]!._node.gain;

    const fromCurve = fromGain.setValueCurveAtTime.mock.calls[0]![0] as Float32Array;
    const toCurve = toGain.setValueCurveAtTime.mock.calls[0]![0] as Float32Array;

    // from: cos curve, mv=1 → [0] ≈ 1, [63] ≈ 0
    expect(fromCurve[0]).toBeCloseTo(1, 5);
    expect(fromCurve[63]).toBeCloseTo(0, 5);
    // to: sin curve, mv=1 → [0] ≈ 0, [63] ≈ 1
    expect(toCurve[0]).toBeCloseTo(0, 5);
    expect(toCurve[63]).toBeCloseTo(1, 5);
    audio.dispose();
    vi.useRealTimers();
  });

  it("B8: promise resolves after setTimeout(dur*1000) via fake timers", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    let resolved = false;
    p.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
    audio.dispose();
    vi.useRealTimers();
  });

  it("B9: terminal _volume synced — outgoing 0, incoming mv (keeps Howler.mute() consistent)", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    // The schedule drives the gain node, but Howler's source-of-truth
    // `_volume` must also reach the terminal value so a later mute/unmute or
    // replay re-derives the correct gain (outgoing silent, incoming full).
    const fromHowl = from.nativeHowl as unknown as { _sounds: Array<{ _volume?: number }> };
    const toHowl = to.nativeHowl as unknown as { _sounds: Array<{ _volume?: number }> };
    expect(fromHowl._sounds[0]?._volume).toBe(0);
    expect(toHowl._sounds[0]?._volume).toBe(1);
    audio.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Group C — equal-power abort
// ---------------------------------------------------------------------------

describe("C. equal-power abort", () => {
  it("C1: mid-flight abort — cancelScheduledValues order < setValueAtTime order for abort-pair; promise resolves", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal, curve: "equal-power" });
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();

    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    const toHowl = to.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    const fromGain = fromHowl._sounds[0]!._node.gain;
    const toGain = toHowl._sounds[0]!._node.gain;

    for (const g of [fromGain, toGain]) {
      const cancelOrders = g.cancelScheduledValues.mock.invocationCallOrder;
      const setOrders = g.setValueAtTime.mock.invocationCallOrder;
      // Both have at least 2 calls (setup + abort).
      expect(cancelOrders.length).toBeGreaterThanOrEqual(2);
      expect(setOrders.length).toBeGreaterThanOrEqual(2);
      // Abort-pair: last cancelScheduledValues precedes last setValueAtTime.
      expect(cancelOrders[cancelOrders.length - 1]!).toBeLessThan(setOrders[setOrders.length - 1]!);
    }
    audio.dispose();
    vi.useRealTimers();
  });

  it("C2: pre-aborted signal rejects DOMException(AbortError); NO setValueCurveAtTime called", async () => {
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await audio
      .crossfade(from, to, { duration: 2, signal: ctrl.signal, curve: "equal-power" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");

    // No gain scheduling happened.
    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    if (fromHowl._sounds.length > 0 && fromHowl._sounds[0]?._node) {
      const gain = (fromHowl._sounds[0]._node as { gain?: GainParam }).gain;
      if (gain !== undefined) {
        expect(gain.setValueCurveAtTime).not.toHaveBeenCalled();
      }
    }
    audio.dispose();
  });

  it("C4: abort mid-fade — each touched sound's _volume equals the frozen gain value, not the terminal", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal, curve: "equal-power" });

    // Set a recognisable mid-fade value on the mock gain nodes before aborting.
    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _id: number; _node: { gain: GainParam }; _volume?: number }>;
    };
    const toHowl = to.nativeHowl as unknown as {
      _sounds: Array<{ _id: number; _node: { gain: GainParam }; _volume?: number }>;
    };
    fromHowl._sounds[0]!._node.gain.value = 0.42;
    toHowl._sounds[0]!._node.gain.value = 0.42;

    ctrl.abort();
    await expect(p).resolves.toBeUndefined();

    // Each touched sound's _volume must reflect the frozen gain position.
    expect(fromHowl._sounds[0]?._volume).toBe(0.42);
    expect(toHowl._sounds[0]?._volume).toBe(0.42);
    audio.dispose();
    vi.useRealTimers();
  });

  it("C3: after normal completion, ctrl.abort() is a silent no-op", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    // Abort after completion must not throw.
    expect(() => ctrl.abort()).not.toThrow();
    audio.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Group D — disposed guard
// ---------------------------------------------------------------------------

describe("D. disposed guard", () => {
  it("D1: audio.disposeAll() then equal-power crossfade throws AudioDisposedError", async () => {
    const { audio, from, to } = await makeAudioWithSounds();
    audio.disposeAll();
    expect(() => audio.crossfade(from, to, { duration: 2, curve: "equal-power" })).toThrow(
      AudioDisposedError,
    );
  });

  it("D2: from.dispose() then crossfade throws AudioError", async () => {
    const { audio, from, to } = await makeAudioWithSounds();
    from.dispose();
    expect(() => audio.crossfade(from, to, { duration: 2, curve: "equal-power" })).toThrow(
      AudioError,
    );
    audio.dispose();
  });

  it("D3: to.dispose() then crossfade throws AudioError", async () => {
    const { audio, from, to } = await makeAudioWithSounds();
    to.dispose();
    expect(() => audio.crossfade(from, to, { duration: 2, curve: "equal-power" })).toThrow(
      AudioError,
    );
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// Group E — HTML5 fallback
// ---------------------------------------------------------------------------

describe("E. HTML5 fallback", () => {
  it("E1: HTML5 mode (_node has no .gain) throws AudioError with exact message", async () => {
    setHtml5Mode(true);
    const { audio, from, to } = await makeAudioWithSounds();
    from.play(); // plays in html5 mode, _node has no .gain
    let err: unknown;
    try {
      audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).message).toBe(
      "equal-power crossfade requires Web Audio mode; HTML5 fallback active",
    );
    audio.dispose();
  });

  it("E2: when Howler.ctx is undefined, equal-power throws AudioError with exact message", async () => {
    forceCtxUndefined(true);
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    let err: unknown;
    try {
      audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).message).toBe(
      "equal-power crossfade requires Web Audio mode; HTML5 fallback active",
    );
    forceCtxUndefined(false);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// Group F — masterVolume scaling
// ---------------------------------------------------------------------------

describe("F. masterVolume scaling", () => {
  it("F1: createAudio({ volume: 0.5 }) — from curve[0] ≈ 0.5, to curve[63] ≈ 0.5", async () => {
    vi.useFakeTimers();
    const audio = createAudio({ autoUnlock: false, volume: 0.5 });
    const from = await audio.load("a.mp3");
    const to = await audio.load("b.mp3");
    from.play();
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    const toHowl = to.nativeHowl as unknown as {
      _sounds: Array<{ _node: { gain: GainParam } }>;
    };
    const fromGain = fromHowl._sounds[0]!._node.gain;
    const toGain = toHowl._sounds[0]!._node.gain;

    const fromCurve = fromGain.setValueCurveAtTime.mock.calls[0]![0] as Float32Array;
    const toCurve = toGain.setValueCurveAtTime.mock.calls[0]![0] as Float32Array;

    // mv=0.5: from cos[0] = 0.5, to sin[63] = 0.5
    expect(fromCurve[0]).toBeCloseTo(0.5, 5);
    expect(toCurve[63]).toBeCloseTo(0.5, 5);
    audio.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Group G — multi-voice from
// ---------------------------------------------------------------------------

describe("G. multi-voice from", () => {
  it("G1: all active from voices are ramped (two concurrent plays of from)", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    // Start two concurrent voices of `from` before the crossfade.
    from.play();
    from.play();
    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _id: number; _node: { gain: GainParam } }>;
    };
    // Both voices should be present in _sounds (mock appends on each play()).
    expect(fromHowl._sounds.length).toBe(2);

    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    // Every from voice must have had setValueCurveAtTime called (the cos ramp).
    for (const s of fromHowl._sounds) {
      expect(s._node.gain.setValueCurveAtTime).toHaveBeenCalledTimes(1);
      const fromCurve = s._node.gain.setValueCurveAtTime.mock.calls[0]![0] as Float32Array;
      // cos curve: starts near 1 (mv=1), ends near 0.
      expect(fromCurve[0]).toBeCloseTo(1, 5);
      expect(fromCurve[63]).toBeCloseTo(0, 5);
    }
    audio.dispose();
    vi.useRealTimers();
  });
});
