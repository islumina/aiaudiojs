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
  "dist/index.js": 2_100,
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
