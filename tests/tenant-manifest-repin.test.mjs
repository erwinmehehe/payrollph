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
  assert.ok(source.includes('field === "victimUnchangedAt"'),
    "renamed DL-02 victim-snapshot citations remain checked as real proof lines");
  assert.ok(source.includes('"victimUnchangedFile" : field === "line"'),
    "renamed DL-02 citations must use the actual shared companion proof file");
  assert.ok(source.includes('typeof proof[companionFile] === "string"'),
    "the current citation must use its declared source file");
  assert.ok(source.includes('typeof cited?.[companionFile] === "string"'),
    "the base citation must use its own declared source file");
  assert.ok(source.includes('typeof proof[companionFile] === "string" && cited?.file === proof.file'),
    "a base citation that omitted its companion file is compared in the declared companion, only for the same primary proof");

  // The effective-change POST cites two refusal anchors in its helper, not in its harness.
  const effectiveChange = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"))
    .allApiRouteFiles["src/app/api/hcm/effective-changes/route.ts"].methods.find(method => method.name === "POST").testedBy;
  for (const field of ["forgedSelectorFile", "secondaryForeignDenialFile"]) {
    assert.equal(effectiveChange[field], effectiveChange.helperFile, field + " must name the helper that holds the cited refusal");
  }

  // Three source-pinned compliance POST receipts live in dedicated
  // sourceRowFile modules; their four-part anchors are not shared-runner lines.
  assert.ok(source.includes('field.startsWith("sourceRow") && field.endsWith("Line") ? "sourceRowFile"'),
    "source-row own/victim/forged/unchanged anchors must all select sourceRowFile");
  assert.ok(source.includes('typeof proof.sourceRowFile !== "string"'),
    "missing source-row evidence files must fail closed, not use shared runner");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  for (const route of ["compliance/payroll-month-close", "compliance/statutory-remittances"]) {
    const proof = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]
      .methods.find(method => method.name === "POST").testedBy;
    assert.match(proof.sourceRowFile, /^scripts\/qa\/tenant-table-rows\/write\//);
    assert.notEqual(proof.file, proof.sourceRowFile);
    const rowLines = readFileSync(proof.sourceRowFile, "utf8").split("\n");
    const sharedLines = readFileSync(proof.file, "utf8").split("\n");
    for (const field of [
      "sourceRowOwnPositiveLine", "sourceRowForeignDenialLine",
      "sourceRowForgedSelectorLine", "sourceRowUnchangedDbLine",
    ]) {
      assert.ok(Number.isInteger(proof[field]) && proof[field] > sharedLines.length,
        route + " " + field + ": line must select its dedicated source row");
      assert.ok(rowLines[proof[field] - 1]?.trim(),
        route + " " + field + ": the source-row evidence must exist and be nonblank");
    }
  }

  // Real committed proof, not a mock: the whole DL-02 batch shares one
  // unchanged-victim snapshot citation in its large runner. Never resolve its
  // line number against a smaller per-route proof module or silently skip it.
  for (const [route, name] of [
    ["src/app/api/self/photo/route.ts", "POST"],
    ["src/app/api/web-bundy/evidence/route.ts", "GET"],
    ["src/app/api/workforce/demand-observations/import/route.ts", "POST"],
  ]) {
    const proof = manifest.allApiRouteFiles[route]
      .methods.find((method) => method.name === name).testedBy;
    assert.equal(proof.victimUnchangedFile, "scripts/qa/tenant-dl02-closure-http.mjs");
    const primaryLines = readFileSync(proof.file, "utf8").split("\n");
    const companionLines = readFileSync(proof.victimUnchangedFile, "utf8").split("\n");
    assert.ok(Number.isInteger(proof.victimUnchangedAt),
      "the DL-02 renamed proof citation must remain an actual line number: " + route);
    assert.ok(proof.victimUnchangedAt > primaryLines.length,
      "the citation must not be resolved against the primary proof module: " + route);
    assert.match(companionLines[proof.victimUnchangedAt - 1], /victimSnapshot/,
      "the companion citation must point to an actual unchanged-victim assertion: " + route);
  }
});

test("HCM refusal citations use the declared helper rather than the smaller HTTP harness", () => {
  const source = readFileSync("scripts/qa/tenant-manifest-repin.mjs", "utf8");
  assert.ok(source.includes('Object.values(proof.helperRefusalLines).includes(value)'));
  assert.ok(source.includes('missing dedicated helperFile'));
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const proof = manifest.allApiRouteFiles["src/app/api/hcm/effective-changes/route.ts"]
    .methods.find(method => method.name === "POST").testedBy;
  const helper = readFileSync(proof.helperFile, "utf8").split("\n");
  const harness = readFileSync(proof.file, "utf8").split("\n");
  for (const field of ["forgedSelectorLine", "secondaryForeignDenialLine"]) {
    assert.ok(Object.values(proof.helperRefusalLines).includes(proof[field]));
    assert.ok(proof[field] > harness.length);
    assert.match(helper[proof[field] - 1], /victim/);
  }
});

test("staffing approved integrity citation is checked in the actual approved-mode proof", () => {
  const source = readFileSync("scripts/qa/tenant-manifest-repin.mjs", "utf8");
  assert.ok(source.includes('field === "approvalIntegrityLine" && typeof proof.approvalPositiveFile === "string"'));
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const proof = manifest.allApiRouteFiles["src/app/api/workforce/demand-staffing/policies/route.ts"]
    .methods.find(method => method.name === "GET").testedBy;
  const approved = readFileSync(proof.approvalPositiveFile, "utf8").split("\n");
  assert.match(approved[proof.approvalIntegrityLine - 1], /approvalIntegrity, "matches_hash"/);
});
