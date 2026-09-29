// aiaudiojs — fast-check property test for equal-power crossfade.
//
// Property: for any duration in [0.01, 600] and masterVolume in [0, 1],
// the sin/cos curves scheduled on the GainNodes are Float32Array(64) and the
// third arg equals duration. The curves are RELATIVE [0,1] values — the master
// is applied exactly once via Howler's global gain (AUD-B-02), NOT folded into
// the per-sound curves — so the endpoints are sin/cos(pi/2) independent of mv
// (from [0]≈1,[63]≈0; to [0]≈0,[63]≈1), the constant-power invariant
// (sin^2 + cos^2 = 1) holds at every sample directly, and Howler.volume(mv)
// carries the master.

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Howler mock — the shared spec-faithful voice pool (test/howler-mock.ts).
// ---------------------------------------------------------------------------

vi.mock("howler", () => import("./howler-mock.js"));

import { createAudio } from "../src/index.js";
import type { FakeParam } from "./fake-web-audio.js";
import { Howler, __resetMock } from "./howler-mock.js";

type GainParam = FakeParam;

// ---------------------------------------------------------------------------
// Reset between property runs
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetMock();
  vi.clearAllMocks();
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

          // No SetValueCurve event (its exclusive window would make Howler's
          // own gain writes throw mid-ramp); the curve is scheduled as
          // setValueAtTime(curve[0], now) + one linear ramp per later point.
          expect(fromGain.setValueCurveAtTime).not.toHaveBeenCalled();
          expect(toGain.setValueCurveAtTime).not.toHaveBeenCalled();
          // Howler's own start / volume writes also use setValueAtTime; the
          // ramp's start is the last one issued before the first ramp point.
          const rebuild = (g: GainParam): { curve: number[]; times: number[] } => {
            const firstRamp = g.linearRampToValueAtTime.mock.invocationCallOrder[0] ?? 0;
            const orders = g.setValueAtTime.mock.invocationCallOrder;
            const sets = g.setValueAtTime.mock.calls.filter(
              (_c, i) => (orders[i] ?? 0) < firstRamp,
            );
            const start = sets[sets.length - 1] as [number, number];
            const ramps = g.linearRampToValueAtTime.mock.calls as Array<[number, number]>;
            return {
              curve: [start[0], ...ramps.map((r) => r[0])],
              times: [start[1], ...ramps.map((r) => r[1])],
            };
          };
          const fromRamp = rebuild(fromGain);
          const toRamp = rebuild(toGain);
          const fromCurve = fromRamp.curve;
          const toCurve = toRamp.curve;

          // 64 curve points each.
          expect(fromCurve.length).toBe(64);
          expect(toCurve.length).toBe(64);

          // Ramp spans exactly [now, now + duration], points strictly increasing.
          for (const times of [fromRamp.times, toRamp.times]) {
            expect(times[0]).toBe(0);
            expect(times[63]).toBe(duration);
            for (let i = 1; i < 64; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
          }

          const mv = masterVolume;

          // Endpoint invariants — RELATIVE curves, independent of mv.
          expect(fromCurve[0]).toBeCloseTo(1, 5); // cos(0) = 1
          expect(fromCurve[63]).toBeCloseTo(0, 5); // cos(pi/2) ≈ 0
          expect(toCurve[0]).toBeCloseTo(0, 5); // sin(0) = 0
          expect(toCurve[63]).toBeCloseTo(1, 5); // sin(pi/2) = 1

          // Constant-power invariant holds directly on the relative curves:
          // fromCurve[i]^2 + toCurve[i]^2 ≈ 1 at every sample, for all mv.
          for (let i = 0; i < 64; i++) {
            const f = fromCurve[i]!;
            const t = toCurve[i]!;
            expect(f * f + t * t).toBeCloseTo(1, 2); // within 1e-2 (Float32 precision)
          }

          // The master is applied exactly once via Howler's global gain.
          expect(Howler.volume).toHaveBeenCalledWith(mv);

          audio.dispose();
        },
      ),
      { numRuns: 100 },
    );
  });
});
