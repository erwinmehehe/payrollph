import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateParallelPayrollReconciliation,
  JOURNAL_COLUMNS,
  PAYROLL_COLUMNS,
  type ParallelCycle,
  type ParallelReconciliationManifest,
} from "../src/lib/private-parallel-payroll-reconciliation";

type SourceName = "incumbentPayroll" | "linawPayroll" | "incumbentJournal" | "linawJournal";
const EMPLOYER = "PH-EMPLOYER-STRICT-01";
const TEST_SECRET = "SYNTHETIC-TEST-KEY-NOT-A-PRODUCTION-SECRET";
const pseudonym = (name: string) =>
  createHmac("sha256", TEST_SECRET).update(name).digest("hex");

function asCsv(columns: readonly string[], rows: string[][]) {
  return [columns.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}
function employeeRows(period: string) {
  return [
    [
      pseudonym("synthetic-employee-a"), EMPLOYER, period,
      "20000.00", "18500.00", "875.00", "500.00", "100.00",
      "1520.00", "0.00", "0.00", "5.00",
      "17000.00", "1750.00", "15.00", "500.00", "100.00",
    ],
    [
      pseudonym("synthetic-employee-b"), EMPLOYER, period,
      "15000.00", "13775.00", "750.00", "375.00", "100.00",
      "0.00", "500.00", "300.00", "0.00",
      "12975.00", "1500.00", "15.00", "375.00", "100.00",
    ],
  ];
}
function journalRows(period: string) {
  return [
    ["PAYROLL_GROSS", EMPLOYER, period, "35000.00", "0.00"],
    ["BANK_NET", EMPLOYER, period, "0.00", "29975.00"],
    ["SSS_PAYABLE", EMPLOYER, period, "0.00", "4905.00"],
    ["PHILHEALTH_PAYABLE", EMPLOYER, period, "0.00", "1750.00"],
    ["PAGIBIG_PAYABLE", EMPLOYER, period, "0.00", "400.00"],
    ["BIR_WHT_PAYABLE", EMPLOYER, period, "0.00", "1520.00"],
    ["GOVERNMENT_LOANS_PAYABLE", EMPLOYER, period, "0.00", "500.00"],
    ["COMPANY_LOANS_PAYABLE", EMPLOYER, period, "0.00", "300.00"],
    ["OTHER_DEDUCTIONS_PAYABLE", EMPLOYER, period, "0.00", "5.00"],
    ["EMPLOYER_STATUTORY_EXPENSE", EMPLOYER, period, "4355.00", "0.00"],
  ];
}
function writeEvidence(
  root: string, cycle: ParallelCycle, key: SourceName, bytes: string,
) {
  writeFileSync(join(root, cycle[key].filePath), bytes);
  cycle[key].sha256 = createHash("sha256").update(bytes).digest("hex");
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "linaw-parallel-golden-"));
  const cycles = ["2026-07", "2026-08"].map((period) => {
    const cycle: ParallelCycle = {
      period,
      incumbentPayroll: { filePath: period + "-incumbent-pay.csv", sha256: "" },
      linawPayroll: { filePath: period + "-linaw-pay.csv", sha256: "" },
      incumbentJournal: { filePath: period + "-incumbent-gl.csv", sha256: "" },
      linawJournal: { filePath: period + "-linaw-gl.csv", sha256: "" },
    };
    const pay = asCsv(PAYROLL_COLUMNS, employeeRows(period));
    const journal = asCsv(JOURNAL_COLUMNS, journalRows(period));
    writeEvidence(root, cycle, "incumbentPayroll", pay);
    writeEvidence(root, cycle, "linawPayroll", pay);
    writeEvidence(root, cycle, "incumbentJournal", journal);
    writeEvidence(root, cycle, "linawJournal", journal);
    return cycle;
  });
  const manifest: ParallelReconciliationManifest = {
    schemaVersion: 1, legalEntityCode: EMPLOYER, cycles,
  };
  return { root, manifest };
}
function withFixture(fn: (root: string, manifest: ParallelReconciliationManifest) => void) {
  const { root, manifest } = fixture();
  try { fn(root, manifest); } finally { rmSync(root, { recursive: true, force: true }); }
}
function mutate(
  root: string, manifest: ParallelReconciliationManifest, cycleIndex: number,
  key: SourceName, fn: (old: string) => string,
) {
  const cycle = manifest.cycles[cycleIndex];
  const file = join(root, cycle[key].filePath);
  writeEvidence(root, cycle, key, fn(readFileSync(file, "utf8")));
}

