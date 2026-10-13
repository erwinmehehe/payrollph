import assert from "node:assert/strict";
import test from "node:test";
import { previewEmployeeImport, employeeImportErrorCsv, importPreviewReceipt, validImportPreviewReceipt } from "../src/lib/employee-import-preview";
import { parseEmployeeCsv } from "../src/lib/csv-import";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

function fiveHundredRowCsv() {
  const rows = ["Employee No,First Name,Last Name,Start Date,Monthly Basic,Region,TIN,Department"];
  for (let i = 1; i <= 500; i++) {
    rows.push(["EMP-" + String(i).padStart(4, "0"), "Fictional", "Person", "2026-01-01",
      "25000", "NCR", i <= 20 ? "BAD" : "123456789", "OPS"].join(","));
  }
  return rows.join("\n") + "\n";
}

test("500-row preview identifies exactly 20 seeded errors without admitting them", () => {
  const csv = fiveHundredRowCsv();
  const context = { existingNumbers: [], departments: [{ id: 7, code: "OPS", name: "Operations" }] };
  const result = previewEmployeeImport(csv, context);
  assert.equal(result.totalRows, 500);
  assert.equal(result.errorCount, 20);
  assert.equal(result.blockingErrorCount, 20);
  assert.equal(result.candidates.length, 480);
  assert.deepEqual(result.rows.filter(row => row.status === "error").map(row => row.line),
    Array.from({ length: 20 }, (_, i) => i + 2));
  assert.equal(result.rows[0].reasons.some(reason => reason.includes("Bad TIN")), true);
  const errors = employeeImportErrorCsv(result);
  assert.equal(errors.split("\n").slice(1).filter(line => line.includes(",\"error\",")).length, 20);
  const skipLines = Array.from({ length: 20 }, (_, i) => i + 2);
  const skipped = previewEmployeeImport(csv, { ...context, skipLines });
  assert.equal(skipped.errorCount, 20);
  assert.equal(skipped.blockingErrorCount, 0);
  assert.equal(skipped.skippedCount, 20);
  assert.equal(skipped.candidates.length, 480);
});

test("legacy parser continues accepting valid CSV while preview flag stays default-off", () => {
  const csv = fiveHundredRowCsv();
  const parsed = parseEmployeeCsv(csv);
  assert.equal(parsed.errors.length, 0, "Legacy import did not validate optional TIN in its old format");
  assert.equal(parsed.validRows.length, 500);
  assert.equal(criticalReleaseFlagEnabled("employeeImportPreview", {}), false);
  assert.equal(criticalReleaseFlagEnabled("employeeImportPreview", { EMPLOYEE_IMPORT_PREVIEW_ENABLED: "true" }), true);
});

test("preview receipt is tenant/session/CSV/selection-bound before commit", () => {
  const csv = fiveHundredRowCsv();
  const selected = Array.from({ length: 20 }, (_, i) => i + 2);
  const receipt = importPreviewReceipt(csv, 7, selected, "synthetic-session-only");
  assert.equal(validImportPreviewReceipt(receipt, receipt), true);
  assert.equal(validImportPreviewReceipt(receipt, importPreviewReceipt(csv, 8, selected, "synthetic-session-only")), false);
  assert.equal(validImportPreviewReceipt(receipt, importPreviewReceipt(csv, 7, selected, "different-session")), false);
  assert.equal(validImportPreviewReceipt(receipt, importPreviewReceipt(csv + " ", 7, selected, "synthetic-session-only")), false);
  assert.equal(validImportPreviewReceipt(receipt, importPreviewReceipt(csv, 7, [], "synthetic-session-only")), false);
});
