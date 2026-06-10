// aiaudiojs — thin Web Audio shell over Howler.js, exposing the ai*js
// conventions (`dispose()` idempotency, AbortSignal, first-class
// `crossfade()`) on top of a proven runtime.
//
// v0.1.0: Howler delegation implemented. SoundImpl wraps Howl with per-
// instance lifecycle. createAudio returns a closure-based Audio object
// whose methods do not depend on `this`.
//
// v0.3.0: equal-power crossfade path via GainNode + setValueCurveAtTime.

import { Howl, Howler } from "howler";

/**
 * Configuration for {@link createAudio}.
 *
 * @public
 */
export interface AudioOptions {
  /**
   * If true (default), the first user gesture (touchstart / mousedown /
   * keydown) on the page calls `Howler.ctx.resume()` and detaches the
   * listeners. Set false if you want to wire the unlock manually via
   * {@link Audio.unlock}.
   */
  autoUnlock?: boolean;

  /**
   * Master volume applied to every Howl created by this Audio instance.
   * Range `[0, 1]`. Default `1`.
   */
  volume?: number;

  /**
   * Re-attempt `Howler.ctx.resume()` when the page visibility flips back
   * to visible. Best-effort iOS Safari workaround for the "context
   * suspends after background" pattern. Default `true`.
   */
  resumeOnVisibility?: boolean;
}

/**
 * Per-`play()` options.
 *
 * @public
 */
export interface PlayOptions {
  /** Range `[0, 1]`. Default: the Audio instance's master volume. */
  volume?: number;
  /** Playback rate. Default `1`. */
  rate?: number;
  /** Loop the buffer. Default `false`. */
  loop?: boolean;
  /**
   * Aborting this signal calls `stop()` on the returned sound id and
   * unhooks any internal listeners.
   */
  signal?: AbortSignal;
}

/**
 * Fade curve for {@link CrossfadeOptions.curve}.
 *
 * - `'linear'`       — amplitude ramp via Howler fade() (default; backward-compat).
 * - `'equal-power'`  — perceptual-loudness-preserving sin/cos ramp scheduled
 *                     directly on each sound's Web Audio GainNode
 *                     (`_node.gain`) via `setValueCurveAtTime`. Requires Howler
 *                     to be in Web Audio mode; in HTML5 fallback mode it throws
 *                     `AudioError` and the caller may downgrade to linear.
 *
 * @public
 */
export type CrossfadeCurve = "linear" | "equal-power";

/**
 * Options for {@link Audio.crossfade}.
 *
 * @public
 */
export interface CrossfadeOptions {
  /** Crossfade duration in seconds. */
  duration: number;
  /** Aborting cancels both ramps and resolves the promise immediately. */
  signal?: AbortSignal;
  /**
   * Fade curve. Default `'linear'` (backward-compat).
   * See {@link CrossfadeCurve}.
   *
   * @remarks
   * `'equal-power'` schedules sin/cos ramps scaled by the master volume
   * directly on each sound's Web Audio GainNode (`_node.gain`) via
   * `setValueCurveAtTime`: the outgoing sound follows `cos` (mv -> 0) and the
   * incoming sound follows `sin` (0 -> mv), so `sin^2 + cos^2 = 1` keeps the
   * perceived loudness flat. No extra GainNodes are inserted, so there is no
   * re-routing to restore. AbortSignal cancellation calls
   * `cancelScheduledValues(now)` then `setValueAtTime(currentValue, now)` on
   * every scheduled gain (in that order) and resolves early (not rejecting).
   *
   * `from` is assumed to be already playing; only `to` is started by the call.
   * Requires Web Audio mode — throws `AudioError` under the HTML5 fallback.
   * `Howl.fade()` is NOT invoked in this path.
   */
  curve?: CrossfadeCurve;
}

/**
 * Handle to a loaded audio buffer. One handle backs N concurrent plays;
 * Howler returns a numeric sound id per `play()` call so individual
 * instances can be paused / stopped / faded.
 *
 * @public
 */
export interface Sound {
  /** Start playback. Returns Howler's sound id for this instance. */
  play(opts?: PlayOptions): number;