test("two synthetic reconciled months are only arithmetic-ready, never externally certified", () => {
  withFixture((root, manifest) => {
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.equal(report.status, "arithmetic-reconciled-pending-independent-review");
    assert.equal(report.cycleCount, 2);
    assert.equal(report.verifiedFileHashCount, 8);
    assert.equal(report.results.length, 2);
    assert.equal(report.results[0].matchedEmployees, 2);
    assert.equal(report.issues.length, 0);
    assert.match(report.disclaimer, /independent human review/i);
    assert.ok(!JSON.stringify(report).includes(pseudonym("synthetic-employee-a")));
    assert.ok(!JSON.stringify(report).includes("20000.00"));
    assert.ok(!JSON.stringify(report).includes('"status":"certified"'));
  });
});

test("per-employee tax and net-pay mismatches are blocked without exposing employees", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "linawPayroll", (old) =>
      old.replace("1520.00,0.00,0.00,5.00,17000.00",
        "1520.02,0.00,0.00,5.00,16999.98"));
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.equal(report.status, "reconciliation-blocked");
    assert.ok(report.issues.some((x) => x.includes("withholding_tax")));
    assert.ok(report.issues.some((x) => x.includes("net_pay")));
    assert.ok(!JSON.stringify(report).includes("SYNTHETIC-TEST-KEY"));
  });
});

test("one cent of difference is allowed but the combined cycle must also reconcile", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "linawPayroll", (old) =>
      old.replace("1520.00,0.00,0.00,5.00,17000.00",
        "1520.01,0.00,0.00,5.00,16999.99"));
    assert.equal(evaluateParallelPayrollReconciliation(manifest, root).issues.length, 0);
    // Two individually tolerable cent differences may not accumulate to two pesos cents.
    mutate(root, manifest, 0, "linawPayroll", (old) =>
      old.replace("0.00,500.00,300.00,0.00,12975.00",
        "0.01,500.00,300.00,0.00,12974.99"));
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.ok(report.issues.some((x) => x.includes("aggregate payroll variance fields")));
  });
});

test("unmatched or duplicated employee keys fail closed", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "linawPayroll", (old) =>
      asCsv(PAYROLL_COLUMNS, employeeRows("2026-07").slice(0, 1)));
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("population mismatch")));
    mutate(root, manifest, 0, "linawPayroll", () =>
      asCsv(PAYROLL_COLUMNS, [
        ...employeeRows("2026-07"), employeeRows("2026-07")[0],
      ]));
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("Duplicate employee key")));
  });
});

test("cross-legal-employer records cannot be compared", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "linawPayroll", (old) =>
      old.replace(EMPLOYER + ",2026-07", "OTHER-LEGAL-EMPLOYER,2026-07"));
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.ok(report.issues.some((x) => x.includes("Wrong employer or payroll period")));
  });
});

test("stale hashes, missing proof and absolute or escaping paths are rejected", () => {
  withFixture((root, manifest) => {
    manifest.cycles[0].incumbentPayroll.sha256 = "0".repeat(64);
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("SHA-256 mismatch")));
    manifest.cycles[0].incumbentPayroll.filePath = "../outside.csv";
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("unsafe file/hash")));
  });
});

test("symlink escapes outside the private root are blocked", () => {
  withFixture((root, manifest) => {
    const outside = mkdtempSync(join(tmpdir(), "parallel-external-source-"));
    try {
      writeFileSync(join(outside, "outside.csv"), asCsv(PAYROLL_COLUMNS, employeeRows("2026-07")));
      const target = join(root, manifest.cycles[0].incumbentPayroll.filePath);
      rmSync(target);
      symlinkSync(join(outside, "outside.csv"), target);
      assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("escapes the private evidence directory")));
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});

test("noncanonical CSV columns cannot carry employee names or bank data", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "incumbentPayroll", (old) =>
      old.replace("employee_key,", "employee_key,employee_name,"));
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("Remove PII")));
  });
});

test("both journal books must balance and agree account-by-account", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "linawJournal", (old) =>
      old.replace("BANK_NET," + EMPLOYER + ",2026-07,0.00,29975.00",
        "BANK_NET," + EMPLOYER + ",2026-07,0.00,29974.00"));
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("do not balance")));
    mutate(root, manifest, 0, "linawJournal", () => {
      const data = journalRows("2026-07");
      data[0][0] = "UNMAPPED_WAGES";
      return asCsv(JOURNAL_COLUMNS, data);
    });
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("GL account mismatch")));
  });
});

