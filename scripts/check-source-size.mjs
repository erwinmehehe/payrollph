#!/usr/bin/env node
/* File-size regression guard. This does not replace splitting the existing
 * oversized financial/schema/compatibility modules after golden tests.
 * New oversized modules are blocked until independently reviewed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const MAX_LINES = 2500;
const LEGACY_EXCEPTIONS = new Set([
  "src/db/schema.ts",
  "src/lib/payroll-engine.ts",
  "src/lib/core-schema-compat.ts",
]);

function allSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return allSourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(item.name) ? [path] : [];
  });
}

const oversized = [];
for (const file of allSourceFiles(ROOT)) {
  const normalPath = file.replaceAll("\\", "/");
  const count = readFileSync(file, "utf8").split("\n").length;
  if (count > MAX_LINES && !LEGACY_EXCEPTIONS.has(normalPath)) {
    oversized.push({ file: normalPath, count });
  }
}
if (oversized.length > 0) {
  console.error(`Source size policy (max ${MAX_LINES} lines) failed:`);
  for (const violation of oversized) {
    console.error(`  ${violation.file}: ${violation.count} lines`);
  }
  process.exitCode = 1;
} else {
  console.log(`Source size policy passed; historical oversized modules remain tracked for safe decomposition.`);
}