  /** Pause one instance, or all instances if id is omitted. */
  pause(id?: number): void;

  /** Stop one instance, or all instances if id is omitted. */
  stop(id?: number): void;

  /**
   * Resume a paused instance, or all paused instances if id is omitted.
   *
   * - With `id`: resumes that specific voice and returns it.
   * - Without `id`: resumes every currently-paused voice (`_paused === true`)
   *   and returns the last resumed id, or `-1` if nothing was paused.
   *
   * @throws {@link AudioDisposedError} if called after {@link dispose}.
   */
  resume(id?: number): number;

  /**
   * Linearly fade from `from` to `to` over `ms` milliseconds. Resolves
   * after `ms` regardless of whether the fade visibly completed (Howler
   * fades cannot be cancelled mid-flight). If `dispose()` is called before
   * `fade()`, the returned promise rejects with `AudioDisposedError`; if
   * `dispose()` is called AFTER `fade()` started, the underlying howl is
   * unloaded but the promise still resolves at the scheduled time.
   */
  fade(from: number, to: number, ms: number, id?: number): Promise<void>;

  /**
   * Idempotent teardown for this Sound only. Stops every instance,
   * unloads the buffer, releases the Howl. Subsequent `play` / `pause` /
   * `stop` / `fade` throw {@link AudioDisposedError}.
   */
  dispose(): void;

  /**
   * Escape hatch — direct access to the underlying Howl for advanced API
   * not surfaced by aiaudiojs (e.g. sprites, custom HTML5 element).
   */
  readonly nativeHowl: Howl;

  /** `true` once {@link dispose} has been called. */
  readonly disposed: boolean;
}

/**
 * Top-level audio orchestrator. One per page (or per game). Wraps Howler's
 * global `AudioContext` and provides ai\*js-style lifecycle.
 *
 * @public
 */
export interface Audio {
  /**
   * Resume the underlying AudioContext. Safe to call before any user
   * gesture (will no-op until the gesture arrives). Idempotent.
   */
  unlock(): Promise<void>;

  /**
   * Load a buffer. Resolves to a {@link Sound} once Howler's `onload`
   * fires; rejects with {@link AudioError} on load failure or with the
   * standard `AbortError` if `signal` aborts mid-load.
   *
   * @remarks
   * **F3 — abort racing decode completion:** If `signal` aborts while a load is
   * in flight, `load()` rejects with `AbortError` and unloads the Howl. The
   * abort listener is removed once the `load` event fires, so aborting *after*
   * the load resolves is a no-op. In the narrow case where Howler still emits
   * its internal `load` event *after* an abort has already rejected (the decode
   * was already in-flight), a `Sound` is briefly added to the internal set and
   * then reclaimed by the next {@link disposeAll}. Call {@link disposeAll} if
   * you abort a load whose completion you cannot guarantee.
   *
   * @security The `url` parameter is passed directly to `new Howl({ src: [url] })`,
   * which forwards it to `Audio.src` (HTML5 mode) or `XMLHttpRequest.open`
   * (Web Audio decode). Any URL the caller passes is trusted. If you accept
   * URLs from untrusted sources you MUST validate them before calling `load`.
   */
  load(url: string, signal?: AbortSignal): Promise<Sound>;

