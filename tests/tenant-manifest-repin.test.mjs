import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const base = process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main";
const baseReadable = (() => {
  try { execFileSync("git", ["cat-file", "-e", base + ":scripts/qa/tenant-isolation-coverage-manifest.json"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

test("every cited proof line still points at the same text as on the base (run npm run tenant:repin if not)", {
  skip: !baseReadable && "base manifest not available locally",
}, () => {
  const result = spawnSync(process.execPath, ["scripts/qa/tenant-manifest-repin.mjs", "--base", base], { encoding: "utf8" });
  const report = JSON.parse(result.stdout.slice(0, result.stdout.indexOf("}") + 1));
  assert.equal(report.needsReview, 0,
    "edited or ambiguous proof lines need a human:\n" + result.stdout.split("\n").filter((l) => l.startsWith("REVIEW")).join("\n"));
  assert.equal(report.repinned, 0,
    "proof lines shifted; run `npm run tenant:repin` and commit the manifest:\n" + result.stdout.split("\n").filter((l) => l.startsWith("repin")).join("\n"));
});

test("the repin tool only moves line numbers, never statuses, SHAs or route-source citations", () => {
  const source = readFileSync("scripts/qa/tenant-manifest-repin.mjs", "utf8");
  assert.ok(source.includes('const ROUTE_SOURCE_FIELDS = new Set(["currentMembershipGuardLine"])'));
  assert.ok(!/\.status\s*=|gitBlobSha\s*=|testedBy\s*=/.test(source), "no status, SHA or proof assignment");
  assert.ok(source.includes("proof[field] = at;"), "the only write is a relocated line number");
  assert.ok(source.includes("exact.length === 1 ? exact[0] : undefined"), "ambiguous moves are reported, never guessed");
  // Compare against the base manifest's own citation (base line number in the base file); a credit
  // that did not exist on the base is new, not shifted, and is validated by the inventory guard.
  assert.ok(source.includes("const text = before[baseValue - 1];"), "base text is read at the base citation, not the current one");
  assert.ok(source.includes("if (!before || !Number.isInteger(baseValue)) { newCitations += 1; continue; }"));
  // Moved citations move their overview links too, in one pass (chained moves cannot double-shift).
  assert.ok(source.includes('anchorMoves.set(proof.file + "#L" + value, at);'));
  assert.ok(source.includes("const at = anchorMoves.get(file + \"#L\" + line);"));
});
