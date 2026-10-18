import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

type Hit = { file: string; line: number; rule: string; source: string };
type Allow = { file: string; source: string; reason: string };

/**
 * Only definite client-side read-to-empty regressions. A normal optional UI
 * array is NOT flagged unless a local fetch exists and the same component
 * renders an empty/count state. Keep legacy unresolved findings visible
 * rather than manufacturing CI green as proof of the entire sweep.
 */
const allowlist: Allow[] = [
  { file: "src/components/workspace/filing-evidence.tsx", source: "setRecords(payload.records ?? [])",
    reason: "Existing HIGH: filing evidence contract/action state still needs a separately reviewed fix." },
  { file: "src/components/workspace/offline-punch-review.tsx", source: "setRows(payload.claims ?? [])",
    reason: "Existing HIGH: offline claim queue needs complete tenant and source verification." },
  { file: "src/components/workspace/punch-evidence-review-panel.tsx", source: "setRows(body.submissions??[])",
    reason: "Existing HIGH: enhanced punch review approval queue awaits its source contract fix." },
  { file: "src/components/workspace/payroll-run.tsx", source: "setFetched({ runId, entries: payload.entries ?? [] })",
    reason: "Existing HIGH on main: isolated payroll PR #1257 validates the register; merge-order must remove this allowance." },
];

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

test("no unallowlisted fetched-payload-to-success fallbacks in client components/pages", () => {
  const files = [...filesUnder("src/components"), ...filesUnder("src/app")];
  const hits = files.flatMap((absolute) => {
    const file = relative(".", absolute).replaceAll("\\", "/");
    return scanClient(file, readFileSync(absolute, "utf8"));
  });
  const unapproved = hits.filter((hit) => !allowlist.some(
    (allow) => hit.file === allow.file && hit.source.includes(allow.source),
  ));
  assert.equal(unapproved.length, 0,
    "Unsafe reads require a reviewed contract fix or a one-line documented waiver:\n" +
    unapproved.map((hit) => `${hit.file}:${hit.line} [${hit.rule}] ${hit.source}`).join("\n"));
  // Guard against allowlist entries for removed patterns lingering forever.
  for (const allow of allowlist) {
    assert.ok(allow.reason.length > 24);
    assert.ok(hits.some((hit) => hit.file === allow.file && hit.source.includes(allow.source)),
      `Remove stale allowlist entry for ${allow.file}: ${allow.source}`);
  }
});
