// Scaffold-stage placeholder test. Asserts that the public surface compiles
// and is shaped correctly so vitest can run against a non-empty test set
// while the implementation is still a `throw` stub. Real tests land in 0.1.0
// (will need vitest-environment-happy-dom for the AudioContext shim).

import { describe, expect, it } from "vitest";

import {
  type Audio,
  AudioDisposedError,
  AudioError,
  type AudioOptions,
  type Sound,
  createAudio,
} from "../src/index.js";

describe("aiaudiojs scaffold", () => {
  it("exports a callable createAudio factory", () => {
    expect(typeof createAudio).toBe("function");
  });

  it("exports AudioError and AudioDisposedError classes", () => {
    expect(new AudioError("x")).toBeInstanceOf(Error);
    expect(new AudioDisposedError("x")).toBeInstanceOf(Error);
    expect(new AudioError("x").name).toBe("AudioError");
    expect(new AudioDisposedError("x").name).toBe("AudioDisposedError");
  });

  it("createAudio throws the scaffold sentinel until 0.1.0", () => {
    const opts: AudioOptions = { autoUnlock: true, volume: 1, resumeOnVisibility: true };
    expect(() => createAudio(opts)).toThrow(/not implemented/);
  });

  it("public Audio + Sound shape compiles", () => {
    // Type-level assertion only: this code path is never executed.
    const _audioProbe = (a: Audio): void => {
      void a.unlock;
      void a.load;
      void a.crossfade;
      void a.volume;
      void a.dispose;
      void a.disposeAll;
      void a.disposed;
    };
    const _soundProbe = (s: Sound): void => {
      void s.play;
      void s.pause;
      void s.stop;
      void s.fade;
      void s.dispose;
      void s.nativeHowl;
      void s.disposed;
    };
    void _audioProbe;
    void _soundProbe;
  });
});
