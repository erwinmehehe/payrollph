import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JOURNAL_COLUMNS, PAYROLL_COLUMNS } from "../src/lib/private-parallel-payroll-reconciliation";

// Actual offline CLI, not a mock of its return value. Every value is fictional.
test("one-period private payroll CLI requires --pilot, preserves privacy and blocks centavo mismatch", () => {
  const root = mkdtempSync(join(tmpdir(), "fictional-579-cli-"));
  const period = "2026-07";
  const employer = "PH-TEST-EMPLOYER-579";
  const workerKey = createHmac("sha256", "FICTIONAL-NOT-A-REAL-EMPLOYER-SECRET")
    .update("worker-fictional-one").digest("hex");
  const csv = (columns: readonly string[], rows: string[][]) =>
    [columns.join(","), ...rows.map(x => x.join(","))].join("\n") + "\n";
  const values = [
    workerKey, employer, period,
    "20000.00", "18500.00", "875.00", "500.00", "100.00",
    "1520.00", "0.00", "0.00", "5.00",
    "17000.00", "1750.00", "15.00", "500.00", "100.00",
  ];
  const journal = csv(JOURNAL_COLUMNS, [
    ["PAYROLL_GROSS",employer,period,"20000.00","0.00"],
    ["BANK_NET",employer,period,"0.00","17000.00"],
    ["SSS_PAYABLE",employer,period,"0.00","2640.00"],
    ["PHILHEALTH_PAYABLE",employer,period,"0.00","1000.00"],
    ["PAGIBIG_PAYABLE",employer,period,"0.00","200.00"],
    ["BIR_WHT_PAYABLE",employer,period,"0.00","1520.00"],
    ["OTHER_DEDUCTIONS_PAYABLE",employer,period,"0.00","5.00"],
    ["EMPLOYER_STATUTORY_EXPENSE",employer,period,"2365.00","0.00"],
  ]);
  const cycle = {
    period,
    incumbentPayroll: { filePath: "incumbent-pay.csv", sha256: "" },
    linawPayroll: { filePath: "linaw-pay.csv", sha256: "" },
    incumbentJournal: { filePath: "incumbent-gl.csv", sha256: "" },
    linawJournal: { filePath: "linaw-gl.csv", sha256: "" },
  };
  const manifest = { schemaVersion: 1, legalEntityCode: employer, cycles: [cycle] };
  const script = fileURLToPath(new URL("../scripts/check-private-parallel-payroll.ts", import.meta.url));
  const manifestPath = join(root, "manifest.json");
  const write = (key: "incumbentPayroll"|"linawPayroll"|"incumbentJournal"|"linawJournal", body: string) => {
    writeFileSync(join(root, cycle[key].filePath), body, { mode: 0o600 });
    cycle[key].sha256 = createHash("sha256").update(body).digest("hex");
  };
  const run = (pilot: boolean) => {
    writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    return spawnSync(process.execPath, ["--import", "tsx", script, manifestPath, root, ...(pilot ? ["--pilot"] : [])],
      { encoding: "utf8", timeout: 30000 });
  };
  try {
    const payroll = csv(PAYROLL_COLUMNS, [values]);
    write("incumbentPayroll", payroll);
    write("linawPayroll", payroll);
    write("incumbentJournal", journal);
    write("linawJournal", journal);
    const pilot = run(true);
    assert.equal(pilot.status, 0, pilot.stderr);
    const report = JSON.parse(pilot.stdout);
    assert.equal(report.status, "pilot-arithmetic-reconciled-pending-independent-review");
    assert.equal(report.verifiedFileHashCount, 4);
    assert.equal(report.results[0].matchedEmployees, 1);
    assert.equal(report.issues.length, 0);
    assert.ok(!pilot.stdout.includes(workerKey), "Never expose HMAC employee keys");
    assert.ok(!pilot.stdout.includes("20000.00"), "Never expose fictional individual salaries");
    assert.match(report.disclaimer, /independent human review/i);

    const certification = run(false);
    assert.equal(certification.status, 1, certification.stderr);
    assert.match(JSON.parse(certification.stdout).issues.join(" "), /Two to twelve distinct/);

    const changed = [...values];
    changed[8] = "1520.02";
    changed[12] = "16999.98";
    write("linawPayroll", csv(PAYROLL_COLUMNS, [changed]));
    const blocked = run(true);
    assert.equal(blocked.status, 1, blocked.stderr);
    const bad = JSON.parse(blocked.stdout);
    assert.equal(bad.status, "reconciliation-blocked");
    assert.ok(bad.issues.some((issue: string) => issue.includes("exceeding ₱0.01")));
    assert.ok(!blocked.stdout.includes(workerKey));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
