// Shared Web Audio fakes.
//
// howler-real.test.ts does NOT vi.mock("howler"): it runs the real howler
// 2.2.4 core against a stub AudioContext installed on globalThis, so the
// Howler behaviours a mock can only approximate (synchronous emits inside
// `new Howl()`, the buffer cache, `_playLock` / once('resume') queuing, the
// single-paused-voice resume branch) are exercised for real. The mocked suites
// reuse FakeParam (via howler-mock.ts) as every voice's `_node.gain`.

import { vi } from "vitest";

/** Three distinct (so separately cached) one-sample WAV data URIs. */
export const WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
export const WAV2 =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAIA";
export const WAV3 =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAMA";

interface TimelineEvent {
  type: "set" | "ramp" | "curve";
  time: number;
  dur: number;
}

/**
 * Spec-faithful AudioParam timeline. `setValueCurveAtTime(c, T, D)` records an
 * exclusive [T, T+D) window, and any automation call inside it — or a curve
 * overlapping an existing event — throws NotSupportedError (Gecko
 * ValidateEvent / WebKit insertEvent). A non-finite value or time throws
 * TypeError (WebIDL `float` / `double` conversion). cancelScheduledValues(t)
 * drops events with time >= t and keeps an in-progress curve (Gecko).
 * `value` jumps to the target of each set / ramp so a test can read the
 * terminal gain.
 */
export class FakeParam {
  value = 1;
  events: TimelineEvent[] = [];
  private guard(v: number, t: number): void {
    if (!Number.isFinite(v) || !Number.isFinite(t)) {
      throw new TypeError("The provided float value is non-finite");
    }
    for (const e of this.events) {
      if (e.type === "curve" && e.time <= t && e.time + e.dur > t) {
        throw new DOMException("Can't add events during a curve event", "NotSupportedError");
      }
    }
  }
  setValueAtTime = vi.fn((v: number, t: number) => {
    this.guard(v, t);
    this.events.push({ type: "set", time: t, dur: 0 });
    this.value = v;
    return this;
  });
  linearRampToValueAtTime = vi.fn((v: number, t: number) => {
    this.guard(v, t);
    this.events.push({ type: "ramp", time: t, dur: 0 });
    this.value = v;
    return this;
  });
  setValueCurveAtTime = vi.fn((c: Float32Array, t: number, d: number) => {
    this.guard(c[0] ?? 0, t);
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
  cancelScheduledValues = vi.fn((t: number) => {
    this.events = this.events.filter((e) => e.time < t);
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
  constructor(state: string, resumeImpl?: () => Promise<void>) {
    this.state = state;
    this.resumeImpl =
      resumeImpl ??
      (() => {
        this.state = "running";
        return Promise.resolve();
      });
  }
  createGain(): FakeGainNode {
    const g = new FakeGainNode(new FakeParam());
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
): Installed {
  let current: FakeAudioContext | undefined;
  const Ctor = function (this: unknown) {
    current = new FakeAudioContext(state, resumeImpl);
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
