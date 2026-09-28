// Shared harness for the real-Howler regression suite (howler-real.test.ts).
//
// Unlike the other test files, that suite does NOT vi.mock("howler"): it runs
// the real howler 2.2.4 core against a stub AudioContext installed on
// globalThis, so the Howler behaviours the unit mocks cannot see (synchronous
// emits inside `new Howl()`, the buffer cache, `_playLock` / once('resume')
// queuing, the single-paused-voice resume branch) are exercised for real.

import { vi } from "vitest";

/** Three distinct (so separately cached) one-sample WAV data URIs. */
export const WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
export const WAV2 =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAIA";
export const WAV3 =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAMA";

export class FakeParam {
  value = 1;
  setValueAtTime = vi.fn((v: number, _t: number) => {
    this.value = v;
    return this;
  });
  linearRampToValueAtTime = vi.fn((v: number, _t: number) => {
    this.value = v;
    return this;
  });
  cancelScheduledValues = vi.fn((_t: number) => this);
  setValueCurveAtTime = vi.fn((_c: Float32Array, _t: number, _d: number) => this);
}

interface TimelineEvent {
  type: "set" | "ramp" | "curve";
  time: number;
  dur: number;
}

/**
 * Spec-faithful AudioParam timeline: any automation call at t in [T, T+D) of a
 * scheduled curve throws NotSupportedError (Gecko ValidateEvent / WebKit
 * insertEvent). cancelScheduledValues(t) drops events with time >= t and keeps
 * an in-progress curve (Gecko); `cancelDropsActiveCurve = true` models WebKit.
 */
export class SpecParam extends FakeParam {
  events: TimelineEvent[] = [];
  cancelDropsActiveCurve = false;
  private guard(t: number): void {
    for (const e of this.events) {
      if (e.type === "curve" && e.time <= t && e.time + e.dur > t) {
        throw new DOMException("Can't add events during a curve event", "NotSupportedError");
      }
    }
  }
  override setValueAtTime = vi.fn((v: number, t: number) => {
    this.guard(t);
    this.events.push({ type: "set", time: t, dur: 0 });
    this.value = v;
    return this;
  });
  override linearRampToValueAtTime = vi.fn((v: number, t: number) => {
    this.guard(t);
    this.events.push({ type: "ramp", time: t, dur: 0 });
    this.value = v;
    return this;
  });
  override setValueCurveAtTime = vi.fn((_c: Float32Array, t: number, d: number) => {
    this.guard(t);
    for (const e of this.events) {
      if (t < e.time && t + d > e.time) {
        throw new DOMException(
          "Can't add curve events that overlap other events",
          "NotSupportedError",
        );
      }
    }
    this.events.push({ type: "curve", time: t, dur: d });
    return this;
  });
  override cancelScheduledValues = vi.fn((t: number) => {
    this.events = this.events.filter((e) => {
      if (e.time >= t) return false;
      if (this.cancelDropsActiveCurve && e.type === "curve" && e.time + e.dur > t) return false;
      return true;
    });
    return this;
  });
}

export class FakeGainNode {
  gain: FakeParam;
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(p: FakeParam) {
    this.gain = p;
  }
}

export class FakeBufferSource {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

export class FakeAudioContext {
  state: string;
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  sources: FakeBufferSource[] = [];
  gains: FakeGainNode[] = [];
  resumeImpl: () => Promise<void>;
  paramFactory: () => FakeParam;
  constructor(state: string, resumeImpl?: () => Promise<void>, paramFactory?: () => FakeParam) {
    this.state = state;
    this.paramFactory = paramFactory ?? (() => new FakeParam());
    this.resumeImpl =
      resumeImpl ??
      (() => {
        this.state = "running";
        return Promise.resolve();
      });
  }
  createGain(): FakeGainNode {
    const g = new FakeGainNode(this.paramFactory());
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(): object {
    return {};
  }
  // One declared parameter, so Howler takes the promise form of decodeAudioData.
  decodeAudioData(_ab: ArrayBuffer): Promise<{ duration: number }> {
    return Promise.resolve({ duration: 10 });
  }
  resume(): Promise<void> {
    return this.resumeImpl();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

export interface Installed {
  ctx: () => FakeAudioContext;
  restore: () => void;
}

/** Install a stub `AudioContext` global (and a permissive canPlayType). */
export function installFakeWebAudio(
  state = "running",
  resumeImpl?: () => Promise<void>,
  paramFactory?: () => FakeParam,
): Installed {
  let current: FakeAudioContext | undefined;
  const Ctor = function (this: unknown) {
    current = new FakeAudioContext(state, resumeImpl, paramFactory);
    return current;
  } as unknown as { new (): FakeAudioContext };
  const g = globalThis as Record<string, unknown>;
  const prevCtx = g.AudioContext;
  g.AudioContext = Ctor;
  const proto = (
    globalThis as unknown as { HTMLMediaElement: { prototype: { canPlayType: unknown } } }
  ).HTMLMediaElement.prototype;
  const prevCanPlay = proto.canPlayType;
  // happy-dom answers "" for every codec, which would make Howler reject all.
  proto.canPlayType = () => "probably";
  return {
    ctx: () => {
      if (current === undefined) throw new Error("fake ctx not created yet");
      return current;
    },
    restore: () => {
      g.AudioContext = prevCtx;
      proto.canPlayType = prevCanPlay;
    },
  };
}

/** Stop Howler scheduling its 30 s auto-suspend and gesture-unlock listeners. */
export function quietHowler(Howler: unknown): void {
  const H = Howler as { autoSuspend: boolean; autoUnlock: boolean };
  H.autoSuspend = false;
  H.autoUnlock = false;
}

/** Unload every Howl and drop the AudioContext so the next test builds a fresh one. */
export function resetHowler(Howler: unknown): void {
  const H = Howler as {
    unload: () => void;
    ctx: unknown;
    masterGain: unknown;
    usingWebAudio: boolean;
    noAudio: boolean;
    state: string;
    _howls: unknown[];
  };
  H.unload();
  H._howls.length = 0;
  H.ctx = null;
  H.masterGain = null;
  H.usingWebAudio = true;
  H.noAudio = false;
  H.state = "suspended";
}

export interface RawVoice {
  _id: number;
  _paused: boolean;
  _ended: boolean;
  _loop: boolean;
  _volume: number;
  _node: FakeGainNode;
}

export function voices(sound: { nativeHowl: unknown }): RawVoice[] {
  return (sound.nativeHowl as { _sounds: RawVoice[] })._sounds;
}

export function active(sound: { nativeHowl: unknown }): RawVoice[] {
  return voices(sound).filter((v) => !v._paused && !v._ended);
}

/** Advance fake time by `ms` and report whether `p` settled in that window. */
export async function settledWithin(
  p: Promise<unknown>,
  ms: number,
): Promise<"resolved" | "rejected" | "pending"> {
  let state: "resolved" | "rejected" | "pending" = "pending";
  p.then(
    () => {
      state = "resolved";
    },
    () => {
      state = "rejected";
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  return state;
}

/** load() and flush Howler's decode; throws unless the load resolved. */
export async function loadFlushed<T>(
  audio: { load: (url: string) => Promise<T> },
  url: string,
): Promise<T> {
  const p = audio.load(url);
  p.catch(() => {});
  const state = await settledWithin(p, 20);
  if (state !== "resolved") throw new Error(`load did not resolve: ${state}`);
  return p;
}
