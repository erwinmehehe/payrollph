#!/usr/bin/env node
/**
 * A-7 guard: newly added literal process.env.*_ENABLED reads must have an
 * accountable owner, risk and approval in the typed critical-release registry.
 *
 * Only source diffs are inspected; this never activates a feature. This is a
 * static control for direct literal reads, not a proof that every indirect or
 * dynamically constructed environment-key lookup has been audited.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Reject malformed, incomplete or spoofed registry text rather than trusting
 * any stray env string to represent a reviewed flag. */
export function registeredReleaseFlagNames(registrySource) {
  const marker = /\bexport\s+const\s+CRITICAL_RELEASE_FLAGS\s*=\s*\{/;
  const start = marker.exec(registrySource);
  if (!start) throw new Error("A7_REGISTRY_DECLARATION_MISSING");
  const bodyStart = start.index + start[0].length;
  const bodyEnd = registrySource.indexOf("} as const", bodyStart);
  if (bodyEnd < 0) throw new Error("A7_REGISTRY_END_MISSING");
  const body = registrySource.slice(bodyStart, bodyEnd);
  const entries = [...body.matchAll(/^[ \t]{2}([A-Za-z_$][\w$]*)\s*:\s*\{([\s\S]*?)^[ \t]{2}\},?[ \t]*$/gm)];
  if (!entries.length) throw new Error("A7_REGISTRY_ENTRIES_MISSING");
  if ([...body.matchAll(/\benv\s*:/g)].length !== entries.length) {
    throw new Error("A7_REGISTRY_UNPARSED_ENV_FIELD");
  }
  const field = (source, name) => {
    const match = new RegExp("\\b" + name + "\\s*:\\s*(?:\"([^\"\\n]+)\"|'([^'\\n]+)')").exec(source);
    return (match?.[1] ?? match?.[2] ?? "").trim();
  };
  const registered = new Set();
  for (const entry of entries) {
    const entryName = entry[1];
    const content = entry[2];
    const env = field(content, "env");
    if (!/^[A-Z][A-Z0-9_]*$/.test(env) ||
        !field(content, "owner") || !field(content, "risk") || !field(content, "approval")) {
      throw new Error("A7_REGISTRY_INCOMPLETE_ENTRY:" + entryName);
    }
    if (registered.has(env)) throw new Error("A7_REGISTRY_DUPLICATE_ENV:" + env);
    registered.add(env);
  }
  return registered;
}

/** A zero-context Git diff may wrap one new expression over several added lines.
 * Assemble consecutive added lines per hunk, never joining removed/context text
 * or another file into a fabricated expression. */
export function newUnregisteredFlagReads(diff, registrySource) {
  const registered = registeredReleaseFlagNames(registrySource);
  const findings = [];
  const seen = new Set();
  let file = "";
  let added = [];

  function record(flag) {
    if (registered.has(flag)) return;
    const key = file + ":" + flag;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, flag, reason: "New unregistered direct release-toggle read" });
  }
  function inspectAddedLines() {
    if (!file.startsWith("src/") || !added.length) { added = []; return; }
    const source = added.join("\n");
    // Direct dotted, optional-chained and quoted/template-literal bracket keys.
    for (const match of source.matchAll(/\bprocess\s*(?:\?\.|\.)\s*env\s*(?:(?:\?\.|\.)\s*([A-Z][A-Z0-9_]*_ENABLED)\b|(?:\?\.)?\s*\[\s*(["'\x60])([A-Z][A-Z0-9_]*_ENABLED)\2\s*\])/g)) {
      record(match[1] ?? match[3]);
    }
    // Direct destructuring is also a process.env read; tolerate line breaks.
    for (const destructure of source.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*process\s*(?:\?\.|\.)\s*env\b/g)) {
      for (const match of destructure[1].matchAll(/\b([A-Z][A-Z0-9_]*_ENABLED)\b/g)) record(match[1]);
    }
    added = [];
  }

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      inspectAddedLines();
      file = line.slice(6);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1));
    } else {
      inspectAddedLines();
    }
  }
  inspectAddedLines();
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
    mode: "literal-source-diff-only",
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
