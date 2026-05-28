# Contributing to aiaudiojs

Thanks for taking the time to look. aiaudiojs is a deliberately thin shell
over Howler.js (target ≤ 2 KB gzip for the shell, with Howler ~9.7 KB
external); contributions that keep the surface narrow are easier to accept
than ones that expand it.

## Quick start

```bash
pnpm install
pnpm test            # vitest
pnpm coverage        # vitest with v0.1.0 thresholds (95/90/100/100)
pnpm typecheck       # tsc --noEmit on strict mode
pnpm lint            # biome check
pnpm build           # tsup; dual ESM/CJS + .d.ts (howler is external)
pnpm verify:exports  # ensures package.json#exports matches dist/
pnpm verify:llms     # ensures llms-full.txt is in sync with README + CHANGELOG
pnpm check:size      # gzip per subpath against the size budget
```

## What gets in easily

- Bug fixes with a failing test added first
- README / typing corrections
- Tests that lock down existing behaviour
- Tightening iOS Safari unlock heuristics that we can verify on real device

## What needs discussion first

- Anything that changes the public surface (`createAudio`, `Audio`, `Sound`,
  error classes)
- Anything that bundles Howler.js into the dist (must stay external)
- Anything that adds a second runtime peer (we have one — Howler — and one
  is enough)
- 3D spatial / sprite generator / audio worklet host (explicit non-goals;
  use Howler directly or `audiosprite` CLI)
- Anything that pushes the shell gzip past 2 KB

## Design principles

aiaudiojs follows the ai*js library-core priority order:

> Security > Correctness > Simplicity > YAGNI > Performance

Key invariants:

- `dispose()` is idempotent at both the Audio and Sound levels.
- Every long-running operation accepts an `AbortSignal`; aborting cancels
  in-flight work and rejects pending promises with the standard `AbortError`.
- `crossfade()` ramps run on the AudioContext timeline
  (`linearRampToValueAtTime`), never via `setInterval` polling.
- The shell never bundles Howler; it must always resolve through the user's
  `peerDependency`.
- Escape hatch `getNativeHowl()` (or `.nativeHowl`) exists so users never
  feel trapped by the narrow surface.

## Commit & PR style

- Commit messages: imperative subject under 70 chars; body explains *why*.
- PRs: keep scope to one topic. Link the issue if any.
- Tests required for any behaviour change. iOS Safari behaviour must be
  noted in the PR even if no automated test exists (real-device check).

## Reporting issues

- Minimal reproduction welcome (paste the smallest `createAudio` + load +
  play sequence that shows the bug).
- For iOS-specific bugs, please include OS version, browser version, and
  whether the bug also reproduces against Howler directly — if it does,
  the bug belongs upstream and we can't fix it here.
- For security issues, please email the maintainer rather than filing
  publicly.

## License

By contributing, you agree your changes will be licensed under the MIT
license that covers this project.
