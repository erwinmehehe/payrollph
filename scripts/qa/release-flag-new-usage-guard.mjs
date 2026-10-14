#!/usr/bin/env node
/**
 * A-7 guard: newly added direct process.env.*_ENABLED usages must have an
 * owner, risk and approval in the typed release-critical registry.
 *
 * A source-only diff check. It does not authorize activation of any flag and
 * does not claim to discover dynamically computed environment names.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function newUnregisteredFlagReads(diff, registrySource) {
  const registered = new Set(
    [...registrySource.matchAll(/\benv:\s*["']([A-Z][A-Z0-9_]*_ENABLED)["']/g)]
      .map((match) => match[1]),
  );
  const findings = [];
  const seen = new Set();
  let file = "";
  function record(flag) {
    if (registered.has(flag)) return;
    const key = file + ":" + flag;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, flag, reason: "New unregistered direct release-toggle read" });
  }
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (!file.startsWith("src/") || !line.startsWith("+") || line.startsWith("+++")) continue;
    const source = line.slice(1);
    for (const match of source.matchAll(/\bprocess\.env(?:\.([A-Z][A-Z0-9_]*_ENABLED)|\[\s*["']([A-Z][A-Z0-9_]*_ENABLED)["']\s*\])/g)) {
      record(match[1] ?? match[2]);
    }
    const destructure = source.match(/\b(?:const|let)\s*\{([^}]+)\}\s*=\s*process\.env\b/);
    if (destructure) {
      for (const match of destructure[1].matchAll(/\b([A-Z][A-Z0-9_]*_ENABLED)\b/g)) record(match[1]);
    }
  }
  return findings;
}

function run() {
  const base = process.env.BASE_SHA;
  if (!/^[0-9a-f]{40}$/.test(base ?? "")) {
    throw new Error("BASE_SHA must be an exact 40-character commit SHA; refusing incomplete diff.");
  }
  const diff = execFileSync(
    "git", ["diff", "--unified=0", base + "...HEAD", "--", "src"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  const registrySource = readFileSync("src/lib/critical-release-flags.ts", "utf8");
  const findings = newUnregisteredFlagReads(diff, registrySource);
  console.log(JSON.stringify({
    mode: "source-diff-only",
    baseSha: base,
    newlyUnregistered: findings.length,
    findings,
    productionActivationApproved: false,
  }, null, 2));
  if (findings.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) {
    console.error("Release-flag diff guard could not validate source:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  }
}
