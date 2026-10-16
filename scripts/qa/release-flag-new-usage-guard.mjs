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

/** Ignore comments without erasing // or /* text inside quoted metadata. */
function stripRegistryComments(source) {
  let result = "";
  let mode = "code";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === "line" || mode === "block") {
      if (mode === "line" && ch === "\n") {
        mode = "code";
        result += ch;
      } else if (mode === "block" && ch === "*" && next === "/") {
        result += "  ";
        i++;
        mode = "code";
      } else {
        result += ch === "\n" ? "\n" : " ";
      }
    } else if (mode === "code") {
      if (ch === "/" && next === "/") {
        mode = "line";
        result += "  ";
        i++;
      } else if (ch === "/" && next === "*") {
        mode = "block";
        result += "  ";
        i++;
      } else {
        result += ch;
        if (ch === "'" || ch === '"' || ch.charCodeAt(0) === 96) mode = ch;
      }
    } else {
      result += ch;
      if (ch === "\\" && next !== undefined) {
        result += next;
        i++;
      } else if (ch === mode) {
        mode = "code";
      }
    }
  }
  if (mode === "block") throw new Error("A7_REGISTRY_UNTERMINATED_COMMENT");
  return result;
}

/** Reject malformed, incomplete or spoofed registry text rather than trusting
 * any stray env string to represent a reviewed flag. */
export function registeredReleaseFlagNames(registrySource) {
  const source = stripRegistryComments(registrySource);
  const marker = /\bexport\s+const\s+CRITICAL_RELEASE_FLAGS\s*=\s*\{/;
  const start = marker.exec(source);
  if (!start) throw new Error("A7_REGISTRY_DECLARATION_MISSING");
  const bodyStart = start.index + start[0].length;
  const bodyEnd = source.indexOf("} as const", bodyStart);
  if (bodyEnd < 0) throw new Error("A7_REGISTRY_END_MISSING");
  const body = source.slice(bodyStart, bodyEnd);
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

/** Inspect both sides of each diff hunk. New syntax can combine an unchanged
 * process.env prefix with a newly added flag, so '+'-only matching is unsafe.
 * A flag is new when a complete direct read appears more times after the hunk
 * than before it; unchanged legacy reads in surrounding context do not fail. */
export function newUnregisteredFlagReads(diff, registrySource) {
  const registered = registeredReleaseFlagNames(registrySource);
  const findings = [];
  const seen = new Set();
  let file = "";
  let before = [];
  let after = [];

  function record(flag) {
    if (registered.has(flag)) return;
    const key = file + ":" + flag;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, flag, reason: "New unregistered direct release-toggle read" });
  }
  function flagReadCounts(lines) {
    const source = lines.join("\n");
    const counts = new Map();
    const add = (flag) => counts.set(flag, (counts.get(flag) ?? 0) + 1);
    for (const match of source.matchAll(/\bprocess\s*(?:\?\.|\.)\s*env\s*(?:(?:\?\.|\.)\s*([A-Z][A-Z0-9_]*_ENABLED)\b|(?:\?\.)?\s*\[\s*(["'\x60])([A-Z][A-Z0-9_]*_ENABLED)\2\s*\])/g)) {
      add(match[1] ?? match[3]);
    }
    for (const destructure of source.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*process\s*(?:\?\.|\.)\s*env\b/g)) {
      for (const match of destructure[1].matchAll(/\b([A-Z][A-Z0-9_]*_ENABLED)\b/g)) add(match[1]);
    }
    return counts;
  }
  function finishHunk() {
    if (file.startsWith("src/") && after.length) {
      const oldCounts = flagReadCounts(before);
      const newCounts = flagReadCounts(after);
      for (const [flag, count] of newCounts) {
        if (count > (oldCounts.get(flag) ?? 0)) record(flag);
      }
    }
    before = [];
    after = [];
  }

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      finishHunk();
      file = "";
    } else if (line.startsWith("+++ b/")) {
      finishHunk();
      file = line.slice(6);
    } else if (line.startsWith("@@ ")) {
      finishHunk();
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      before.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    } else {
      finishHunk();
    }
  }
  finishHunk();
  return findings;
}

function run() {
  const base = process.env.BASE_SHA;
  if (!/^[0-9a-f]{40}$/.test(base ?? "")) {
    throw new Error("BASE_SHA must be an exact 40-character commit SHA; refusing incomplete diff.");
  }
  const diff = execFileSync(
    "git", ["diff", "--unified=8", base + "...HEAD", "--", "src"],
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
