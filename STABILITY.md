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
| `crossfade(curve: 'linear')` | stable | Shipped in 0.1.0. Default behaviour; backward-compatible. Delegates to `Howl.fade()`. |
| `crossfade(curve: 'equal-power')` | stable | Shipped in 0.3.0. Requires Howler in Web Audio mode (`_sounds[i]._node` defined). HTML5 fallback mode throws `AudioError`; callers may downgrade to `'linear'`. |
| Spatial audio (PannerNode / HRTF) | experimental | Planned for v0.7 — roguelite room-direction audio. Not implemented in this cycle. API surface not yet defined. |
