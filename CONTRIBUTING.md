# Contributing to aiaudiojs

Keep changes small, typed, and aligned with the ai*js lifecycle conventions.

## Local workflow

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm verify:docs
pnpm build:llms
pnpm verify:llms
pnpm check:size
```

Run `pnpm lint` before PRs. If docs change, regenerate `llms-full.txt`.

## Rules

- Do not hide Howler behavior. Document browser/audio constraints plainly.
- Preserve destructurable methods and idempotent disposal.
- Prefer `AbortSignal` for cancellation and named errors for misuse.
- Keep README examples short and runnable.
- Discuss API or peer dependency changes before implementation.

## License

MIT
