#!/usr/bin/env node
// Verify that every entry declared in package.json#exports has a real file in dist/.

import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

const failures = [];

for (const [subpath, conditions] of Object.entries(pkg.exports)) {
  for (const [condition, relPath] of Object.entries(conditions)) {
    const abs = resolve(root, relPath);
    try {
      await access(abs);
    } catch {
      failures.push(`${subpath} → ${condition} → ${relPath} (missing)`);
    }
  }
}

if (failures.length > 0) {
  console.error("verify-exports: missing files declared in package.json#exports:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`verify-exports: all ${Object.keys(pkg.exports).length} subpaths resolved.`);
