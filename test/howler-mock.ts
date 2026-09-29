// Shared Howler mock for the fast unit suites (audio.test.ts,
// crossfade-equal-power.test.ts, crossfade-equal-power.prop.test.ts). Each
// suite installs it with
//
//   vi.mock("howler", () => import("./howler-mock.js"));
//
// and imports the test helpers from "./howler-mock.js" directly — the same
// module instance src/index.ts receives as "howler", so the state is shared.
// howler-real.test.ts runs the real howler core instead.
//
// Fidelity to howler 2.2.4 (howler.core.js):
//   - a voice carries `_id`, `_paused`, `_ended`, `_loop`, `_volume` and, in
//     Web Audio mode, a per-voice `_node.gain` FakeParam that enforces the
//     spec's curve-overlap and non-finite rules (HTML5 mode: `_node` has no
//     `.gain`). Howler's gain writes go through that param exactly where
//     howler makes them: a voice (re)start, volume(v, id), and fade();
//   - play() with no argument resumes the single paused, not-ended voice when
//     exactly one exists and no play is locked; play("__default") always
//     starts a new voice; play(id) resumes that voice;
//   - stop(id) and the natural `end` of a non-loop voice park it `_paused` +
//     `_ended`; pause(id) sets `_paused` only; a loop voice's `end` does not
//     terminate it;
//   - play-lock mode (context not running / HTML5 play() pending): play()
//     returns an id whose voice stays queued (`_paused: true`,
//     `_ended: false`, `howl._playLock === true`) until __releasePlayLock()
//     starts it and fires its per-id `play` event;
//   - load modes: by default `load` / `loaderror` fire on the next microtask;
//     manual mode waits for __emitLoad() / __emitLoadError(); sync mode emits
//     inside the constructor, which reaches only the listeners that exist at
//     that moment (howler's _emit schedules one setTimeout per listener);
//   - `Howler.ctx` is `null` in ctx-null mode (howler's "no AudioContext").
//
// Test-driven events (__emit) fire synchronously so a test can assert right
// after them; howler itself defers each listener with setTimeout(0).

import { vi } from "vitest";
import { FakeParam } from "./fake-web-audio.js";

type AnyFn = (...args: unknown[]) => void;

interface Listener {
  fn: AnyFn;
  id: number | undefined;
  once: boolean;
}

export interface MockVoice {
  _id: number;
  _paused: boolean;
  _ended: boolean;
  _loop: boolean;
  _volume: number;
  _node: { gain?: FakeParam };
}

interface HowlOpts {
  src: string[];
  preload?: boolean;
  onload?: AnyFn;
  onloaderror?: AnyFn;
}

const mode = {
  loadFail: false,
  manualLoad: false,
  syncLoad: false,
  ctxNull: false,
  html5: false,
  playLock: false,
};
let nextSoundId = 1;
let lastHowl: Howl | undefined;
const howls = new Set<Howl>();

export const mockCtx = {
  state: "running",
  currentTime: 0,
  resume: vi.fn(() => Promise.resolve()),
};

