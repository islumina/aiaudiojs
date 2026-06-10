# Stability

This document describes the stability guarantees for each feature in `aiaudiojs`.
Stability levels follow the [Node.js stability index](https://nodejs.org/api/documentation.html#stability-index) convention
adapted for a micro-runtime library:

- **stable** — the API is production-ready. Breaking changes require a major version bump.
- **experimental** — the API is usable but may change in a minor version. Feedback welcome.

---

## Feature stability table

| Feature | Stability | Notes |
| ------- | --------- | ----- |
| `crossfade(curve: 'linear')` | stable | Shipped in 0.1.0. Default behaviour; backward-compatible. Delegates to `Howl.fade()`. Frozen on the 1.0 track (declared 0.4.0). |
| `crossfade(curve: 'equal-power')` | stable | Shipped in 0.3.0. Requires Howler in Web Audio mode (`_sounds[i]._node` defined). HTML5 fallback mode throws `AudioError`; callers may downgrade to `'linear'`. Frozen on the 1.0 track (declared 0.4.0). |
| `Sound.resume(id?)` | experimental | Shipped in 0.5.6. With an `id`, resumes that voice; without one, resumes every genuinely-paused voice (`_paused === true && _ended !== true`) and returns the last resumed id, or `-1` if none. Reaches into Howler's private `_sounds` to enumerate paused voices, so it is **not** frozen on the 1.0 track until that reach-in is validated against the supported Howler range; the signature may still adjust. Throws `AudioDisposedError` after `dispose()`. |
| Spatial audio (PannerNode / HRTF) | experimental | Planned for v0.7 — roguelite room-direction audio. Not implemented in this cycle. API surface not yet defined. |

---

## 1.0-track freeze (declared 0.4.0)

The 0.3.x public surface — the `createAudio` factory; `load`, `play` / `pause` / `stop` /
`fade`, both `crossfade` curves, `dispose` / `disposeAll`, `nativeHowl`; the `AudioError` /
`AudioDisposedError` classes; and the exported type / interface shapes (`AudioOptions`,
`PlayOptions`, `CrossfadeCurve`, `CrossfadeOptions`, `Sound`, `Audio`) — is **frozen on
the 1.0 track**. It will not change shape (no
signature, error-name, or default-behaviour changes) before 1.0, and once 1.0 ships it
is frozen for the entire 1.x line. The 0.4.0 dependency-reduction release adds no runtime
API; it only confirms this freeze and the family dependency hygiene.

`howler` remains a required `peerDependency` — see the 0.4.0 CHANGELOG and the README
["Why aiaudiojs"](README.md#why-aiaudiojs) section for the dependency decision.
