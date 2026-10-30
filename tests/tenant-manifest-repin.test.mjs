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
  assert.ok(source.includes('anchorMoves.set(file + "#L" + value, at);'));
  assert.ok(source.includes("const at = anchorMoves.get(file + \"#L\" + line);"));
});

test("separate proof-file citations resolve their own exact source lines", () => {
  const source = readFileSync("scripts/qa/tenant-manifest-repin.mjs", "utf8");
  assert.ok(source.includes('field.replace(/Line$/, "File")'),
    "every explicitly named *Line/*File pair must resolve the companion file");
  assert.ok(source.includes('typeof proof[companionFile] === "string"'),
    "the current citation must use its declared source file");
  assert.ok(source.includes('typeof cited?.[companionFile] === "string"'),
    "the base citation must use its own declared source file");

  // Real committed proof, not a mock: line 196 belongs to the shared
  // victim-snapshot runner, not the smaller self-photo proof module.
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const photo = manifest.allApiRouteFiles["src/app/api/self/photo/route.ts"]
    .methods.find((method) => method.name === "POST").testedBy;
  assert.equal(photo.victimUnchangedFile, "scripts/qa/tenant-dl02-closure-http.mjs");
  const primaryLines = readFileSync(photo.file, "utf8").split("\n");
  const companionLines = readFileSync(photo.victimUnchangedFile, "utf8").split("\n");
  assert.ok(photo.victimUnchangedLine > primaryLines.length,
    "the citation must not be resolved against the primary proof module");
  assert.match(companionLines[photo.victimUnchangedLine - 1], /victimSnapshot/,
    "the companion citation must point to the actual unchanged-victim assertion");
});
