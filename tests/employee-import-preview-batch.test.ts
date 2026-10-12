import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { previewEmployeeImport, employeeImportErrorCsv, importPreviewReceipt, validImportPreviewReceipt } from "../src/lib/employee-import-preview";

import { importFixtureCsv } from "./fixtures/employee-import-500";

const context = { existingNumbers: [], departments: [{ id: 7, code: "OPS", name: "Operations" }] };

test("500 rows expose exactly the 20 seeded errors without truncation", () => {
  const result = previewEmployeeImport(importFixtureCsv(), context);
  assert.equal(result.rows.length, 500);
  assert.equal(result.errorCount, 20);
  assert.equal(result.blockingErrorCount, 20);
  assert.equal(result.warningCount, 0);
  assert.equal(result.candidates.length, 480);
  assert.equal(result.rows.filter(r => r.status === "valid").length, 480);
  for (const pattern of [/Bad TIN/, /Duplicate employee/, /Unparseable employment/, /Unknown department/]) assert.equal(result.rows.filter(r => r.reasons.some(reason => pattern.test(reason))).length, 5);
  assert.equal(result.candidates[0].startDate, "2026-10-15");
  assert.equal(employeeImportErrorCsv(result).split("\n").length, 21);
});

test("skip choices and fixed rows are revalidated; ambiguous dates and foreign units cannot pass", () => {
  const first = previewEmployeeImport(importFixtureCsv(), context);
  const skipLines = first.rows.filter(r => r.status === "error").map(r => r.line);
  const skipped = previewEmployeeImport(importFixtureCsv(), { ...context, skipLines });
  assert.equal(skipped.errorCount, 20);
  assert.equal(skipped.blockingErrorCount, 0);
  assert.equal(skipped.skippedCount, 20);
  assert.equal(skipped.candidates.length, 480);
  assert.equal(previewEmployeeImport(importFixtureCsv(false), context).candidates.length, 500);
  const ambiguous = previewEmployeeImport(importFixtureCsv(false).replace("15-Oct-2026", "01/02/2026"), context);
  assert.equal(ambiguous.errorCount, 1);
  const duplicate = previewEmployeeImport(importFixtureCsv(false), { ...context, existingNumbers: ["emp-0001"] });
  assert.equal(duplicate.errorCount, 1);
  assert.equal(previewEmployeeImport(importFixtureCsv(false), { ...context, skipLines: [5010] }).fileErrors.length, 1);
});

test("receipts bind exact CSV, tenant, selected skips and authenticated session", () => {
  const csv = importFixtureCsv();
  const receipt = importPreviewReceipt(csv, 99, [], "synthetic-session");
  assert.equal(validImportPreviewReceipt(receipt, receipt), true);
  for (const other of [importPreviewReceipt(csv, 98, [], "synthetic-session"), importPreviewReceipt(csv + "\nX", 99, [], "synthetic-session"), importPreviewReceipt(csv, 99, [12], "synthetic-session"), importPreviewReceipt(csv, 99, [], "other-session")]) assert.equal(validImportPreviewReceipt(receipt, other), false);
  assert.equal(validImportPreviewReceipt("bad", receipt), false);
});

test("batch commit rejects unskipped errors and rolls back every write when its audit fails", async () => {
  process.env.BANK_DATA_ENCRYPTION_KEY ??= "11".repeat(32);
  process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:1/never_connected";
  const { commitEmployeeImport, ImportBatchRejected } = await import("../src/lib/employee-import-batch-server");
  const { db } = await import("../src/db");
  const state = new Map<string, Array<Record<string, unknown>>>();
  state.set("org_units", [{ id: 7, name: "Operations", code: "OPS", type: "department" }]);
  state.set("legal_entities", [{ id: 5, primaryEntity: true, active: true }]);
  let failAudit = false;
  function select() {
    let table = "";
    const chain: Record<string, unknown> = {};
    chain.from = (t: Parameters<typeof getTableName>[0]) => { table = getTableName(t); return chain; };
    for (const method of ["where", "limit", "orderBy"]) chain[method] = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(state.get(table) ?? []).then(resolve);
    return chain;
  }
  const tx = { select, execute: async () => {}, insert(t: Parameters<typeof getTableName>[0]) {
    const table = getTableName(t);
    return { values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
      const rows = Array.isArray(value) ? value : [value];
      const write = () => {
        if (table === "audit_events" && failAudit) throw new Error("synthetic audit failure");
        const saved = rows.map((r, i) => ({ id: (state.get(table)?.length ?? 0) + i + 1, ...r }));
        state.set(table, [...(state.get(table) ?? []), ...saved]); return saved;
      };
      return { returning: async () => write(), then: (resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(write).then(resolve, reject) };
    } };
  } };
  const database = { async transaction(fn: (transaction: typeof tx) => Promise<unknown>) {
    const before = structuredClone(state);
    try { return await fn(tx); } catch (e) { state.clear(); for (const [k,v] of before) state.set(k,v); throw e; }
  } } as unknown as typeof db;
  const input: Parameters<typeof commitEmployeeImport>[0] = { organizationId: 99, csv: importFixtureCsv(), skipLines: [], fileName: "synthetic.csv", actor: "Synthetic HR", actorId: 1, seatLimit: null };
  await assert.rejects(commitEmployeeImport(input, database), ImportBatchRejected);
  assert.equal(state.get("employees")?.length ?? 0, 0);
  input.skipLines = previewEmployeeImport(input.csv, context).rows.filter(r => r.status === "error").map(r => r.line);
  failAudit = true;
  await assert.rejects(commitEmployeeImport(input, database), /synthetic audit failure/);
  for (const table of ["employees", "employee_pay_profiles", "import_batches", "audit_events"]) assert.equal(state.get(table)?.length ?? 0, 0, table);
  failAudit = false;
  const committed = await commitEmployeeImport(input, database);
  assert.equal(committed.createdCount, 480);
  assert.equal(state.get("employee_pay_profiles")?.length, 480);
  assert.equal(state.get("import_batches")?.length, 1);
  assert.equal(state.get("audit_events")?.length, 1);
});
