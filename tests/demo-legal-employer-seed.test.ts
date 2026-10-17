import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { employees, legalEntities, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { DEMO_MODE, ensureSeedData } from "../src/db/seed";

// This test owns a dedicated, throwaway, empty loopback app_db. It must never
// seed live Neon, dev-shared employer data, or mixed-use customer databases.
const isDisposableDb = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      && url.pathname === "/app_db";
  } catch {
    return false;
  }
})();

test("verified demo fixtures receive idempotent, tenant-scoped primary legal employers", {
  skip: !DEMO_MODE || !isDisposableDb,
}, async () => {
  const before = await db.select().from(organizations);
  assert.equal(before.length, 0, "test requires a freshly empty disposable database");

  await ensureSeedData();
  const specs = [
    { name: "Loom & Local", expected: 8 },
    { name: "Mantra Studio", expected: 7 },
    { name: "Santos Retail Group", expected: 8 },
    { name: "Mika, self-employed", expected: 0 },
  ];
  const firstPrimary = new Map<number, number>();
  for (const spec of specs) {
    const [org] = await db.select().from(organizations).where(eq(organizations.name, spec.name));
    assert.ok(org, `missing fictional organization ${spec.name}`);
    const primaries = await db.select().from(legalEntities).where(
      and(eq(legalEntities.organizationId, org.id), eq(legalEntities.code, "PRIMARY")),
    );
    assert.equal(primaries.length, 1, `${spec.name}: one primary legal employer`);
    firstPrimary.set(org.id, primaries[0].id);
    const staff = await db.select().from(employees).where(eq(employees.organizationId, org.id));
    assert.equal(staff.length, spec.expected);
    assert.ok(staff.every((person) => person.legalEntityId === primaries[0].id),
      `${spec.name}: every fixture employee belongs to their same-tenant legal employer`);
  }

  // #1102: Verify persisted fictional run headers against actual payroll
  // entry rows, not just the shared TypeScript fixture generator. This test
  // is gated to a newly empty, disposable loopback PostgreSQL app_db.
  const [loom] = await db.select().from(organizations)
    .where(eq(organizations.name, "Loom & Local"));
  assert.ok(loom, "missing fictional payroll employer");
  const fictionalRuns = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, loom.id));
  assert.equal(fictionalRuns.length, 3, "expected two populated test runs and an empty draft");
  const toCentavos = (amount: string) => {
    assert.match(amount, /^[0-9]+[.][0-9]{2}$/, "PostgreSQL money fixture must have two decimal places");
    return BigInt(amount.replace(".", ""));
  };
  for (const run of fictionalRuns) {
    const rows = await db.select().from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id));
    let totalGross = BigInt(0);
    let totalNet = BigInt(0);
    for (const row of rows) {
      const gross = toCentavos(row.grossPay);
      const deductions = toCentavos(row.deductions);
      const net = toCentavos(row.netPay);
      assert.equal(gross - deductions, net, `run ${run.id}: employee gross-to-net identity`);
      totalGross += gross;
      totalNet += net;
    }
    assert.equal(totalGross, toCentavos(run.grossPay), `run ${run.id}: persisted gross header mismatch`);
    assert.equal(totalNet, toCentavos(run.netPay), `run ${run.id}: persisted net header mismatch`);
    if (run.status === "Draft") {
      assert.equal(rows.length, 0, "unprocessed fictional draft must have no pay entries");
    } else {
      assert.equal(rows.length, run.employeeCount, `run ${run.id}: persisted employee count`);
    }
  }

  await ensureSeedData();
  const after = await db.select().from(legalEntities);
  assert.equal(after.length, 4, "repeated demo login must not create duplicate legal employers");
  for (const row of after) assert.equal(row.id, firstPrimary.get(row.organizationId));

  // Reproduce the legacy fictional seed's missing link, then verify that
  // the next demo entry repairs it without duplicating employers or touching
  // any configured assignment.
  const [legacyOrg] = await db.select().from(organizations)
    .where(eq(organizations.name, "Loom & Local"));
  const [legacyWorker] = await db.select().from(employees)
    .where(eq(employees.organizationId, legacyOrg.id));
  await db.update(employees).set({ legalEntityId: null })
    .where(eq(employees.id, legacyWorker.id));
  await ensureSeedData();
  const [repaired] = await db.select().from(employees)
    .where(eq(employees.id, legacyWorker.id));
  assert.equal(repaired.legalEntityId, firstPrimary.get(legacyOrg.id),
    "known legacy fictional worker must be reattached on repeated demo login");

  // A different employer in the same otherwise test-only DB prevents even a
  // name-matched demo repair. No customer worker may be linked automatically.
  const [outside] = await db.insert(organizations).values({
    name: "Non-demo regression sentinel", legalName: "Non-demo regression sentinel Ltd.",
  }).returning();
  try {
    const [outsideWorker] = await db.insert(employees).values({
      organizationId: outside.id, employeeNo: "NONDEMO-001",
      firstName: "Unaffiliated", lastName: "Sentinel", title: "Worker",
      avatarInitials: "US", basicRate: "100", startDate: "2026-01-01",
    }).returning();
    await ensureSeedData();
    const [unchanged] = await db.select().from(employees).where(eq(employees.id, outsideWorker.id));
    assert.equal(unchanged.legalEntityId, null,
      "never attach an unrelated employee to a fictional demo legal entity");
    const [foreignLegal] = await db.select().from(legalEntities)
      .where(eq(legalEntities.organizationId, outside.id));
    assert.equal(foreignLegal, undefined, "no legal-employer auto-creation for unrelated company");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, outside.id));
  }
});
