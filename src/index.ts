// aiaudiojs — thin Web Audio shell over Howler.js, exposing the ai*js
// conventions (`dispose()` idempotency, AbortSignal, first-class
// `crossfade()`) on top of a proven runtime.
//
// SoundImpl wraps one Howl with per-instance lifecycle. createAudio returns a
// closure-based Audio object whose methods do not depend on `this`. The
// equal-power crossfade schedules sin/cos ramps directly on Howler's per-voice
// GainNode (`_node.gain`) as piecewise linear ramps.

import { Howl, Howler } from "howler";

/**
 * Configuration for {@link createAudio}.
 *
 * @public
 */
export interface AudioOptions {
  /**
   * If true (default), the first user gesture (touchend / pointerup /
   * keydown) on the page calls `Howler.ctx.resume()` and detaches the
   * listeners once the context is actually running. Set false if you want
   * to wire the unlock manually via {@link Audio.unlock}.
   */
  autoUnlock?: boolean;

  /**
   * Master volume. Range `[0, 1]`. Default `1`. Applied via Howler's
   * GLOBAL `Howler.volume()`, not scoped to this Audio instance — other
   * `Audio` instances (or callers) that also touch `Howler.volume()` share
   * and can overwrite it. Prefer one `Audio` controller per app/scene.
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
  /**
   * Relative `[0, 1]` per-voice volume. Default `1`. This is multiplied by
   * the Audio instance's master volume (applied globally by Howler), not
   * defaulted to it — defaulting to the master would double-attenuate.
   */
  volume?: number;
  /**
   * Playback rate. Default `1`. Must be a finite number: a non-finite rate
   * throws {@link AudioError} before any voice starts.
   */
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
 *                     (`_node.gain`) as piecewise `linearRampToValueAtTime`
 *                     points. Requires Howler to be in Web Audio mode; in HTML5
 *                     fallback mode it throws `AudioError` and the caller may
 *                     downgrade to linear.
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
  /**
   * Crossfade duration in seconds. Must be a finite number `> 0`. The
   * completion timer is clamped to 2,147,483,647 ms (about 24.8 days).
   */
  duration: number;
  /**
   * Aborting resolves the promise immediately. On the `'equal-power'`
   * curve, aborting also freezes both ramps at their current gain. On the
   * `'linear'` curve (Howler's own `fade()`), Howler's fades cannot be
   * cancelled mid-flight, so aborting does NOT stop the in-progress ramps —
   * it only makes the returned promise settle early. Neither curve stops
   * `from` on abort: after an abort the caller owns both voices; stop or
   * re-fade `from` yourself.
   */
  signal?: AbortSignal;
  /**
   * Start the incoming voice looping. Default `false`. The flag is applied to
   * the voice this call starts (Howler's per-id `loop(id)`), so it matches
   * the caller's intent even if the Howl-level loop flag differs.
   */
  loop?: boolean;
  /**
   * Fade curve. Default `'linear'` (backward-compat).
   * See {@link CrossfadeCurve}.
   *
   * @remarks
   * `'equal-power'` schedules relative `[0, 1]` sin/cos ramps directly on each
   * sound's Web Audio GainNode (`_node.gain`) as 64-point piecewise
   * `linearRampToValueAtTime` schedules (not `setValueCurveAtTime`, whose
   * exclusive time window makes any other gain write during the ramp — e.g.
   * Howler's own volume / fade / resume — throw `NotSupportedError`): the
   * outgoing sound follows `cos` (1 -> 0) and the incoming sound follows `sin`
   * (0 -> 1), so `sin^2 + cos^2 = 1` keeps the perceived loudness flat. The
   * curves are NOT scaled by the master volume — the master is applied exactly
   * once via Howler's global gain, so scaling here as well would attenuate the
   * crossfade to mv². No extra GainNodes are inserted, so there is no re-routing
   * to restore. AbortSignal cancellation calls `cancelScheduledValues(now)` then
   * `setValueAtTime(currentValue, now)` on every scheduled gain (in that order)
   * and resolves early (not rejecting).
   *
   * `from` is assumed to be already playing; only `to` is started by the call.
   * On normal completion the ramped `from` voices are stopped, as on the
   * `'linear'` curve. Requires Web Audio mode — throws `AudioError` under the
   * HTML5 fallback. `Howl.fade()` is NOT invoked in this path.
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
   * - With `id`: resumes that specific voice and returns it, or returns
   *   `-1` if `id` is not currently a paused, non-ended voice (e.g. it
   *   already ended naturally, was never paused, or its `play()` is still
   *   queued behind the AudioContext).
   * - Without `id`: resumes every currently-paused, non-ended voice
   *   (`_paused === true && _ended !== true`) and returns the last resumed
   *   id, or `-1` if nothing was resumed.
   *
   * @throws {@link AudioDisposedError} if called after {@link dispose}.
   */
  resume(id?: number): number;