  /**
   * Crossfade between two loaded sounds over `opts.duration` seconds.
   *
   * @remarks
   * Default `'linear'` curve delegates to `Howl.fade()` on both ramps; aborting
   * via `opts.signal` clears the resolve timer but cannot stop the in-flight
   * Howler ramp (both continue silently). Opt-in `curve: 'equal-power'` (0.3.0)
   * schedules sin/cos ramps on the AudioContext via `setValueCurveAtTime`,
   * preserving perceptual loudness; abort cancels the schedule cleanly.
   *
   * **F2 — concurrent crossfades on the same Sound:** Once a new `crossfade()`
   * starts on a `Sound`, any `AbortController` that was issued for a *previous*
   * crossfade on that same Sound **must not be fired** after the new crossfade
   * begins. Aborting the old controller would call `cancelScheduledValues` and
   * `setValueAtTime` on the GainNode, overwriting the ramp the new crossfade just
   * scheduled. Each crossfade owns its abort signal exclusively; the caller is
   * responsible for retiring old controllers before starting a new crossfade.
   *
   * **F5 — equal-power assumes `from` is at masterVolume:** The equal-power path
   * starts the `cos` ramp from the current masterVolume, not from a per-instance
   * override. If `from` was started with a different volume (e.g.
   * `from.play({ volume: 0.5 })`), the initial gain will snap to masterVolume at
   * the start of the crossfade, which may produce an audible click. For a
   * click-free transition, ensure `from` is playing at masterVolume before calling
   * `crossfade({ curve: 'equal-power' })`.
   *
   * **F9 — rampSound throwing mid-crossfade:** If the AudioParam scheduling calls
   * throw (e.g. the context is closed unexpectedly mid-crossfade), the `to` sound
   * may be left running at its scheduled volume with no further ramp applied. This
   * is a known defensive edge case; callers may handle it by catching the thrown
   * `AudioError` and calling `to.stop()` explicitly.
   */
  crossfade(from: Sound, to: Sound, opts: CrossfadeOptions): Promise<void>;

  /** Master volume. Setting this propagates to every active Sound. */
  volume: number;

  /**
   * Idempotent teardown. Alias for {@link Audio.disposeAll}, provided so
   * the Audio interface conforms to the ai*js convention that every
   * factory-built handle exposes `dispose()`. Tears down every
   * {@link Sound} this Audio instance created and releases the
   * underlying Howler bindings. Subsequent `load` / `unlock` /
   * `crossfade` throw {@link AudioDisposedError}.
   */
  dispose(): void;

  /**
   * Idempotent teardown — identical effect to {@link Audio.dispose};
   * kept as a descriptive name for code paths that want to be explicit
   * about the cascading nature (every Sound this Audio created is torn
   * down). Subsequent `load` / `unlock` / `crossfade` throw
   * {@link AudioDisposedError}.
   */
  disposeAll(): void;

  /** `true` once {@link disposeAll} has been called. */
  readonly disposed: boolean;
}

/**
 * Recoverable audio error. Thrown on load failure, on unsupported
 * codec, and on precondition violations.
 *
 * @public
 */
export class AudioError extends Error {
  override readonly name = "AudioError";
}

/**
 * Thrown by any method called after {@link Audio.disposeAll} (on the Audio
 * instance) or after {@link Sound.dispose} (on a specific Sound).
 *
 * @public
 */
export class AudioDisposedError extends Error {
  override readonly name = "AudioDisposedError";
}

// ---------------------------------------------------------------------------
// Module-scope sin/cos curves for equal-power crossfade.
// Built once on first equal-power invocation; shared across all Audio instances.
// ---------------------------------------------------------------------------

let sinCurve: Float32Array | undefined;
let cosCurve: Float32Array | undefined;

function ensureCurves(): { sin: Float32Array; cos: Float32Array } {
  if (sinCurve === undefined || cosCurve === undefined) {
    const N = 64;
    const s = new Float32Array(N);
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * (Math.PI / 2);
      s[i] = Math.sin(t);
      c[i] = Math.cos(t);
    }
    sinCurve = s;
    cosCurve = c;
  }
  return { sin: sinCurve, cos: cosCurve };
}

// ---------------------------------------------------------------------------
// Internal types for equal-power GainNode access
// ---------------------------------------------------------------------------

interface HowlInternalSound {
  // Howler's per-play sound id (matches the value returned by `Howl.play()`).
  _id?: number;
  // Web Audio mode: `_node` is a GainNode (has `.gain`). HTML5 mode: `_node`
  // is an <audio> element (no `.gain`), so the field is optional.
  _node?: { gain?: AudioParam };
  // Howler's source-of-truth per-sound volume. We sync it to the crossfade's
  // terminal value so a later `Howler.mute()` / re-`play()` re-derives the
  // correct gain instead of the pre-crossfade value.
  _volume?: number;
  // Howler marks idle/stopped pool voices `_paused === true`; playing voices
  // `false`. Undefined in test mocks (treated as not paused → included).
  _paused?: boolean;
  // Howler marks a voice `_ended === true` once it is stopped, ends naturally,
  // or is a never-played pooled voice — even while `_paused` is also true. The
  // resume enumeration keys on this to avoid replaying finished voices.
  _ended?: boolean;
}
interface HowlWithSounds {
  _sounds: HowlInternalSound[];
}

