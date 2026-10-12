import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import type { db } from "../src/db";

test("first-payroll preview never exposes a write-capable database dependency", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { loadReadOnlyFirstPayrollPreview } = await import("../src/lib/first-payroll-preview");
  const tables: Record<string, unknown[]> = {
    organizations: [{ id: 9, name: "Test", legalName: "Test", payrollCalendarMode: "flexible" }],
  };
  let writes = 0;
  const reader = new Proxy({
    select() {
      let table = "";
      const query: Record<string, unknown> = {};
      query.from = (target: Parameters<typeof getTableName>[0]) => {
        table = getTableName(target);
        return query;
      };
      query.where = () => query;
      query.limit = () => query;
      query.then = (done: (rows: unknown[]) => unknown) => Promise.resolve(tables[table] ?? []).then(done);
      return query;
    },
  }, {
    get(target, name) {
      if (name === "select") return target.select;
      writes += 1;
      throw new Error("Unexpected DB mutation method");
    },
  }) as unknown as Pick<typeof db, "select">;
  const before = structuredClone(tables);
  const result = await loadReadOnlyFirstPayrollPreview({
    organizationId: 9, periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15",
  }, reader);
  assert.equal(result.dryRun, true);
  assert.equal(result.persisted, false);
  assert.equal(result.previewReady, false);
  assert.deepEqual(tables, before);
  assert.equal(writes, 0);
});

test("the first payroll preview route and calculator have no write operations", () => {
  const route = readFileSync("src/app/api/first-payroll/preview/route.ts", "utf8");
  const loader = readFileSync("src/lib/first-payroll-preview.ts", "utf8");
  assert.match(route, /loadReadOnlyFirstPayrollPreview/);
  assert.match(loader, /calculateEmployeePay/);
  for (const source of [route, loader]) {
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.transaction\(|enqueuePayrollRun|drainPayrollQueue/);
  }
});