  /**
   * Linearly fade from `from` to `to` over `ms` milliseconds. Resolves
   * after `ms` regardless of whether the fade visibly completed (Howler
   * fades cannot be cancelled mid-flight).
   *
   * Never throws synchronously; every failure is a rejection, checked in this
   * order before `Howl.fade()` runs (so a rejected call has no side effect):
   * {@link AudioDisposedError} if `dispose()` was already called;
   * {@link AudioError} if `from` or `to` is not a finite number in `[0, 1]`;
   * {@link AudioError} if `ms` is not a finite number `>= 0`. Delays above
   * 2,147,483,647 ms (about 24.8 days) are clamped. If `dispose()` is called
   * AFTER `fade()` started, the underlying howl is unloaded but the promise
   * still resolves at the scheduled time.
   */
  fade(from: number, to: number, ms: number, id?: number): Promise<void>;

  /**
   * Idempotent teardown for this Sound only. Stops every instance,
   * unloads the buffer, releases the Howl. Subsequent `play` / `pause` /
   * `stop` / `resume` throw {@link AudioDisposedError} synchronously;
   * `fade` instead returns a promise that rejects with it.
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
   * first of Howler's `load` / `loaderror` events or the abort to fire settles
   * the promise and detaches the other two listeners (a `settled` guard plus
   * bare `off()`), so a `load` event Howler still emits *after* the abort has
   * already rejected is a no-op: no `Sound` is added to the internal set and
   * no second `unload()` happens. `dispose()` / `disposeAll()` settle every
   * in-flight `load()` the same way, immediately: it rejects with
   * {@link AudioDisposedError} and its Howl is unloaded, without waiting for
   * Howler's decode to finish.
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
   * Default `'linear'` curve delegates to `Howl.fade()`: every voice of `from`
   * ramps 1 -> 0 and the one voice this call starts on `to` ramps 0 -> 1.
   * Aborting via `opts.signal` clears the resolve timer but cannot stop the
   * in-flight Howler ramp (both continue silently). Opt-in
   * `curve: 'equal-power'` (0.3.0) schedules sin/cos ramps on the AudioContext
   * as piecewise `linearRampToValueAtTime` points, preserving perceptual
   * loudness; abort cancels the schedule cleanly.
   *
   * **Completion.** Both curves capture `from`'s playing voices before `to`
   * starts. When the duration elapses, those voices are stopped (unless `from`
   * was disposed meanwhile), so a looping outgoing track does not keep playing
   * silently. `crossfade(s, s)` is supported: the old voices of `s` stop and
   * the new one keeps playing. On abort neither curve stops `from`: the caller
   * owns both voices; stop or re-fade `from` yourself. `opts.loop` starts the
   * incoming voice looping.
   *
   * **Failure channels — synchronous `throw` vs promise rejection.** This method
   * reports errors on two different channels; a `.catch()` alone does NOT cover
   * both, so wrap the call in `try { await audio.crossfade(...) } catch` to catch
   * everything:
   * - **Synchronously thrown (before a promise exists):**
   *   `AudioDisposedError` when the Audio instance is disposed;
   *   `AudioError` when `from` or `to` is a disposed Sound (or not a Sound);
   *   `AudioError` when Howler's private `_sounds` internal is unavailable
   *   (unexpected Howler version); and, on the `equal-power` path only,
   *   `AudioError` when Howler is in HTML5 fallback mode (no Web Audio context /
   *   no `_node.gain`) or the AudioContext is not running. `from`'s voices are
   *   read before `to` starts; if `to` has already started when a check fails,
   *   its voice is stopped before the throw, so no silent orphan is left.
   * - **Rejected (a returned promise):** `AudioError` when `opts` is missing or
   *   `opts.duration` is not a finite number `> 0`; `DOMException("AbortError")`
   *   when `opts.signal` is already aborted at call time. Both of these are
   *   checked before any voice is started, so a rejection never orphans a voice.
   *
   * **F2 — concurrent crossfades on the same Sound:** Once a new `crossfade()`
   * starts on a `Sound`, any `AbortController` that was issued for a *previous*
   * crossfade on that same Sound **must not be fired** after the new crossfade
   * begins. Aborting the old controller would call `cancelScheduledValues` and
   * `setValueAtTime` on the GainNode, overwriting the ramp the new crossfade just
   * scheduled. Each crossfade owns its abort signal exclusively; the caller is
   * responsible for retiring old controllers before starting a new crossfade.
   *
   * **F5 — equal-power gain is relative `[0, 1]`:** The equal-power ramps are
   * scheduled as relative gain values (`from` follows `cos`: 1 → 0; `to` follows
   * `sin`: 0 → 1); the master volume is applied exactly once via Howler's global
   * gain, not folded into these curves. The `cos` ramp therefore starts the
   * outgoing voice at relative gain `1`, regardless of any per-instance volume it
   * was played with — so if `from` was started with `from.play({ volume: 0.5 })`,
   * its gain snaps to relative `1` at the start of the crossfade, which may
   * produce an audible click. For a click-free transition, ensure `from` is
   * playing at its full relative gain before calling
   * `crossfade({ curve: 'equal-power' })`.
   *
   * **F9 — AudioParam scheduling throwing mid-crossfade:** If a
   * `linearRampToValueAtTime` / `setValueAtTime` call throws *after* the ramps have begun (e.g. the context
   * is closed unexpectedly mid-crossfade), the `to` sound may be left running at
   * its scheduled gain with no further ramp applied. This is a known defensive
   * edge case distinct from the pre-flight `AudioError` throws above: it surfaces
   * as the raw Web Audio exception, and callers that need to recover should catch
   * it and call `to.stop()` explicitly. (The pre-flight HTML5-fallback / disposed
   * / reshaped-`_sounds` throws, by contrast, never leave a `to` voice running.)
   *
   * The completion timer is clamped to 2,147,483,647 ms (about 24.8 days).
   */
  crossfade(from: Sound, to: Sound, opts: CrossfadeOptions): Promise<void>;

