import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const tool = resolve("scripts/qa/tenant-manifest-repin.mjs");
const manifestFile = "scripts/qa/tenant-isolation-coverage-manifest.json";
const approvalFile = "scripts/qa/approved.mjs";
const route = "src/app/api/workforce/demand-staffing/policies/route.ts";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "tenant-repin-approval-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const dir of ["scripts/qa", "docs/engineering"]) mkdirSync(join(cwd, dir), { recursive: true });
  const proof = {
    file: "scripts/qa/manage.mjs", line: 1,
    approvalPositiveFile: approvalFile, approvalPositiveLine: 6, approvalIntegrityLine: 7,
    proofBlobSha: "unchanged-proof-pin",
  };
  const manifest = { metrics: { coveredAfter: 1 }, allApiRouteFiles: {
    [route]: { methods: [{ name: "GET", status: "COVERED", testedBy: proof }] },
  } };
  const approval = "one\ntwo\nthree\nfour\nfive\nown approved response\nreceipt integrity assertion\n";
  writeFileSync(join(cwd, proof.file), "manage positive\nmanage denial\n");
  writeFileSync(join(cwd, approvalFile), approval);
  writeFileSync(join(cwd, manifestFile), JSON.stringify(manifest));
  writeFileSync(join(cwd, "docs/engineering/tenant-isolation-coverage-inventory.md"),
    `[own](../../${approvalFile}#L6) [integrity](../../${approvalFile}#L7)\n`);
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  const run = (...args) => spawnSync(process.execPath, [tool, "--base", "HEAD", ...args], { cwd, encoding: "utf8" });
  return { cwd, manifest, approval, run };
}

test("approval success and integrity anchors relocate in their companion file without changing coverage", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, approvalFile), "inserted\n" + f.approval);
  const check = f.run();
  assert.equal(check.status, 1, check.stdout);
  assert.match(check.stdout, /"repinned": 2/);
  assert.match(check.stdout, /"needsReview": 0/);
  const result = f.run("--write");
  assert.equal(result.status, 0, result.stdout);
  const expected = structuredClone(f.manifest);
  expected.allApiRouteFiles[route].methods[0].testedBy.approvalPositiveLine = 7;
  expected.allApiRouteFiles[route].methods[0].testedBy.approvalIntegrityLine = 8;
  assert.deepEqual(JSON.parse(readFileSync(join(f.cwd, manifestFile), "utf8")), expected);
  assert.equal(readFileSync(join(f.cwd, "docs/engineering/tenant-isolation-coverage-inventory.md"), "utf8"),
    `[own](../../${approvalFile}#L7) [integrity](../../${approvalFile}#L8)\n`);
  assert.equal(f.run().status, 0);
});

for (const failure of ["edited", "missing file", "missing declaration"]) {
  test(`approval integrity evidence fails closed when ${failure}`, (t) => {
    const f = fixture(t);
    if (failure === "edited") writeFileSync(join(f.cwd, approvalFile), f.approval.replace("receipt integrity assertion", "different assertion"));
    if (failure === "missing file") rmSync(join(f.cwd, approvalFile));
    if (failure === "missing declaration") {
      delete f.manifest.allApiRouteFiles[route].methods[0].testedBy.approvalPositiveFile;
      writeFileSync(join(f.cwd, manifestFile), JSON.stringify(f.manifest));
    }
    const before = readFileSync(join(f.cwd, manifestFile), "utf8");
    const result = f.run("--write");
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /REVIEW GET .*approvalIntegrityLine|evidence file .* no longer exists/);
    assert.equal(readFileSync(join(f.cwd, manifestFile), "utf8"), before);
  });
}
