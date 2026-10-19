import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

type Hit = { file: string; line: number; rule: string; source: string };

/**
 * Scan every client component and page for definite unchecked success reads.
 * Compare against the exact repository base, not a growing exception list:
 * pre-existing debt remains visible, while any added unsafe match makes CI red.
 * A reduction in baseline debt never needs an allowlist edit.
 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(absolute);
    return /\.(?:tsx|jsx|ts|js)$/.test(entry.name) ? [absolute] : [];
  });
}

export function scanClient(file: string, source: string): Hit[] {
  if (!/^["']use client["'];?/m.test(source) || !/\bfetch\s*\(/.test(source)) return [];
  const hasSuccessState = /\.length\s*===?\s*0|No\s+[^\n]*|\bcount\b|\breadiness\b|\bstatus\b/i.test(source);
  if (!hasSuccessState) return [];
  const lines = source.split("\n");
  const hits: Hit[] = [];
  lines.forEach((line, index) => {
    // An array derived directly from a JSON payload cannot certify an empty result.
    if (/\bset[A-Z]\w*\s*\(\s*(?:payload|body|data|result)\.(?:entries|records|claims|submissions|alerts|cases)\s*(?:\?\?|\|\|)\s*\[\s*\]/.test(line) ||
        /\bsetFetched\s*\(.*\bpayload\.entries\s*(?:\?\?|\|\|)\s*\[\s*\]/.test(line)) {
      hits.push({ file, line: index + 1, rule: "fetched-array-fallback", source: line.trim() });
    }
    // Only treat direct assignment from a JSON fallback as unsafe when there is
    // no intervening shape-validation gate before that assignment.
    if (/\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)/.test(line)) {
      const next = lines.slice(index + 1, index + 12);
      const success = next.findIndex((text) => /\bset(?:Result|Payload|Report|Batches|Rows|Records|Cases)\s*\(\s*(?:payload|body|data|result)\s+as\s+\w+/.test(text));
      if (success >= 0 && !next.slice(0, success).some((text) =>
        /\bis[A-Z]\w*Payload\s*\(|\bisValid\w*\s*\(|\bArray\.isArray\s*\(|\bhasConsistent\w*\s*\(/.test(text))) {
        hits.push({ file, line: index + 2 + success, rule: "unchecked-success-cast", source: next[success].trim() });
      }
    }
  });
  return hits;
}

test("regression examples: new silent empty reads fail and verified empty is permitted", () => {
  const prefix = '"use client";\nconst run=()=>fetch("/api/x");\nconst empty = () => entries.length === 0;';
  assert.equal(scanClient("example.tsx", prefix + "\nsetRows(payload.claims ?? []);").length, 1);
  assert.equal(scanClient("example.tsx", prefix +
    "\nconst body = await response.json().catch(() => ({}));\nsetReport(body as Report);").length, 1);
  assert.equal(scanClient("example.tsx", prefix +
    "\nconst body = await response.json().catch(() => ({}));\nif (!isValidReportPayload(body)) throw Error();\nsetReport(body as Report);").length, 0);
  assert.equal(scanClient("example.tsx", prefix + "\nsetRows(verified.rows);").length, 0);
});

/**
 * A fingerprint includes file, rule and literal line. Compare counts too so
 * duplicating an existing unsafe fallback cannot slip through the baseline.
 */
export function newReadRegressions(prior: Hit[], current: Hit[]): Hit[] {
  const fingerprint = (hit: Hit) => [hit.file, hit.rule, hit.source].join("\\u0000");
  const remaining = new Map<string, number>();
  for (const hit of prior) {
    const key = fingerprint(hit);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return current.filter((hit) => {
    const key = fingerprint(hit);
    const count = remaining.get(key) ?? 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

test("baseline drift detects new, changed or duplicated unsafe reads", () => {
  const prefix = '"use client";\\nconst run=()=>fetch("/api/x");\\nconst empty = () => entries.length === 0;';
  const old = scanClient("legacy.tsx", prefix + "\\nsetRows(payload.claims ?? []);");
  const same = scanClient("legacy.tsx", prefix + "\\nsetRows(payload.claims ?? []);");
  const expanded = scanClient("legacy.tsx", prefix + "\\nsetRows(payload.claims ?? []);\\nsetRows(payload.claims ?? []);");
  const altered = scanClient("legacy.tsx", prefix + "\\nsetRows(payload.entries ?? []);");
  assert.equal(newReadRegressions(old, same).length, 0);
  assert.equal(newReadRegressions(old, expanded).length, 1);
  assert.equal(newReadRegressions(old, altered).length, 1);
  assert.equal(newReadRegressions([], old).length, 1);
});

test("all client components/pages reject new unchecked read-to-success patterns against repository base", () => {
  // GitHub Actions explicitly fetches the exact PR base SHA (or pre-push SHA).
  // Local full clones can use HEAD^; a missing git ref MUST fail, not skip.
  const baseRef = process.env.FAIL_CLOSED_GUARD_BASE_REF?.trim() || "HEAD^";
  assert.match(baseRef, /^(?:[a-f0-9]{40}|HEAD\\^)$/, "Invalid comparison base ref");
  const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", baseRef, "src/components", "src/app"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\\n");
  const baselineFiles = new Set(tracked);
  const files = [...filesUnder("src/components"), ...filesUnder("src/app")];
  const current: Hit[] = [];
  const prior: Hit[] = [];
  for (const absolute of files) {
    const file = relative(".", absolute).replaceAll("\\\\", "/");
    current.push(...scanClient(file, readFileSync(absolute, "utf8")));
    if (baselineFiles.has(file)) {
      const oldSource = execFileSync("git", ["show", baseRef + ":" + file],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      prior.push(...scanClient(file, oldSource));
    }
  }
  const introduced = newReadRegressions(prior, current);
  assert.equal(introduced.length, 0,
    "New fetched-payload-to-success regressions (legacy debt is NOT marked verified):\\n" +
    introduced.map((hit) => hit.file + ":" + hit.line + " [" + hit.rule + "] " + hit.source).join("\\n"));
  // Explicit output keeps inherited unsafe reads visible in otherwise green CI.
  console.warn("Fail-closed client-read guard: " + current.length +
    " detected patterns, " + introduced.length + " newly introduced; " +
    (current.length - introduced.length) + " inherited/unresolved or unchanged. Base: " + baseRef);
});
