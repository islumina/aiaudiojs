// aiaudiojs v0.3.0 — equal-power crossfade test suite.
//
// Environment: happy-dom (provides AbortSignal, DOMException).
// Howler is the shared spec-faithful mock (test/howler-mock.ts): every voice's
// `_node.gain` is a FakeParam (curve-overlap + non-finite rules), HTML5 mode
// leaves `_node` without `.gain`, and `Howler.ctx` can be forced to null.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("howler", () => import("./howler-mock.js"));

import { AudioDisposedError, AudioError, createAudio } from "../src/index.js";
import type { FakeParam } from "./fake-web-audio.js";
import {
  Howler,
  __resetMock,
  __setCtxNull as forceCtxNull,
  mockCtx,
  __setHtml5Mode as setHtml5Mode,
} from "./howler-mock.js";

function getMockCtx(): typeof mockCtx {
  return mockCtx;
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
type GainParam = FakeParam;

function getFirstGain(sound: { nativeHowl: { _sounds: Array<{ _node?: { gain?: GainParam } }> } }) {
  const node = sound.nativeHowl._sounds[0]?._node as { gain?: GainParam } | undefined;
  return node?.gain;
}

// The equal-power ramp is scheduled as setValueAtTime(curve[0], now) followed
// by one linearRampToValueAtTime per remaining curve point (piecewise linear,
// the same shape setValueCurveAtTime would render, without its exclusive time
// window). Rebuild the scheduled curve values and their times from the calls.
// Howler's own gain writes (a voice start, volume(v, id)) also go through
// setValueAtTime, so the ramp's start is the LAST setValueAtTime issued before
// the first ramp point.
function scheduledRamp(g: GainParam): { curve: number[]; times: number[] } {
  const firstRamp = g.linearRampToValueAtTime.mock.invocationCallOrder[0] ?? 0;
  const sets = g.setValueAtTime.mock.calls as Array<[number, number]>;
  const orders = g.setValueAtTime.mock.invocationCallOrder;
  let start = sets[0] as [number, number];
  for (let i = 0; i < sets.length; i++) {
    if ((orders[i] ?? 0) < firstRamp) start = sets[i] as [number, number];
  }
  const ramps = g.linearRampToValueAtTime.mock.calls as Array<[number, number]>;
  return {
    curve: [start[0], ...ramps.map((r) => r[0])],
    times: [start[1], ...ramps.map((r) => r[1])],
  };
}

/** Invocation order of the ramp's start (see scheduledRamp). */
function rampStartOrder(g: GainParam): number {
  const firstRamp = g.linearRampToValueAtTime.mock.invocationCallOrder[0] ?? 0;
  return Math.max(...g.setValueAtTime.mock.invocationCallOrder.filter((o) => o < firstRamp));
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetMock();
  vi.clearAllMocks();
});