  /**
   * Master volume. Getting/setting this reads/writes Howler's GLOBAL
   * `Howler.volume()` — it does not iterate or scope to this Audio
   * instance's own Sounds, so it also affects any other `Audio` instance
   * or direct Howler usage sharing the page.
   */
  volume: number;

  /**
   * Idempotent teardown. Alias for {@link Audio.disposeAll}, provided so
   * the Audio interface conforms to the ai*js convention that every
   * factory-built handle exposes `dispose()`. Tears down every
   * {@link Sound} this Audio instance created, rejects every in-flight
   * `load()` with {@link AudioDisposedError}, and releases the
   * underlying Howler bindings. Subsequent `crossfade` throws
   * {@link AudioDisposedError} synchronously; `load` and `unlock` instead
   * return a promise that rejects with it.
   */
  dispose(): void;

  /**
   * Idempotent teardown — identical effect to {@link Audio.dispose};
   * kept as a descriptive name for code paths that want to be explicit
   * about the cascading nature (every Sound this Audio created is torn
   * down). Subsequent `crossfade` throws {@link AudioDisposedError}
   * synchronously; `load` and `unlock` instead return a promise that
   * rejects with it.
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
// (resume enumeration, crossfade voice capture + gain access). Howler is a
// `^2.2.4` peer, so a 2.3.x could rename or drop `_sounds`; mapping a missing
// shape to a named `AudioError` here keeps every call site degrading the same
// way instead of crashing with a raw TypeError (AUD-B-03).
function getSounds(howl: Howl): HowlInternalSound[] {
  const raw = (howl as unknown as Partial<HowlWithSounds>)._sounds;
  if (!Array.isArray(raw)) {
    throw new AudioError(
      "aiaudiojs: howler internal `_sounds` is unavailable (unexpected howler version?)",
    );
  }
  return raw;
}

// Voices of `howl` that are currently playing: started, not paused, not ended.
function playing(howl: Howl): HowlInternalSound[] {
  return getSounds(howl).filter(
    (s) => s._id !== undefined && s._paused !== true && s._ended !== true,
  );
}

// Web Audio mode: `_node` is a GainNode whose `.gain` IS the per-voice volume
// param (`bufferSource -> _node -> Howler.masterGain`). HTML5 mode: `_node` is
// an <audio> element with no `.gain`.
const hasGain = (s: HowlInternalSound): boolean => s._node?.gain !== undefined;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface State {
  sounds: Set<SoundImpl>;
  // Hooks dispose() runs: the settle-on-dispose hook of every in-flight
  // load() (removed once that load settles) and the document-listener
  // detachers (autoUnlock removes its own once the context is running).
  teardown: Set<() => void>;
  masterVolume: number;
  disposed: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const noop = (): void => {};

const SOUND_DISPOSED = "aiaudiojs: Sound has been disposed";
const AUDIO_DISPOSED = "aiaudiojs: Audio has been disposed";
const HTML5_ACTIVE =
  "aiaudiojs: equal-power crossfade requires Web Audio mode; HTML5 fallback active";

// Master volume normalisation to [0, 1]. `v >= 0` is false for NaN, -Infinity,
// negatives and non-numeric input, which all normalise to 0 (silent) — the
// safe floor — instead of poisoning state.masterVolume and Howler.volume with
// NaN (AUD-S-02). +Infinity clamps to the ceiling.
const clamp = (v: number): number => (v >= 0 ? Math.min(1, v) : 0);

// `v` is a number in `[0, max]`. NaN, non-numbers and values above `max` fail,
// so the default `max` also rejects +Infinity.
const isNum = (v: unknown, max = Number.MAX_VALUE): v is number =>
  typeof v === "number" && v >= 0 && v <= max;

// Family timer rule: every setTimeout delay goes through here. A delay above
// 2^31-1 ms (about 24.8 days) overflows the timer and fires immediately, so it
// is clamped instead (no timer chaining).
const clampDelay = (ms: number): number => Math.min(ms, 2_147_483_647);

/**
 * Shared resolve-after-duration-with-abort lifecycle for both crossfade paths.
 *
 * Resolves the returned promise after `durationMs` (normal completion), running
 * `onComplete()` first. If `signal` aborts first, runs `onAbort()` instead (the
 * path-specific side effect — e.g. freezing the equal-power ramps; a no-op for
 * the linear path) and resolves early. BOTH paths clear the timer and remove
 * the abort listener, so neither callback can run after the other and the
 * abort handler can never outlive the crossfade (AUD-C-01, prior-wave M1).
 */
function resolveAfterWithAbort(
  durationMs: number,
  signal: AbortSignal | undefined,
  onAbort: () => void,
  onComplete: () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (aborted: boolean): void => {
      // First of timer / abort wins, even if the other fires re-entrantly from
      // inside the winner's side effect.
      if (done) return;
      done = true;
      // try/finally: if a side effect throws (e.g. an engine rejecting the
      // equal-power freeze), the promise still settles and nothing stays
      // armed. The exception propagates out of the abort listener / timer
      // callback and is reported there.
      try {
        (aborted ? onAbort : onComplete)();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbortEvent);
        resolve();
      }
    };
    const onAbortEvent = (): void => finish(true);
    const timer = setTimeout(() => finish(false), clampDelay(durationMs));
    signal?.addEventListener("abort", onAbortEvent, { once: true });
  });
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
  // Voice ids whose play() Howler deferred (Web Audio: context not running,
  // queued behind once('resume'); HTML5: waiting on the media element). Such a
  // voice reads `_paused === true` until Howler starts it, but it was never
  // paused: replaying it from resume() would queue a SECOND start and orphan
  // the first buffer source. Each id leaves the set on its Howler `play` event.
  private readonly _pendingPlays = new Set<number>();

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
    if (this._disposed) throw new AudioDisposedError(SOUND_DISPOSED);
  }

  play(opts?: PlayOptions): number {
    this.ck();
    const looping = opts?.loop ?? false;
    const rate = opts?.rate ?? 1;
    // A non-finite rate reaches Web Audio's `playbackRate.setValueAtTime`,
    // which throws a raw TypeError AFTER Howler has started the voice — an
    // orphan the caller has no id for. Checked before anything starts.
    if (!Number.isFinite(rate)) {
      throw new AudioError("aiaudiojs: play rate must be a finite number");
    }
    // Always start a NEW voice. A bare Howl.play() resumes the single paused,
    // not-ended voice when exactly one exists, and the per-id setters below
    // would then clobber that voice's volume / rate / loop. Naming the
    // `__default` sprite (which Howler always defines; load() adds no sprites)
    // skips that branch and still plays the full buffer.
    const id = this.howl.play("__default");
    if ((this.howl as unknown as { _playLock?: boolean })._playLock === true) {
      // The queued voice either starts (`play`) or, under the HTML5 fallback,
      // is rejected (`playerror`, never followed by `play`). Either ends the
      // pending state; detach the twin listener so neither is left behind.
      this._pendingPlays.add(id);
      const settled = (): void => {
        this._pendingPlays.delete(id);
        this.howl.off("play", settled, id).off("playerror", settled, id);
      };
      this.howl.once("play", settled, id).once("playerror", settled, id);
    }
    // Per-id volume is a RELATIVE [0,1] value; the master is applied exactly
    // once via Howler's global gain (`Howler.volume`). Defaulting this to the
    // masterVolume would double-attenuate (Howler global × per-id default →
    // mv²) and make voices started before vs after a master change diverge in
    // loudness (AUD-B-02). Default is therefore 1, not masterVolume.
    this.howl.volume(opts?.volume ?? 1, id);
    this.howl.rate(rate, id);
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
          howl.off("playerror", onPlayError, id);
          this._abortCleanups.delete(cleanup);
        };

        // Howler per-id end/stop callbacks — natural sound termination. For a
        // LOOPING voice, Howler fires `end` at every loop boundary while
        // playback continues, so cleanup there would tear down the abort
        // wiring mid-playback (AUD-R-01); only a non-loop `end` terminates the
        // voice. `stop` always terminates, looping or not. Read the LIVE loop
        // flag (`howl.loop(id)`) rather than the `looping` value captured at
        // play() time: a loop flag flipped later via `nativeHowl` would
        // otherwise make this decision stale in either direction.
        const onEnd = (_id: number): void => {
          if (!howl.loop(id)) cleanup();
        };
        const onStop = (_id: number): void => cleanup();
        // HTML5 fallback: a rejected `node.play()` (e.g. autoplay policy)
        // emits only `playerror`, never `end`/`stop`, so without this the
        // abort wiring (and this Howl, via its closure) would be retained
        // indefinitely.
        const onPlayError = (_id: number): void => cleanup();

        onAbort = (): void => {
          howl.stop(id);
          cleanup();
        };

        signal.addEventListener("abort", onAbort, { once: true });
        howl.on("end", onEnd, id);
        howl.on("stop", onStop, id);
        howl.on("playerror", onPlayError, id);
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
    // Single pass over the voice pool so the ended-voice guard cannot drift
    // between the id-specific and no-arg paths (C9 / AUD-B-01). Howler marks
    // stopped / naturally-ended / never-played pooled voices `_paused === true`
    // AND `_ended === true`; replaying those restarts finished SFX from zero.
    // A voice whose play() is still pending is not paused either (see
    // `_pendingPlays`).
    let last = -1;
    for (const s of getSounds(this.howl)) {
      if (s._paused !== true || s._ended === true || s._id === undefined) continue;
      if (this._pendingPlays.has(s._id)) continue;
      if (id !== undefined) {
        if (s._id !== id) continue;
        this.howl.play(id);
        return id;
      }
      this.howl.play(s._id);
      last = s._id;
    }
    return last;
  }

  fade(from: number, to: number, ms: number, id?: number): Promise<void> {
    // The executor turns every throw — disposed, invalid arguments, or Howler
    // itself — into a rejection, so fade() never throws synchronously. The
    // checks run before howl.fade(): non-finite values would reach Web Audio
    // and throw after side effects, and Howler silently ignores volumes
    // outside [0, 1].
    return new Promise<void>((resolve) => {
      this.ck();
      if (!isNum(from, 1) || !isNum(to, 1)) {
        throw new AudioError("aiaudiojs: fade from/to must be finite numbers in [0, 1]");
      }
      if (!isNum(ms)) throw new AudioError("aiaudiojs: fade ms must be a finite number >= 0");
      const delay = clampDelay(ms);
      this.howl.fade(from, to, delay, id);
      // If dispose() runs mid-fade, the howl is unloaded but this still
      // resolves at `delay`, with no observable effect.
      setTimeout(resolve, delay);
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
    teardown: new Set(),
    masterVolume: clamp(opts?.volume ?? 1),
    disposed: false,
  };

  // Propagate initial volume to Howler global.
  Howler.volume(state.masterVolume);

  function ck(): void {
    if (state.disposed) throw new AudioDisposedError(AUDIO_DISPOSED);
  }

  // Wire up autoUnlock. Listen only on events the HTML spec treats as
  // "activation-triggering" (touchend, pointerup, keydown) — `touchstart` is
  // NOT one, so `ctx.resume()` from it is refused by the browser's autoplay
  // policy. Detach only once resume() actually leaves the context running:
  // an activation event whose resume() gets refused (or fails) keeps the
  // listeners attached so the next gesture can retry.
  if ((opts?.autoUnlock ?? true) && typeof document !== "undefined") {
    const unlockEvents = ["touchend", "pointerup", "keydown"];
    const detach = (): void => {
      for (const ev of unlockEvents) {
        document.removeEventListener(ev, handler);
      }
      state.teardown.delete(detach);
    };
    const handler = (): void => {
      const ctx = Howler.ctx;
      if (ctx == null) {
        detach();
        return;
      }
      ctx.resume().then(() => {
        if (ctx.state === "running") detach();
      }, noop);
    };
    for (const ev of unlockEvents) {
      document.addEventListener(ev, handler);
    }
    state.teardown.add(detach);
  }

  // Wire up resumeOnVisibility.
  if ((opts?.resumeOnVisibility ?? true) && typeof document !== "undefined") {
    const visHandler = (): void => {
      if (document.visibilityState === "visible") {
        Howler.ctx?.resume().catch(noop);
      }
    };
    document.addEventListener("visibilitychange", visHandler);
    state.teardown.add(() => document.removeEventListener("visibilitychange", visHandler));
  }

  async function unlock(): Promise<void> {
    ck();
    // Real Howler models "no AudioContext" (HTML5 fallback, SSR, jsdom) as
    // `null`, never `undefined`; `?.` covers both. Best-effort: a resume() that
    // throws synchronously resolves too, like one that rejects.
    try {
      await Howler.ctx?.resume();
    } catch {
      // Ignored: unlock() is a best-effort nudge; the next gesture retries.
    }
  }

  function load(url: string, signal?: AbortSignal): Promise<Sound> {
    // Throws inside the executor become rejections, so every failure below is
    // reported on the promise.
    return new Promise<Sound>((resolve, reject) => {
      ck();
      if (typeof url !== "string" || url.length === 0) {
        throw new AudioError("aiaudiojs: url must be a non-empty string");
      }
      if (signal?.aborted === true) throw new DOMException("Load aborted", "AbortError");
      // First of load / loaderror / abort / dispose to fire wins; the rest are
      // no-ops. `settle()` reports whether this call won: `cancel` is in
      // `state.teardown` exactly while the load is unsettled. It also detaches
      // every listener, so a late Howler `load` (decode finishing AFTER an
      // abort already rejected) never reaches us and cannot add a SoundImpl
      // nobody holds to `state.sounds` (REVIEW.md P2, 0.5.8).
      const settle = (): boolean => {
        if (!state.teardown.delete(cancel)) return false;
        signal?.removeEventListener("abort", onAbort);
        // This Howl is freshly built here and not yet exposed, so the only
        // listeners on it are the `onload` / `onloaderror` handlers below; a
        // bare off() clears every Howler event on it.
        howl.off();
        return true;
      };
      const fail = (err: Error): void => {
        if (!settle()) return;
        howl.unload();
        reject(err);
      };
      const onAbort = (): void => fail(new DOMException("Load aborted", "AbortError"));
      // dispose() / disposeAll() settle an in-flight load immediately instead
      // of waiting for Howler's decode (which may never finish).
      const cancel = (): void => fail(new AudioDisposedError(AUDIO_DISPOSED));
      const onload = (): void => {
        if (!settle()) return;
        const sound = new SoundImpl(howl, state);
        state.sounds.add(sound);
        resolve(sound);
      };
      const onloaderror = (_id: number, errMsg: unknown): void =>
        fail(new AudioError(`aiaudiojs: load failed: ${String(errMsg)}`));
      // The handlers MUST go in the constructor options, not a later once():
      // Howler can emit `load` / `loaderror` synchronously inside `new Howl()`
      // (buffer-cache hit, no codec / no extension, Howler.noAudio), and its
      // _emit only schedules listeners that already exist at emit time — a
      // once() attached after the constructor returns never fires and the
      // promise never settles. Howler invokes them via setTimeout, so `howl`
      // is assigned and `cancel` registered by the time they run.
      let howl: Howl;
      try {
        howl = new Howl({ src: [url], preload: true, onload, onloaderror });
      } catch (err) {
        // e.g. a malformed base64 data URI makes Howler's atob() throw.
        throw new AudioError(`aiaudiojs: load failed: ${String(err)}`);
      }
      state.teardown.add(cancel);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  // Schedule an equal-power ramp on one sound's gain and sync Howler's
  // source-of-truth `_volume` to the ramp's terminal value, so a later
  // `Howler.mute()` / re-`play()` re-derives the correct gain (not the
  // pre-crossfade value).
  function rampSound(
    s: HowlInternalSound,
    curve: Float32Array,
    terminal: number,
    now: number,
    dur: number,
  ): void {
    const g = s._node?.gain as AudioParam;
    g.cancelScheduledValues(now);
    g.setValueAtTime(curve[0] as number, now);
    // One linear ramp per remaining curve point: the same shape
    // setValueCurveAtTime renders (it interpolates linearly between points),
    // but without its exclusive [now, now + dur) window. The spec requires
    // NotSupportedError for ANY other automation call inside a curve, and
    // Howler's per-voice gain writes (volume / fade / mute, play(id)) are
    // setValueAtTime(v, now) — they would throw mid-crossfade.
    const last = curve.length - 1;
    for (let i = 1; i <= last; i++) {
      // `i / last` is exactly 1 for the final point, so it lands on now + dur.
      g.linearRampToValueAtTime(curve[i] as number, now + dur * (i / last));
    }
    s._volume = terminal;
  }

  function crossfade(from: Sound, to: Sound, cfOpts: CrossfadeOptions): Promise<void> {
    ck();
    // `?.`: a non-Sound (null / undefined) fails this check too, instead of
    // leaking a raw TypeError from the property read.
    if (from?.disposed !== false || to?.disposed !== false) {
      throw new AudioError("aiaudiojs: cannot crossfade a disposed Sound");
    }
    // Reject a missing options argument and non-finite durations as well as
    // <= 0: NaN would fire the resolve timer instantly (broken fade) and reach
    // the Web Audio ramps as a raw RangeError after `to` started; +Infinity
    // would hang the timer (AUD-S-02). This runs before any voice starts, so a
    // rejection never orphans one.
    const dur = cfOpts?.duration;
    if (!isNum(dur) || dur <= 0) {
      return Promise.reject(
        new AudioError("aiaudiojs: crossfade duration must be a finite number > 0"),
      );
    }
    const signal = cfOpts.signal;
    if (signal?.aborted === true) {
      return Promise.reject(new DOMException("Crossfade aborted", "AbortError"));
    }
    const equalPower = cfOpts.curve === "equal-power";
    const ctx = Howler.ctx;
    if (equalPower) {
      // `null` is Howler's "no AudioContext" value (see unlock()).
      if (ctx == null) throw new AudioError(HTML5_ACTIVE);
      // Web Audio mode, but the context is not running (no gesture yet, iOS
      // "interrupted", Howler's auto-suspend): Howler would defer `to`'s start
      // behind once('resume') and leave its voice `_paused`, so there is
      // nothing to ramp yet. Mirrors Howl.play()'s own gate; checked before
      // any voice is started, so nothing is queued or orphaned.
      const howlerState = (Howler as unknown as { state?: string }).state;
      if (howlerState !== "running" || (ctx.state as string) === "interrupted") {
        throw new AudioError(
          "aiaudiojs: equal-power crossfade requires a running AudioContext; call unlock() first",
        );
      }
    }
    // Capture the outgoing voices BEFORE `to` starts, so the completion stop
    // below never includes the new voice — which also makes crossfade(s, s)
    // work. A reshaped `_sounds` throws here, before anything has started.
    let outgoing = playing(from.nativeHowl);
    const toId = to.play({ volume: 0, loop: cfOpts.loop ?? false });
    const durationMs = dur * 1000;
    let onAbort = noop;
    if (equalPower) {
      // A voice is now live on `to`; any reach-in failure (HTML5 fallback OR a
      // reshaped `_sounds`) must stop it before throwing so no silent orphan
      // voice is left playing (AUD-B-03).
      let incoming: HowlInternalSound[];
      try {
        incoming = playing(to.nativeHowl).filter((s) => s._id === toId && hasGain(s));
        if (incoming.length === 0) throw new AudioError(HTML5_ACTIVE);
      } catch (err) {
        to.stop(toId);
        throw err;
      }
      outgoing = outgoing.filter(hasGain);
      // Both ramps are scheduled DIRECTLY on Howler's per-voice GainNode as
      // piecewise linear ramps (see rampSound); Howl.fade() is not used and no
      // extra GainNodes are inserted, so there is nothing to re-route. Per-voice
      // gain is RELATIVE [0,1]; the master is applied exactly once via Howler's
      // global gain (AUD-B-02), so the curves are NOT scaled by it (that would
      // attenuate the crossfade to mv²). Outgoing: 1 -> 0 along cos. Incoming:
      // 0 -> 1 along sin. sin^2 + cos^2 = 1 keeps perceived loudness flat.
      const now = ctx.currentTime;
      const { sin, cos } = ensureCurves();
      for (const s of outgoing) rampSound(s, cos, 0, now, dur);
      for (const s of incoming) rampSound(s, sin, 1, now, dur);
      const touched = [...outgoing, ...incoming];
      onAbort = () => {
        // Freeze each ramp at its current value (Web Audio requires
        // cancelScheduledValues THEN setValueAtTime, in that order) and sync
        // `_volume` to the frozen position so a later Howler.mute() / unmute()
        // re-derives the correct gain rather than the terminal.
        const t = ctx.currentTime;
        for (const s of touched) {
          const g = s._node?.gain as AudioParam;
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t);
          s._volume = g.value;
        }
      };
    } else {
      // Per-voice fade endpoints are RELATIVE [0,1] values (AUD-B-02).
      // Outgoing: every voice of `from`, 1 -> 0. Incoming: only the voice this
      // call started, 0 -> 1 — an id-less fade would also ramp up `to`'s other
      // voices (e.g. a voice a previous crossfade faded out). Aborting cannot
      // cancel Howler's fades, so the abort side effect stays a no-op.
      from.nativeHowl.fade(1, 0, durationMs);
      to.nativeHowl.fade(0, 1, durationMs, toId);
    }
    return resolveAfterWithAbort(durationMs, signal, onAbort, () => {
      // Normal completion: stop the ramped outgoing voices so a looping `from`
      // does not play on silently (and is not ramped back up by a later
      // ping-pong crossfade). After an abort the caller owns both voices.
      if (!from.disposed) for (const s of outgoing) from.nativeHowl.stop(s._id);
    });
  }

  function doDispose(): void {
    if (state.disposed) return;
    state.disposed = true;
    for (const sound of state.sounds) {
      sound.dispose();
    }
    state.sounds.clear();
    // Reject in-flight loads and detach the document listeners. A hook that
    // deletes itself while the Set is being iterated is safe.
    for (const hook of state.teardown) hook();
    state.teardown.clear();
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