// Single guarded entry point for every `_sounds` private-internal reach-in
// (resume enumeration, equal-power voice filter + gain access). Howler is a
// `^2.2.4` peer, so a 2.3.x could rename or drop `_sounds`; mapping a missing
// shape to a named `AudioError` here keeps every call site degrading the same
// way instead of crashing with a raw TypeError (AUD-B-03).
function getSounds(howl: Howl): HowlInternalSound[] {
  const raw = (howl as unknown as Partial<HowlWithSounds>)._sounds;
  if (!Array.isArray(raw)) {
    throw new AudioError("howler internal `_sounds` is unavailable (unexpected howler version?)");
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface State {
  sounds: Set<SoundImpl>;
  masterVolume: number;
  autoUnlock: boolean;
  resumeOnVisibility: boolean;
  unlockHandlers: { events: string[]; handler: () => void } | undefined;
  visibilityHandler: (() => void) | undefined;
  disposed: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const noop = (): void => {};

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// ---------------------------------------------------------------------------
// SoundImpl — per-buffer handle wrapping a single Howl
// ---------------------------------------------------------------------------

class SoundImpl implements Sound {
  private _disposed = false;
  // Active play() abort-cleanups. Run on dispose() so that a still-live user
  // AbortSignal does not retain the abort listener (and the Howl it closes
  // over) after the sound is unloaded. Howler emits no 'unload' event, so
  // unload() alone cannot trigger these — dispose() must invoke them.
  private readonly _abortCleanups = new Set<() => void>();

  constructor(
    private readonly howl: Howl,
    private readonly state: State,
  ) {}

  get nativeHowl(): Howl {
    return this.howl;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  private ck(): void {
    if (this._disposed) throw new AudioDisposedError("aiaudiojs: Sound has been disposed");
  }

  play(opts?: PlayOptions): number {
    this.ck();
    const looping = opts?.loop ?? false;
    const id = this.howl.play();
    this.howl.volume(opts?.volume ?? this.state.masterVolume, id);
    this.howl.rate(opts?.rate ?? 1, id);
    this.howl.loop(looping, id);
    const signal = opts?.signal;
    if (signal !== undefined) {
      if (signal.aborted) {
        this.howl.stop(id);
      } else {
        // Capture howl in a local so cleanup closures are self-contained.
        const howl = this.howl;
        let onAbort: (() => void) | undefined;

        // Remove the abort listener and detach howl event listeners.
        const cleanup = (): void => {
          if (onAbort !== undefined) {
            signal.removeEventListener("abort", onAbort);
            onAbort = undefined;
          }
          howl.off("end", onEnd, id);
          howl.off("stop", onStop, id);
          this._abortCleanups.delete(cleanup);
        };

        // Howler per-id end/stop callbacks — natural sound termination. For a
        // LOOPING voice, Howler fires `end` at every loop boundary while
        // playback continues, so cleanup there would tear down the abort
        // wiring mid-playback (AUD-R-01); only a non-loop `end` terminates the
        // voice. `stop` always terminates, looping or not.
        const onEnd = (_id: number): void => {
          if (!looping) cleanup();
        };
        const onStop = (_id: number): void => cleanup();

        onAbort = (): void => {
          howl.stop(id);
          cleanup();
        };

        signal.addEventListener("abort", onAbort, { once: true });
        howl.on("end", onEnd, id);
        howl.on("stop", onStop, id);
        this._abortCleanups.add(cleanup);
      }
    }
    return id;
  }

  pause(id?: number): void {
    this.ck();
    this.howl.pause(id);
  }

  stop(id?: number): void {
    this.ck();
    this.howl.stop(id);
  }

  resume(id?: number): number {
    this.ck();
    if (id !== undefined) {
      this.howl.play(id);
      return id;
    }
    let last = -1;
    for (const s of getSounds(this.howl)) {
      // Resume only genuinely-paused voices. Howler marks stopped / naturally
      // ended / never-played pooled voices `_paused === true` too, but with
      // `_ended === true` — replaying those would restart finished SFX from
      // zero or start a never-played voice (AUD-B-01; see the `_paused`
      // comment on HowlInternalSound).
      if (s._paused === true && s._ended !== true && s._id !== undefined) {
        this.howl.play(s._id);
        last = s._id;
      }
    }
    return last;
  }

  fade(from: number, to: number, ms: number, id?: number): Promise<void> {
    if (this._disposed)
      return Promise.reject(new AudioDisposedError("aiaudiojs: Sound has been disposed"));
    this.howl.fade(from, to, ms, id);
    // Note: if dispose() runs mid-fade, the underlying howl is unloaded but
    // this promise still resolves at `ms` (we don't cancel the timer); the
    // resolution simply fires with no observable effect since the howl is gone.
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Run pending play() abort-cleanups before unloading: Howler has no
    // 'unload' event, so otherwise a still-live user signal would retain the
    // abort listener (and this Howl via its closure). Each cleanup() removes
    // itself from the set, so iterate a snapshot.
    for (const c of [...this._abortCleanups]) c();
    this._abortCleanups.clear();
    this.howl.unload();
    this.state.sounds.delete(this);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct an Audio instance backed by Howler.js.
 *
 * Requires `howler@^2.2.4` as a peer dependency.
 *
 * @example
 * ```ts
 * import { createAudio } from "aiaudiojs";
 *
 * const audio = createAudio({ autoUnlock: true });
 *
 * const sfx = await audio.load("zap.mp3");
 * const id = sfx.play({ volume: 0.8 });
 *
 * const bgmA = await audio.load("level1.mp3");
 * const bgmB = await audio.load("level2.mp3");
 * bgmA.play({ loop: true });
 *
 * // Switch tracks with a 2-second crossfade.
 * await audio.crossfade(bgmA, bgmB, { duration: 2 });
 *
 * audio.disposeAll();
 * ```
 *
 * @public
 */
export function createAudio(opts?: AudioOptions): Audio {
  const state: State = {
    sounds: new Set(),
    masterVolume: clamp(opts?.volume ?? 1),
    autoUnlock: opts?.autoUnlock ?? true,
    resumeOnVisibility: opts?.resumeOnVisibility ?? true,
    unlockHandlers: undefined,
    visibilityHandler: undefined,
    disposed: false,
  };

  // Propagate initial volume to Howler global.
  Howler.volume(state.masterVolume);

  function ck(): void {
    if (state.disposed) throw new AudioDisposedError("aiaudiojs: Audio has been disposed");
  }

  // Wire up autoUnlock.
  if (state.autoUnlock && typeof document !== "undefined") {
    const unlockEvents = ["touchstart", "mousedown", "keydown"];
    const handler = (): void => {
      for (const ev of unlockEvents) {
        document.removeEventListener(ev, handler);
      }
      state.unlockHandlers = undefined;
      Howler.ctx?.resume().catch(noop);
    };
    for (const ev of unlockEvents) {
      document.addEventListener(ev, handler, { once: false });
    }
    state.unlockHandlers = { events: unlockEvents, handler };
  }

  // Wire up resumeOnVisibility.
  if (state.resumeOnVisibility && typeof document !== "undefined") {
    const visHandler = (): void => {
      if (document.visibilityState === "visible") {
        Howler.ctx?.resume().catch(noop);
      }
    };
    document.addEventListener("visibilitychange", visHandler);
    state.visibilityHandler = visHandler;
  }

  function unlock(): Promise<void> {
    if (state.disposed)
      return Promise.reject(new AudioDisposedError("aiaudiojs: Audio has been disposed"));
    if (Howler.ctx === undefined) return Promise.resolve();
    return Howler.ctx.resume().catch(noop);
  }

  function load(url: string, signal?: AbortSignal): Promise<Sound> {
    if (state.disposed)
      return Promise.reject(new AudioDisposedError("aiaudiojs: Audio has been disposed"));
    if (typeof url !== "string" || url.length === 0) {
      return Promise.reject(new AudioError("url must be a non-empty string"));
    }
    if (signal?.aborted === true) {
      return Promise.reject(new DOMException("Load aborted", "AbortError"));
    }
    return new Promise<Sound>((resolve, reject) => {
      const howl = new Howl({ src: [url], preload: true });
      let abortHandler: (() => void) | undefined;
      const cleanupAbort = (): void => {
        if (abortHandler !== undefined && signal !== undefined) {
          signal.removeEventListener("abort", abortHandler);
        }
      };
      howl.once("load", () => {
        cleanupAbort();
        const sound = new SoundImpl(howl, state);
        state.sounds.add(sound);
        resolve(sound);
      });
      howl.once("loaderror", (_id: number, errMsg: unknown) => {
        cleanupAbort();
        howl.unload();
        reject(new AudioError(`load failed: ${String(errMsg)}`));
      });
      if (signal !== undefined) {
        abortHandler = (): void => {
          cleanupAbort();
          howl.unload();
          reject(new DOMException("Load aborted", "AbortError"));
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    });
  }

  // Active Web Audio sound instances of `howl`. Howler routes each Web Audio
  // sound as `bufferSource -> sound._node (GainNode) -> Howler.masterGain`, so
  // `_node.gain` IS the per-sound volume param. In HTML5 mode `_node` is an
  // <audio> element with no `.gain`, so it is filtered out (empty array there).
  function webAudioSounds(howl: Howl): HowlInternalSound[] {
    return getSounds(howl).filter((s) => s._node?.gain !== undefined && s._paused !== true);
  }

  // Schedule an equal-power ramp on one sound's gain and sync Howler's
  // source-of-truth `_volume` to the ramp's terminal value, so a later
  // `Howler.mute()` / re-`play()` re-derives the correct gain (not the
  // pre-crossfade value). Returns the gain param so abort can freeze it.
  function rampSound(
    s: HowlInternalSound,
    curve: Float32Array,
    terminal: number,
    now: number,
    dur: number,
  ): AudioParam {
    const g = s._node?.gain as AudioParam;
    g.cancelScheduledValues(now);
    g.setValueAtTime(curve[0] as number, now);
    g.setValueCurveAtTime(curve, now, dur);
    s._volume = terminal;
    return g;
  }

  function crossfadeEqualPower(from: Sound, to: Sound, cfOpts: CrossfadeOptions): Promise<void> {
    const ctx = Howler.ctx;
    if (ctx === undefined) {
      throw new AudioError("equal-power crossfade requires Web Audio mode; HTML5 fallback active");
    }
    // `from` is assumed to be already playing (crossfade contract); only the
    // incoming `to` is started here. Both fades are scheduled DIRECTLY on
    // Howler's per-sound GainNode (`_node.gain`) via setValueCurveAtTime —
    // Howl.fade() is not used in this path. No extra GainNodes are inserted,
    // so there is nothing to re-route or restore.
    const toId = to.play({ volume: 0 });
    // Past this point a voice is live on `to`; any reach-in failure (HTML5
    // fallback OR a reshaped `_sounds`) must stop it before throwing so no
    // silent orphan voice is left playing (AUD-B-03).
    let toSounds: HowlInternalSound[];
    let fromSounds: HowlInternalSound[];
    try {
      toSounds = webAudioSounds(to.nativeHowl).filter((s) => s._id === toId);
      if (toSounds.length === 0) {
        throw new AudioError(
          "equal-power crossfade requires Web Audio mode; HTML5 fallback active",
        );
      }
      fromSounds = webAudioSounds(from.nativeHowl);
    } catch (err) {
      to.stop(toId);
      throw err;
    }

    const mv = state.masterVolume;
    const now = ctx.currentTime;
    const { sin, cos } = ensureCurves();
    const dur = cfOpts.duration;
    const cosScaled = cos.map((v) => v * mv);
    const sinScaled = sin.map((v) => v * mv);
    // Outgoing: mv -> 0 along cos. Incoming: 0 -> mv along sin. sin^2+cos^2=1
    // keeps perceived loudness flat. Terminal state mirrors the linear path
    // (from at 0, to at mv) and is written to each sound's `_volume`.
    // `touched` holds the sound objects so the abort branch can sync `_volume`.
    const touched = [...fromSounds, ...toSounds];
    for (const s of fromSounds) rampSound(s, cosScaled, 0, now, dur);
    for (const s of toSounds) rampSound(s, sinScaled, mv, now, dur);
    const durationMs = dur * 1000;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (abortedMidway: boolean): void => {
        if (done) return;
        done = true;
        if (abortedMidway) {
          // Freeze each ramp at its current value (Web Audio requires
          // cancelScheduledValues THEN setValueAtTime, in that order) and
          // sync `_volume` to the frozen position so a later Howler.mute() /
          // unmute() re-derives the correct gain rather than the terminal.
          const t = ctx.currentTime;
          for (const s of touched) {
            const g = s._node?.gain;
            if (g === undefined) continue;
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            s._volume = g.value;
          }
        }
        cleanupAbort();
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        resolve();
      };

      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => finish(false),
        durationMs,
      );

      let onAbort: (() => void) | undefined;
      const cleanupAbort = (): void => {
        if (cfOpts.signal !== undefined && onAbort !== undefined) {
          cfOpts.signal.removeEventListener("abort", onAbort);
          onAbort = undefined;
        }
      };
      if (cfOpts.signal !== undefined) {
        onAbort = () => finish(true);
        cfOpts.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function crossfade(from: Sound, to: Sound, cfOpts: CrossfadeOptions): Promise<void> {
    ck();
    if (from.disposed || to.disposed) {
      throw new AudioError("cannot crossfade a disposed Sound");
    }
    const durationMs = cfOpts.duration * 1000;
    if (cfOpts.duration <= 0) {
      return Promise.reject(new AudioError("crossfade duration must be > 0"));
    }
    if (cfOpts.signal?.aborted === true) {
      return Promise.reject(new DOMException("Crossfade aborted", "AbortError"));
    }

    if (cfOpts.curve === "equal-power") {
      return crossfadeEqualPower(from, to, cfOpts);
    }

    to.play({ volume: 0 });
    from.nativeHowl.fade(state.masterVolume, 0, durationMs);
    to.nativeHowl.fade(0, state.masterVolume, durationMs);
    return new Promise<void>((resolve) => {
      const signal = cfOpts.signal;
      let onAbort: (() => void) | undefined;
      const cleanupAbort = (): void => {
        if (signal !== undefined && onAbort !== undefined) {
          signal.removeEventListener("abort", onAbort);
          onAbort = undefined;
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        timer = undefined;
        cleanupAbort();
        resolve();
      }, durationMs);
      if (signal !== undefined) {
        onAbort = (): void => {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          // NOTE: Howler.fade() in flight CANNOT be cancelled; the fade
          // keeps running silently. We resolve early so callers can move on.
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  function doDispose(): void {
    if (state.disposed) return;
    state.disposed = true;
    for (const sound of state.sounds) {
      sound.dispose();
    }
    state.sounds.clear();
    if (state.unlockHandlers !== undefined && typeof document !== "undefined") {
      const { events, handler } = state.unlockHandlers;
      for (const ev of events) {
        document.removeEventListener(ev, handler);
      }
      state.unlockHandlers = undefined;
    }
    if (state.visibilityHandler !== undefined && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", state.visibilityHandler);
      state.visibilityHandler = undefined;
    }
  }

  return {
    unlock,
    load,
    crossfade,
    get volume(): number {
      return state.masterVolume;
    },
    set volume(v: number) {
      state.masterVolume = clamp(v);
      Howler.volume(state.masterVolume);
    },
    dispose: doDispose,
    disposeAll: doDispose,
    get disposed(): boolean {
      return state.disposed;
    },
  };
}