afterEach(() => {
  __resetMock();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Group A — backward-compat (linear path)
// ---------------------------------------------------------------------------

describe("A. backward-compat linear path", () => {
  it("A1: no curve option calls Howl.fade() on both sounds; no equal-power schedule; resolves after duration", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const fadeSpy = vi.spyOn(from.nativeHowl, "fade");
    const fadeSpy2 = vi.spyOn(to.nativeHowl, "fade");
    const p = audio.crossfade(from, to, { duration: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(fadeSpy).toHaveBeenCalledTimes(1);
    expect(fadeSpy2).toHaveBeenCalledTimes(1);
    // The only gain ramps are Howler.fade()'s own single linear ramp per voice
    // (1 -> 0 outgoing, 0 -> 1 incoming) — not the 64-point equal-power one.
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
    expect(fromGain?.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(fromGain?.linearRampToValueAtTime.mock.calls).toEqual([[0, 1]]);
    expect(toGain?.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(toGain?.linearRampToValueAtTime.mock.calls).toEqual([[1, 1]]);
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

  it("B4: from's _node.gain ramps through the 64-point cos curve over the duration via linearRampToValueAtTime (no setValueCurveAtTime); cancelScheduledValues then setValueAtTime called first (order)", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    // from must have a sound already; the crossfade will use from's existing _sounds
    const fromHowl = from.nativeHowl as unknown as {
      _sounds: Array<{ _id: number; _node: { gain: GainParam } }>;
    };
    const fromGain = fromHowl._sounds[0]!._node.gain;
    // Forget Howler's own start / volume writes from from.play().
    fromGain.setValueAtTime.mockClear();
    const p = audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    // No SetValueCurve event: its exclusive window would make any other gain
    // write during the ramp throw NotSupportedError.
    expect(fromGain.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(fromGain.setValueAtTime).toHaveBeenCalledTimes(1);
    expect(fromGain.linearRampToValueAtTime).toHaveBeenCalledTimes(63);
    const { curve, times } = scheduledRamp(fromGain);
    expect(curve).toHaveLength(64);
    // Starts at now (0), points evenly spaced, ends exactly at now + duration.
    expect(times[0]).toBe(0);
    for (let i = 1; i < 64; i++) {
      expect(times[i]!).toBeCloseTo((2 * i) / 63, 9);
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    expect(times[63]).toBe(2);
    for (let i = 0; i < 64; i++) {
      expect(curve[i]!).toBeCloseTo(Math.cos((i / 63) * (Math.PI / 2)), 5);
    }

    // Order: cancelScheduledValues → setValueAtTime → first linearRampToValueAtTime
    const cancelOrder = fromGain.cancelScheduledValues.mock.invocationCallOrder[0]!;
    const setAtTimeOrder = fromGain.setValueAtTime.mock.invocationCallOrder[0]!;
    const rampOrder = fromGain.linearRampToValueAtTime.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(setAtTimeOrder);
    expect(setAtTimeOrder).toBeLessThan(rampOrder);
    audio.dispose();
    vi.useRealTimers();
  });

  it("B5: to's _node.gain.setValueAtTime(0, now) called before the sin ramp (linearRampToValueAtTime points)", async () => {
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

    expect(toGain.setValueCurveAtTime).not.toHaveBeenCalled();
    expect(toGain.linearRampToValueAtTime).toHaveBeenCalledTimes(63);
    // The ramp starts with setValueAtTime(0, now) on to's gain.
    const { curve, times } = scheduledRamp(toGain);
    expect(curve[0]).toBe(0);
    expect(times[0]).toBe(0);
    expect(times[63]).toBe(2);
    for (let i = 0; i < 64; i++) {
      expect(curve[i]!).toBeCloseTo(Math.sin((i / 63) * (Math.PI / 2)), 5);
    }

    // Order check: cancelScheduledValues → setValueAtTime → first linearRampToValueAtTime
    const cancelOrder = toGain.cancelScheduledValues.mock.invocationCallOrder[0]!;
    const setAtOrder = rampStartOrder(toGain);
    const rampOrder = toGain.linearRampToValueAtTime.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(setAtOrder);
    expect(setAtOrder).toBeLessThan(rampOrder);
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

    const fromCurve = scheduledRamp(fromGain).curve;
    const toCurve = scheduledRamp(toGain).curve;

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

  it("B9: terminal _volume synced — outgoing 0, incoming 1 (RELATIVE; keeps Howler.mute() consistent)", async () => {
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

  it("C2: pre-aborted signal rejects DOMException(AbortError); NO ramp scheduled", async () => {
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
        expect(gain.linearRampToValueAtTime).not.toHaveBeenCalled();
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

  it("C5: abort whose freeze throws (engine rejects setValueAtTime) still settles the promise", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 2, signal: ctrl.signal, curve: "equal-power" });
    let state = "pending";
    p.then(() => {
      state = "resolved";
    });
    const freezeError = new DOMException(
      "Can't add events during a curve event",
      "NotSupportedError",
    );
    const fromGain = getFirstGain(
      from as unknown as {
        nativeHowl: { _sounds: Array<{ _node?: { gain?: GainParam } }> };
      },
    );
    fromGain!.setValueAtTime.mockImplementation(() => {
      throw freezeError;
    });
    let abortThrew: unknown;
    try {
      ctrl.abort();
    } catch (e) {
      abortThrew = e;
    }
    // The freeze error is not swallowed: it surfaces on the abort dispatch
    // (window.onerror in a browser; re-thrown by happy-dom) or not at all.
    if (abortThrew !== undefined) expect(abortThrew).toBe(freezeError);
    await vi.advanceTimersByTimeAsync(5000);
    expect(state).toBe("resolved");
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
  it("E1: HTML5 mode (_node has no .gain) throws AudioError with the prefixed message and stops the started `to` voice", async () => {
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
    expect((err as AudioError).message).toMatch(
      /^aiaudiojs: equal-power crossfade requires Web Audio mode; HTML5 fallback active$/,
    );
    // The `to` voice the call had already started is stopped: no orphan.
    const toVoices = (to.nativeHowl as unknown as { _sounds: Array<{ _ended: boolean }> })._sounds;
    expect(toVoices).toHaveLength(1);
    expect(toVoices[0]?._ended).toBe(true);
    audio.dispose();
  });

  it("E2: when Howler.ctx is null (no Web Audio), equal-power throws AudioError with the prefixed message", async () => {
    forceCtxNull(true);
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    let err: unknown;
    try {
      audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).message).toMatch(
      /^aiaudiojs: equal-power crossfade requires Web Audio mode; HTML5 fallback active$/,
    );
    forceCtxNull(false);
    audio.dispose();
  });

  it("E3: Web Audio mode with a non-running context throws a distinct AudioError (not the HTML5 one) before starting `to`", async () => {
    const H = Howler;
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    const toPlaySpy = vi.spyOn(to.nativeHowl, "play");
    for (const [howlerState, ctxState] of [
      ["suspended", "suspended"],
      ["running", "interrupted"],
    ] as const) {
      H.state = howlerState;
      getMockCtx().state = ctxState;
      let err: unknown;
      try {
        audio.crossfade(from, to, { duration: 2, curve: "equal-power" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AudioError);
      expect((err as AudioError).message).toMatch(
        /^aiaudiojs: equal-power crossfade requires a running AudioContext; call unlock\(\) first$/,
      );
    }
    expect(toPlaySpy).not.toHaveBeenCalled();
    H.state = "running";
    getMockCtx().state = "running";
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------
// Group F — masterVolume scaling
// ---------------------------------------------------------------------------

describe("F. masterVolume application (AUD-B-02: master applied once)", () => {
  it("F1: createAudio({ volume: 0.5 }) — curves stay RELATIVE [0,1]; master applied once via Howler.volume(0.5)", async () => {
    // AUD-B-02: the equal-power curves must NOT be scaled by masterVolume —
    // the master is applied exactly once via Howler's global gain. Scaling the
    // per-sound curves by mv here, on top of the global master, would
    // double-attenuate the crossfade to mv². So at master 0.5 the curves still
    // run 1→0 (from) and 0→1 (to); Howler.volume(0.5) carries the master.
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

    const fromCurve = scheduledRamp(fromGain).curve;
    const toCurve = scheduledRamp(toGain).curve;

    // Curves are relative and independent of master: from 1→0, to 0→1.
    expect(fromCurve[0]).toBeCloseTo(1, 5);
    expect(fromCurve[63]).toBeCloseTo(0, 5);
    expect(toCurve[0]).toBeCloseTo(0, 5);
    expect(toCurve[63]).toBeCloseTo(1, 5);
    // Master is applied exactly once, globally.
    expect(Howler.volume).toHaveBeenCalledWith(0.5);
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

    // Every from voice must have had the cos ramp scheduled.
    for (const s of fromHowl._sounds) {
      expect(s._node.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(63);
      const fromCurve = scheduledRamp(s._node.gain).curve;
      // cos curve: starts near 1 (mv=1), ends near 0.
      expect(fromCurve[0]).toBeCloseTo(1, 5);
      expect(fromCurve[63]).toBeCloseTo(0, 5);
    }
    audio.dispose();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Group H — completion stop, loop option, self / ping-pong crossfades,
// dispose and abort edge cases (0.6.0)
// ---------------------------------------------------------------------------

describe("H. equal-power completion and edge cases", () => {
  interface Voice {
    _id: number;
    _paused: boolean;
    _ended: boolean;
    _node: { gain: GainParam };
  }
  const pool = (s: { nativeHowl: unknown }): Voice[] =>
    (s.nativeHowl as { _sounds: Voice[] })._sounds;
  const byId = (s: { nativeHowl: unknown }, id: number): Voice | undefined =>
    pool(s).find((v) => v._id === id);
  const active = (s: { nativeHowl: unknown }): number[] =>
    pool(s)
      .filter((v) => !v._paused && !v._ended)
      .map((v) => v._id);

  it("H1: a looping `from` voice is stopped at completion; the incoming voice keeps playing", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    const fromId = from.play({ loop: true });
    const p = audio.crossfade(from, to, { duration: 1, curve: "equal-power" });
    await vi.advanceTimersByTimeAsync(999);
    expect(byId(from, fromId)?._ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(byId(from, fromId)).toMatchObject({ _ended: true, _paused: true });
    expect(active(to)).toHaveLength(1);
    audio.dispose();
  });

  it("H2: ping-pong A -> B -> A never ramps A's first voice back up", async () => {
    vi.useFakeTimers();
    const { audio, from: a, to: b } = await makeAudioWithSounds();
    const a1 = a.play({ loop: true });
    const p1 = audio.crossfade(a, b, { duration: 1, curve: "equal-power", loop: true });
    await vi.advanceTimersByTimeAsync(1000);
    await p1;
    expect(byId(a, a1)?._ended).toBe(true);
    const a1Gain = byId(a, a1)?._node.gain as GainParam;
    const rampsBefore = a1Gain.linearRampToValueAtTime.mock.calls.length;
    const p2 = audio.crossfade(b, a, { duration: 1, curve: "equal-power", loop: true });
    await vi.advanceTimersByTimeAsync(1000);
    await p2;
    // No new ramp was scheduled on A's first voice.
    expect(a1Gain.linearRampToValueAtTime.mock.calls.length).toBe(rampsBefore);
    const [a2] = active(a);
    expect(active(a)).toHaveLength(1);
    expect(a2).not.toBe(a1);
    expect(scheduledRamp(byId(a, a2 as number)?._node.gain as GainParam).curve.at(-1)).toBeCloseTo(
      1,
      5,
    );
    expect(active(b)).toHaveLength(0);
    audio.dispose();
  });

  it("H3: aborting leaves `from` running — even after the duration elapses", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    const fromId = from.play({ loop: true });
    const stopSpy = vi.spyOn(from.nativeHowl, "stop");
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 1, curve: "equal-power", signal: ctrl.signal });
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(byId(from, fromId)?._ended).toBe(false);
    audio.dispose();
  });

  it("H4: crossfade(s, s): the old voice rides cos and stops; the new voice rides sin and keeps playing", async () => {
    vi.useFakeTimers();
    const { audio, from: s } = await makeAudioWithSounds();
    const old = s.play({ loop: true });
    const p = audio.crossfade(s, s, { duration: 1, curve: "equal-power", loop: true });
    const fresh = active(s).find((id) => id !== old) as number;
    expect(fresh).toBeDefined();
    const oldCurve = scheduledRamp(byId(s, old)?._node.gain as GainParam).curve;
    const newCurve = scheduledRamp(byId(s, fresh)?._node.gain as GainParam).curve;
    expect(oldCurve[0]).toBeCloseTo(1, 5);
    expect(oldCurve.at(-1)).toBeCloseTo(0, 5);
    expect(newCurve[0]).toBeCloseTo(0, 5);
    expect(newCurve.at(-1)).toBeCloseTo(1, 5);
    // The new voice got exactly one 63-point schedule (never the cos one).
    expect(byId(s, fresh)?._node.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(63);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(byId(s, old)?._ended).toBe(true);
    expect(active(s)).toEqual([fresh]);
    expect(s.nativeHowl.loop(fresh)).toBe(true);
    audio.dispose();
  });

  it("H5: `loop: true` starts the incoming voice looping; the default stays non-looping", async () => {
    const { audio, from, to } = await makeAudioWithSounds();
    from.play();
    audio.crossfade(from, to, { duration: 1, curve: "equal-power", loop: true }).catch(() => {});
    expect(to.nativeHowl.loop(active(to)[0] as number)).toBe(true);
    audio.crossfade(to, from, { duration: 1, curve: "equal-power" }).catch(() => {});
    expect(from.nativeHowl.loop(active(from).at(-1) as number)).toBe(false);
    audio.dispose();
  });

  it("H6: dispose mid-crossfade — the promise resolves and the disposed `from` is not touched", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play({ loop: true });
    const p = audio.crossfade(from, to, { duration: 1, curve: "equal-power" });
    from.dispose();
    const stopSpy = vi.spyOn(from.nativeHowl, "stop");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(stopSpy).not.toHaveBeenCalled();
    const c = await audio.load("c.mp3");
    const d = await audio.load("d.mp3");
    c.play();
    const p2 = audio.crossfade(c, d, { duration: 1, curve: "equal-power" });
    audio.dispose();
    const stopC = vi.spyOn(c.nativeHowl, "stop");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p2).resolves.toBeUndefined();
    expect(stopC).not.toHaveBeenCalled();
  });

  it("H7: a throwing onAbort (freeze) settles, detaches, and the completion stop never runs later", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    const fromId = from.play({ loop: true });
    const ctrl = new AbortController();
    const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
    const p = audio.crossfade(from, to, { duration: 1, curve: "equal-power", signal: ctrl.signal });
    const boom = new DOMException("Can't add events during a curve event", "NotSupportedError");
    (byId(from, fromId)?._node.gain as GainParam).setValueAtTime.mockImplementation(() => {
      throw boom;
    });
    try {
      ctrl.abort();
    } catch (e) {
      // happy-dom rethrows listener errors; a browser reports them instead.
      expect(e).toBe(boom);
    }
    await expect(p).resolves.toBeUndefined();
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    const stopSpy = vi.spyOn(from.nativeHowl, "stop");
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(byId(from, fromId)?._ended).toBe(false);
    audio.dispose();
  });

  it("H8: Howler gain writes on the incoming voice mid-ramp do not throw (curve-overlap rule enforced by the mock)", async () => {
    vi.useFakeTimers();
    const { audio, from: a, to: b } = await makeAudioWithSounds();
    const c = await audio.load("c.mp3");
    a.play({ loop: true });
    audio.crossfade(a, b, { duration: 4, curve: "equal-power" }).catch(() => {});
    getMockCtx().currentTime = 1;
    const bId = active(b)[0] as number;
    let threw: unknown;
    try {
      b.fade(1, 0.5, 200).catch(() => {});
      b.pause(bId);
      b.resume(bId);
      audio.crossfade(b, c, { duration: 1 }).catch(() => {});
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeUndefined();
    audio.dispose();
  });

  it("H10: an abort fired re-entrantly from the completion stop does not also run the abort freeze", async () => {
    vi.useFakeTimers();
    const { audio, from, to } = await makeAudioWithSounds();
    from.play({ loop: true });
    const ctrl = new AbortController();
    const p = audio.crossfade(from, to, { duration: 1, curve: "equal-power", signal: ctrl.signal });
    const toGain = pool(to)[0]?._node.gain as GainParam;
    const cancelsBefore = toGain.cancelScheduledValues.mock.calls.length;
    const howl = from.nativeHowl;
    const realStop = howl.stop.bind(howl);
    vi.spyOn(howl, "stop").mockImplementation((id?: number) => {
      ctrl.abort();
      return realStop(id);
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBeUndefined();
    expect(howl.stop).toHaveBeenCalled();
    expect(toGain.cancelScheduledValues.mock.calls.length).toBe(cancelsBefore);
    audio.dispose();
  });

  it("H9: the mock's gain param does enforce the rule — a Howler write inside a setValueCurveAtTime window throws", async () => {
    const { audio, from } = await makeAudioWithSounds();
    const id = from.play();
    const gain = byId(from, id)?._node.gain as GainParam;
    gain.setValueCurveAtTime(new Float32Array([1, 0]), 0, 2);
    expect(() => from.nativeHowl.volume(0.5, id)).toThrow(
      expect.objectContaining({ name: "NotSupportedError" }),
    );
    await expect(from.fade(1, 0, 100, id)).rejects.toMatchObject({ name: "NotSupportedError" });
    audio.dispose();
  });
});