export class Howl {
  opts: HowlOpts;
  _sounds: MockVoice[] = [];
  // Howl-global default volume (the no-id volume() setter). Distinct from each
  // voice's per-id volume and from Howler.volume() (the master).
  _globalVolume = 1;
  _playLock = false;
  private readonly queued: number[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(opts: HowlOpts) {
    this.opts = opts;
    lastHowl = this;
    howls.add(this);
    // howler's init() installs the `onload` / `onloaderror` options as
    // listeners BEFORE it calls load().
    if (opts.onload !== undefined) this.on("load", opts.onload);
    if (opts.onloaderror !== undefined) this.on("loaderror", opts.onloaderror);
    const event = mode.loadFail ? "loaderror" : "load";
    const msg = mode.loadFail ? "mock error" : undefined;
    if (mode.syncLoad) {
      for (const l of this.list(event)) setTimeout(() => l.fn(undefined, msg), 0);
      return;
    }
    if (!mode.manualLoad) {
      Promise.resolve().then(() => this.__emit(event, undefined, msg));
    }
  }

  private list(event: string): Listener[] {
    let arr = this.listeners.get(event);
    if (arr === undefined) {
      arr = [];
      this.listeners.set(event, arr);
    }
    return arr;
  }

  private voice(id: number | undefined): MockVoice | undefined {
    return this._sounds.find((v) => v._id === id);
  }

  private pick(id: number | undefined): MockVoice[] {
    return id === undefined ? this._sounds : this._sounds.filter((v) => v._id === id);
  }

  // howler's playWebAudio(): unpause and write the voice's gain.
  private start(v: MockVoice): void {
    v._paused = false;
    v._ended = false;
    v._node.gain?.setValueAtTime(v._volume, mockCtx.currentTime);
  }

  on(event: string, fn: AnyFn, id?: number): this {
    this.list(event).push({ fn, id, once: false });
    return this;
  }

  once(event: string, fn: AnyFn, id?: number): this {
    this.list(event).push({ fn, id, once: true });
    return this;
  }

  // howler's three off() shapes: off() clears every event; off(event) clears
  // that event; off(event, fn, id) removes the first matching listener.
  off(event?: string, fn?: AnyFn, id?: number): this {
    if (event === undefined) {
      this.listeners.clear();
      return this;
    }
    if (fn === undefined && id === undefined) {
      this.listeners.delete(event);
      return this;
    }
    const arr = this.list(event);
    const i = arr.findIndex((l) => l.id === id && (fn === undefined || l.fn === fn));
    if (i !== -1) arr.splice(i, 1);
    return this;
  }

  /**
   * Test helper: fire `event` for voice `id` synchronously. The natural `end`
   * of a non-loop voice parks it `_paused` + `_ended` first; a loop voice
   * keeps playing. A `playerror` (HTML5 play() rejected) parks the voice and
   * drops it from the play-lock queue, releasing the lock when it empties.
   */
  __emit(event: string, id?: number, msg?: unknown): void {
    const v = this.voice(id);
    if ((event === "end" && v !== undefined && !v._loop) || (event === "playerror" && v)) {
      v._ended = true;
      v._paused = true;
    }
    if (event === "playerror") {
      const i = this.queued.indexOf(id as number);
      if (i !== -1) this.queued.splice(i, 1);
      if (this.queued.length === 0) this._playLock = false;
    }
    for (const l of [...this.list(event)]) {
      if (l.id !== undefined && l.id !== id) continue;
      if (l.once) this.off(event, l.fn, l.id);
      l.fn(id, msg);
    }
  }

  /** Test helper: how many listeners are registered for `event`. */
  __listenerCount(event: string): number {
    return this.list(event).length;
  }

  /** Test helper: Howler's decode completing late. No-op once load() detached. */
  __emitLoad(): void {
    this.__emit("load");
  }

  /** Test helper: a late decode failure. No-op once load() detached. */
  __emitLoadError(): void {
    this.__emit("loaderror", undefined, "mock error");
  }

  /** Test helper: start every queued voice and fire its per-id `play`. */
  __release(): void {
    this._playLock = false;
    for (const id of this.queued.splice(0)) {
      const v = this.voice(id);
      if (v !== undefined && !v._ended) this.start(v);
      this.__emit("play", id);
    }
  }

  /**
   * Test helper: seed a pool voice in an arbitrary state without play() —
   * e.g. a never-played pooled voice (`_paused: true, _ended: true`).
   */
  __seedVoice(v: Partial<MockVoice> & { _id: number }): MockVoice {
    const voice: MockVoice = {
      _id: v._id,
      _paused: v._paused ?? false,
      _ended: v._ended ?? false,
      _loop: v._loop ?? false,
      _volume: v._volume ?? 1,
      _node: v._node ?? { gain: new FakeParam() },
    };
    this._sounds.push(voice);
    return voice;
  }

  play(spriteOrId?: number | string): number {
    let id = typeof spriteOrId === "number" ? spriteOrId : undefined;
    if (spriteOrId === undefined && !this._playLock) {
      // howler: a bare play() with EXACTLY ONE paused, not-ended voice resumes
      // it instead of starting a new one. A named sprite skips this branch.
      const paused = this._sounds.filter((v) => v._paused && !v._ended);
      if (paused.length === 1) id = paused[0]?._id;
    }
    if (id !== undefined) {
      const v = this.voice(id);
      if (v?._paused) this.start(v);
      return id;
    }
    const gain = mode.html5 ? undefined : new FakeParam();
    const v: MockVoice = {
      _id: nextSoundId++,
      _paused: true,
      _ended: false,
      _loop: false,
      _volume: this._globalVolume,
      _node: gain === undefined ? {} : { gain },
    };
    this._sounds.push(v);
    if (mode.playLock) {
      this._playLock = true;
      this.queued.push(v._id);
    } else {
      this.start(v);
    }
    return v._id;
  }

  pause(id?: number): this {
    for (const v of this.pick(id)) v._paused = true;
    return this;
  }

  stop(id?: number): this {
    for (const v of this.pick(id)) {
      v._paused = true;
      v._ended = true;
    }
    return this;
  }

  // howler's fade(): volume(from, id), then per voice a setValueAtTime +
  // linearRampToValueAtTime on its gain (and a volume interval, not modelled).
  fade(from: number, to: number, ms: number, id?: number): this {
    this.volume(from, id);
    const t = mockCtx.currentTime;
    for (const v of this.pick(id)) {
      v._volume = from;
      v._node.gain?.setValueAtTime(from, t);
      v._node.gain?.linearRampToValueAtTime(to, t + ms / 1000);
    }
    return this;
  }

  volume(v?: number, id?: number): number | this {
    // howler ignores anything outside [0, 1] (NaN included) and falls back to
    // the getter.
    if (v === undefined || !(v >= 0 && v <= 1)) return this._globalVolume;
    if (id === undefined) this._globalVolume = v;
    for (const s of this.pick(id)) {
      s._volume = v;
      s._node.gain?.setValueAtTime(v, mockCtx.currentTime);
    }
    return this;
  }

  rate(_r?: number, _id?: number): this {
    return this;
  }

  // howler's loop() overloads: loop(id) reads the per-id flag; loop(flag, id?)
  // sets it on one voice or all of them.
  loop(flagOrId?: boolean | number, id?: number): boolean | this {
    if (typeof flagOrId === "number") return this.voice(flagOrId)?._loop ?? false;
    if (flagOrId === undefined) return false;
    for (const v of this.pick(id)) v._loop = flagOrId;
    return this;
  }

  unload(): void {}
}

export const Howler = {
  get ctx() {
    return mode.ctxNull ? null : mockCtx;
  },
  // Master volume sink — recorded so a test can compose per-id × master.
  volume: vi.fn(),
  // howler's own running/suspended tracking (distinct from ctx.state);
  // Howl.play() only starts Web Audio playback while it is "running".
  state: "running",
};

/** Reset every mode, the id counter and the fake context between tests. */
export function __resetMock(): void {
  Object.assign(mode, {
    loadFail: false,
    manualLoad: false,
    syncLoad: false,
    ctxNull: false,
    html5: false,
    playLock: false,
  });
  nextSoundId = 1;
  lastHowl = undefined;
  howls.clear();
  mockCtx.state = "running";
  mockCtx.currentTime = 0;
  mockCtx.resume.mockReset();
  mockCtx.resume.mockImplementation(() => Promise.resolve());
  Howler.state = "running";
  Howler.volume.mockClear();
}

/** The next load() fails with `loaderror`. */
export function __setMockLoadFail(v: boolean): void {
  mode.loadFail = v;
}

/** A test drives `load` / `loaderror` via __emitLoad / __emitLoadError. */
export function __setManualLoad(v: boolean): void {
  mode.manualLoad = v;
}

/** Howler emits `load` / `loaderror` inside `new Howl()` (e.g. a cache hit). */
export function __setSyncLoad(v: boolean): void {
  mode.syncLoad = v;
}

/** No AudioContext: `Howler.ctx === null`. */
export function __setCtxNull(v: boolean): void {
  mode.ctxNull = v;
}

/** New voices get an HTML5 `_node` (no `.gain`). */
export function __setHtml5Mode(v: boolean): void {
  mode.html5 = v;
}

/** New voices are queued behind the play lock until __releasePlayLock(). */
export function __setPlayLock(v: boolean): void {
  mode.playLock = v;
}

/** The context starts: every queued voice plays and fires its `play` event. */
export function __releasePlayLock(): void {
  mode.playLock = false;
  for (const h of howls) h.__release();
}

/** The most recently constructed Howl (the one load() built internally). */
export function __lastHowl(): Howl {
  if (lastHowl === undefined) throw new Error("no Howl constructed yet");
  return lastHowl;
}
