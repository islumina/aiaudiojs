// aiaudiojs v0.3.0 — fast-check property test for equal-power crossfade.
//
// Property: for any duration in [0.01, 600] and masterVolume in [0, 1],
// the sin/cos curves scheduled on the GainNodes are Float32Array(64),
// the third arg equals duration, endpoints match mv*sin/cos(pi/2),
// and for mv > 0 the constant-power invariant (sin^2 + cos^2 = 1) holds
// within 1e-3 at every sample.

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Howler mock — replicated per file (Vitest hoists per file boundary).
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => void;

vi.mock("howler", () => {
  const handlers = new Map<object, Map<string, AnyFn>>();
  let nextSoundId = 1;

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
    createGain: vi.fn(() => ({
      gain: makeMockGainParam(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };

  class Howl {
    _sounds: Array<{ _id: number; _node: { gain: ReturnType<typeof makeMockGainParam> } }> = [];
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
      this._sounds.push({ _id: id, _node: { gain: makeMockGainParam() } });
      return id;
    }
  }

  function __resetSoundId(): void {
    nextSoundId = 1;
  }

  function __getMockCtx() {
    return mockCtx;
  }

  return {
    Howl,
    Howler: {
      get ctx() {
        return mockCtx;
      },
      volume: vi.fn(),
    },
    __resetSoundId,
    __getMockCtx,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { __getMockCtx, __resetSoundId } from "howler";
import { createAudio } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GainParam = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  setValueCurveAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
};

function resetSoundId(): void {
  (__resetSoundId as () => void)();
}

function getMockCtx(): ReturnType<typeof __getMockCtx> {
  return (__getMockCtx as () => ReturnType<typeof __getMockCtx>)();
}

// ---------------------------------------------------------------------------
// Reset between property runs
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetSoundId();
  vi.clearAllMocks();
  getMockCtx().currentTime = 0;
  getMockCtx().resume.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe("equal-power crossfade constant-power property", () => {
  it("sin^2 + cos^2 == 1 for all (duration, masterVolume) combinations", async () => {
    vi.useFakeTimers();

    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0.01, max: 600, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (duration, masterVolume) => {
          // Fresh audio at this masterVolume.
          const audio = createAudio({ autoUnlock: false, volume: masterVolume });
          const from = await audio.load("a.mp3");
          const to = await audio.load("b.mp3");

          // from is assumed already playing.
          from.play();

          // Fire crossfade (scheduling happens synchronously before the returned promise).
          const cfPromise = audio.crossfade(from, to, { duration, curve: "equal-power" });

          // Advance timers and let the promise resolve.
          await vi.advanceTimersByTimeAsync(duration * 1000 + 1);
          await cfPromise;

          // Collect the scheduled curves from _sounds.
          const fromHowl = from.nativeHowl as unknown as {
            _sounds: Array<{ _node: { gain: GainParam } }>;
          };
          const toHowl = to.nativeHowl as unknown as {
            _sounds: Array<{ _node: { gain: GainParam } }>;
          };

          const fromGain = fromHowl._sounds[0]!._node.gain;
          const toGain = toHowl._sounds[0]!._node.gain;

          const fromCurveCall = fromGain.setValueCurveAtTime.mock.calls[0];
          const toCurveCall = toGain.setValueCurveAtTime.mock.calls[0];

          // Both curves must exist.
          expect(fromCurveCall).toBeDefined();
          expect(toCurveCall).toBeDefined();

          const fromCurve = fromCurveCall![0] as Float32Array;
          const toCurve = toCurveCall![0] as Float32Array;

          // Float32Array of length 64.
          expect(fromCurve).toBeInstanceOf(Float32Array);
          expect(toCurve).toBeInstanceOf(Float32Array);
          expect(fromCurve.length).toBe(64);
          expect(toCurve.length).toBe(64);

          // Third arg === duration.
          expect(fromCurveCall![2]).toBe(duration);
          expect(toCurveCall![2]).toBe(duration);

          const mv = masterVolume;

          // Endpoint invariants.
          expect(fromCurve[0]).toBeCloseTo(mv, 5); // cos(0)*mv = mv
          expect(fromCurve[63]).toBeCloseTo(0, 5); // cos(pi/2)*mv ≈ 0
          expect(toCurve[0]).toBeCloseTo(0, 5); // sin(0)*mv = 0
          expect(toCurve[63]).toBeCloseTo(mv, 5); // sin(pi/2)*mv = mv

          // Constant-power invariant: (fromCurve[i]/mv)^2 + (toCurve[i]/mv)^2 ≈ 1
          // Only check when mv is meaningfully non-zero.
          if (mv > 1e-6) {
            for (let i = 0; i < 64; i++) {
              const f = fromCurve[i]! / mv;
              const t = toCurve[i]! / mv;
              expect(f * f + t * t).toBeCloseTo(1, 2); // within 1e-2 (Float32 precision)
            }
          }

          audio.dispose();
        },
      ),
      { numRuns: 100 },
    );
  });
});
