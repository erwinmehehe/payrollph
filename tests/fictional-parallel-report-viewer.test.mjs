import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  renderFictionalParallelReport,
  readBoundedFictionalFixture,
  validateFictionalParallelReport,
} from "../scripts/qa/render-fictional-parallel-report.mjs";

const fixturePath = resolve("fixtures/qa/fictional-parallel-report.json");
const script = fileURLToPath(new URL("../scripts/qa/render-fictional-parallel-report.mjs", import.meta.url));
test("fixture reader bounds the opened regular file and rejects oversized data", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bounded-fictional-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readBoundedFictionalFixture(fixturePath), JSON.parse(readFileSync(fixturePath, "utf8")));
  const tooLarge = join(root, "large.json");
  writeFileSync(tooLarge, Buffer.alloc(256 * 1024 + 1, 32));
  assert.throws(() => readBoundedFictionalFixture(tooLarge), /bounded regular file|safe size bound/);
  assert.throws(() => readBoundedFictionalFixture(root));
});
function fixture() { return JSON.parse(readFileSync(fixturePath, "utf8")); }

test("fictional reconciliation renders a local-only, explicitly unapproved count summary", () => {
  const report = validateFictionalParallelReport(fixture());
  assert.equal(report.cycleCount, 1);
  assert.equal(report.rows[0].matched, 25);
  assert.equal(report.issueCount, 0);
  const html = renderFictionalParallelReport(report);
  assert.match(html, /ARITHMETIC MATCH — independent review still pending/);
  assert.match(html, /No component-count variances/);
  assert.match(html, /connect-src &#39;none&#39;/);
  assert.doesNotMatch(html, /FICTIONAL_EMPLOYER_01/);
  assert.doesNotMatch(html, /<script|<link|<iframe/);
});

test("blocked fictional result shows component counts but never reproduces raw issues", () => {
  const input = fixture();
  input.report.status = "reconciliation-blocked";
  input.report.results[0].employeeFieldVarianceCounts.withholding_tax = 1;
  input.report.issues = ["2026-07 payroll withholding_tax: 1 employee discrepancy/discrepancies exceeding ₱0.01. Raw: someone@example.com <script>alert(1)</script>"];
  const html = renderFictionalParallelReport(validateFictionalParallelReport(input));
  assert.match(html, /BLOCKED — investigate checker issues/);
  assert.match(html, /withholding tax/);
  assert.match(html, /Payroll component variance/);
  assert.doesNotMatch(html, /someone@example.com|alert\(1\)|<script/);
});

test("viewer refuses real/unmarked input, unexpected worker fields and false matches", () => {
  const unmarked = fixture();
  delete unmarked.fictionalFixture;
  assert.throws(() => validateFictionalParallelReport(unmarked), /unexpected or missing/);
  const real = fixture();
  real.report.legalEntityCode = "CUSTOMER_ACME";
  assert.throws(() => validateFictionalParallelReport(real), /fictional employer/);
  const pii = fixture();
  pii.report.results[0].employee_key = "worker-actual";
  assert.throws(() => validateFictionalParallelReport(pii), /unexpected or missing/);
  const forged = fixture();
  forged.report.results[0].employeeFieldVarianceCounts.net_pay = 1;
  assert.throws(() => validateFictionalParallelReport(forged), /conflicts with incomplete/);
  const hiddenIssue = fixture();
  hiddenIssue.report.issues = ["blocked"];
  assert.throws(() => validateFictionalParallelReport(hiddenIssue), /conflicts with incomplete/);
});

test("CLI creates offline HTML (POSIX 0600), refuses overwrites and requires opt-in", (t) => {
  const root = mkdtempSync(join(tmpdir(), "fictional-payroll-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "local-report.html");
  const run = (...extra) => spawnSync(process.execPath, [script, fixturePath, output, ...extra], { encoding: "utf8" });
  const valid = run("--fictional");
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(readFileSync(output, "utf8"), /Fictional demonstration only/);
  // Windows exposes synthetic mode bits; POSIX permissions do not describe its ACLs.
  // Keep the privacy assertion on every platform where mode 0600 is meaningful.
  if (process.platform !== "win32") assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(run("--fictional").status, 1, "Existing local file must never be overwritten.");
  const missing = join(root, "missing-confirmation.html");
  const refused = spawnSync(process.execPath, [script, fixturePath, missing], { encoding: "utf8" });
  assert.equal(refused.status, 2);
  const bad = fixture();
  bad.report.legalEntityCode = "REAL_PAYROLL";
  const badPath = join(root, "bad.json");
  writeFileSync(badPath, JSON.stringify(bad));
  const badOut = join(root, "bad.html");
  const blocked = spawnSync(process.execPath, [script, badPath, badOut, "--fictional"], { encoding: "utf8" });
  assert.equal(blocked.status, 1);
});