test("a single month, repeated month, and future-dated month do not satisfy real parallel evidence", () => {
  withFixture((root, manifest) => {
    manifest.cycles.pop();
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("Two to twelve distinct")));
    manifest.cycles.push({ ...manifest.cycles[0] });
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("duplicate period")));
    manifest.cycles[1].period = "2099-12";
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("future")));
  });
});

test("gross-to-net identity is verified independently of the peer comparison", () => {
  withFixture((root, manifest) => {
    mutate(root, manifest, 0, "linawPayroll", (old) =>
      old.replace("17000.00", "17200.00"));
    assert.ok(evaluateParallelPayrollReconciliation(manifest, root).issues.some((x) => x.includes("Gross-to-net cash identity")));
  });
});

test("identical balanced journals still fail when both misstate source payroll totals", () => {
  withFixture((root, manifest) => {
    for (const source of ["incumbentJournal", "linawJournal"] as const) {
      mutate(root, manifest, 0, source, (old) => old
        .replace("PAYROLL_GROSS," + EMPLOYER + ",2026-07,35000.00,0.00",
          "PAYROLL_GROSS," + EMPLOYER + ",2026-07,35002.00,0.00")
        .replace("BANK_NET," + EMPLOYER + ",2026-07,0.00,29975.00",
          "BANK_NET," + EMPLOYER + ",2026-07,0.00,29977.00"));
    }
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.equal(report.status, "reconciliation-blocked");
    assert.ok(report.issues.some((reason) => reason.includes("GL-to-payroll bridge differs at PAYROLL_GROSS")));
    assert.ok(report.issues.some((reason) => reason.includes("GL-to-payroll bridge differs at BANK_NET")));
    assert.ok(!report.issues.some((reason) => reason.includes("GL account mismatch")));
    assert.ok(!report.issues.some((reason) => reason.includes("do not balance")));
  });
});

test("matching balanced journals cannot hide swapped statutory versus tax liabilities", () => {
  withFixture((root, manifest) => {
    for (const source of ["incumbentJournal", "linawJournal"] as const) {
      mutate(root, manifest, 0, source, (old) => old
        .replace("SSS_PAYABLE," + EMPLOYER + ",2026-07,0.00,4905.00",
          "SSS_PAYABLE," + EMPLOYER + ",2026-07,0.00,4906.00")
        .replace("BIR_WHT_PAYABLE," + EMPLOYER + ",2026-07,0.00,1520.00",
          "BIR_WHT_PAYABLE," + EMPLOYER + ",2026-07,0.00,1519.00"));
    }
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.equal(report.status, "reconciliation-blocked");
    assert.ok(report.issues.some((x) => x.includes("bridge differs at SSS_PAYABLE")));
    assert.ok(report.issues.some((x) => x.includes("bridge differs at BIR_WHT_PAYABLE")));
    assert.ok(!report.issues.some((x) => x.includes("GL account mismatch")));
    assert.ok(!report.issues.some((x) => x.includes("do not balance")));
  });
});

test("a documented withholding refund bridges to GL debit rather than fictitious credit", () => {
  withFixture((root, manifest) => {
    for (const source of ["incumbentPayroll", "linawPayroll"] as const) {
      mutate(root, manifest, 0, source, (old) => old.replace(
        "1520.00,0.00,0.00,5.00,17000.00",
        "-100.00,0.00,0.00,5.00,18620.00",
      ));
    }
    for (const source of ["incumbentJournal", "linawJournal"] as const) {
      mutate(root, manifest, 0, source, (old) => old
        .replace("BANK_NET," + EMPLOYER + ",2026-07,0.00,29975.00",
          "BANK_NET," + EMPLOYER + ",2026-07,0.00,31595.00")
        .replace("BIR_WHT_PAYABLE," + EMPLOYER + ",2026-07,0.00,1520.00",
          "BIR_WHT_PAYABLE," + EMPLOYER + ",2026-07,100.00,0.00"));
    }
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.equal(report.status, "arithmetic-reconciled-pending-independent-review");
  });
});

test("missing source files never expose private filenames in report", () => {
  withFixture((root, manifest) => {
    manifest.cycles[0].linawPayroll.filePath = "PRIVATE-NAME-KEEP-SECRET.csv";
    const report = evaluateParallelPayrollReconciliation(manifest, root);
    assert.equal(report.status, "reconciliation-blocked");
    assert.ok(report.issues.some((reason) => reason.includes("Input file missing or unreadable")));
    assert.ok(!JSON.stringify(report).includes("PRIVATE-NAME-KEEP-SECRET"));
  });
});
