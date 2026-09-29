#!/usr/bin/env node
// Verify gzip-compressed bundle size per subpath stays under budget.
// Howler.js is `external` in tsup.config.ts so it is NOT included here.

import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const budgets = {
  // 0.1.0 shell budget: ≤ 2 KB gzip — held through 0.3.0. The equal-power
  // crossfade path schedules sin/cos curves directly on Howler's existing
  // per-sound GainNode (`_node.gain`) rather than inserting overlay GainNodes,
  // so it fits inside the original budget. Howler.js (~9.7 KB gzip) stays as
  // the user's peerDependency and is NOT counted here (`external: ["howler"]`
  // in tsup.config.ts).
  //
  // 0.5.0: bumped 2000 → 2100 B. The play() AbortSignal listener-leak fix
  // adds a cleanup closure + two Howler per-id event-listener pairs (end/stop),
  // which are real runtime code. The shell remains well under 3 KB gzip.
  //
  // `Sound.resume(id?)` (next release): bumped 2100 → 2200 B. The new public
  // mutator adds a single-id fast path plus a paused-voice enumeration over
  // `_sounds` — real runtime code. The shell stays well under 3 KB gzip.
  //
  // C9 fix (0.5.9 wave): bumped 2200 → 2210 B. The id-path now shares the
  // ended-voice guard with the no-arg path via a single-loop restructure
  // (prevents drift). The guard adds one `_id !== id` continue check per loop
  // iteration plus an early-return arm — irreducible runtime logic.
  //
  // 2026-09-28 review pass: bumped 2210 → 2500 B (maintainer-approved, one-off).
  // Measured 2470 B. Largest single cost is the equal-power ramp rewrite
  // (setValueCurveAtTime → piecewise linearRampToValueAtTime), which stops
  // Howler's own per-voice gain writes from throwing NotSupportedError mid
  // crossfade. The rest is seven P1/P2 fixes (synchronous load/loaderror
  // settle, null Howler.ctx, disposeAll vs in-flight load, crossfade abort
  // settle, suspended-context reporting, play() always a new voice, queued-
  // play resume guard) and two P3s (live loop flag + playerror teardown,
  // activation-event autoUnlock retry). Not a precedent for routine bumps.
  //
  // 0.6.0 minor: bumped 2500 → 2600 B (maintainer-approved for the 0.6.0
  // minor; the measured closure plus about 25 B of headroom).
  // Measured 2576 B after trimming (shared disposed / HTML5 message
  // constants, one teardown Set replacing four State fields and their
  // dispose-time gates, async unlock(), load() validation inside the promise
  // executor, the linear and equal-power crossfade paths merged into one
  // flow). The 0.6.0 contracts that consumed bytes:
  //   - Sound.fade validation (from/to finite in [0, 1], ms finite >= 0,
  //     rejection-only failure channel);
  //   - crossfade completion-stop of the outgoing voices (by the ids captured
  //     at entry), the id-scoped linear incoming fade, and CrossfadeOptions.loop;
  //   - clampDelay (one 2^31-1 ms clamp for every setTimeout delay);
  //   - dispose() settling in-flight load() calls immediately;
  //   - play() rate validation, the queued-play `playerror` twin listener,
  //     and the `aiaudiojs: ` prefix on every AudioError message.
  "dist/index.js": 2_600,
};

const failures = [];
for (const [rel, max] of Object.entries(budgets)) {
  const abs = resolve(root, rel);
  let buf;
  try {
    buf = await readFile(abs);
  } catch {
    failures.push(`${rel}: missing (did you run pnpm build?)`);
    continue;
  }
  const gz = gzipSync(buf).length;
  const pct = ((gz / max) * 100).toFixed(0);
  const tag = gz > max ? "FAIL" : "ok  ";
  console.log(`[${tag}] ${rel.padEnd(28)} gz ${String(gz).padStart(5)} B / ${max} B (${pct}%)`);
  if (gz > max) failures.push(`${rel}: ${gz} B > ${max} B budget`);
}

if (failures.length > 0) {
  console.error("\ncheck-size: bundle budget exceeded:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\ncheck-size: all ${Object.keys(budgets).length} entries within budget.`);
