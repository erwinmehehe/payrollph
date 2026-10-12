import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiKeys, legalEntities, orgUnits, organizations, payrollEntries,
  payrollRuns, employees, payslips, providerEvents,
} from "../src/db/schema";
import { mintApiKey } from "../src/lib/api-keys";
import { GET as listUnits } from "../src/app/api/v1/org-units/route";
import { GET as listPayslips } from "../src/app/api/v1/payslips/route";
import { GET as downloadPayslip } from "../src/app/api/v1/payslips/[id]/route";
import { GET as listEvents } from "../src/app/api/v1/events/route";

test("extended API is default-off, scope-checked, revocable, tenant and entity isolated", async () => {
  const prior = process.env.PUBLIC_API_V1_EXTENDED_ENABLED;
  const nonce = randomUUID().slice(0, 10);
  const orgIds: number[] = [];
  try {
    const [a, b] = await db.insert(organizations).values([
      { name: "API A "+nonce, legalName: "API A "+nonce },
      { name: "API B "+nonce, legalName: "API B "+nonce },
    ]).returning({ id: organizations.id });
    orgIds.push(a.id, b.id);
    const [entityA, entityB] = await db.insert(legalEntities).values([
      { organizationId: a.id, code: "PRIMARY", legalName: "API A", displayName: "API A", primaryEntity: true },
      { organizationId: b.id, code: "PRIMARY", legalName: "API B", displayName: "API B", primaryEntity: true },
    ]).returning({ id: legalEntities.id });
    const [unitA, unitB] = await db.insert(orgUnits).values([
      { organizationId: a.id, legalEntityId: entityA.id, type: "department", code: "A", name: "Alpha confidential" },
      { organizationId: b.id, legalEntityId: entityB.id, type: "department", code: "B", name: "Beta confidential" },
    ]).returning({ id: orgUnits.id });
    const [employeeA, employeeB] = await db.insert(employees).values([
      { organizationId: a.id, legalEntityId: entityA.id, orgUnitId: unitA.id,
        employeeNo: "API-A-"+nonce, firstName: "Alpha", lastName: "Worker", title: "Staff",
        avatarInitials: "AW", basicRate: "10000.00", startDate: "2026-01-01" },
      { organizationId: b.id, legalEntityId: entityB.id, orgUnitId: unitB.id,
        employeeNo: "API-B-"+nonce, firstName: "Beta", lastName: "Worker", title: "Staff",
        avatarInitials: "BW", basicRate: "20000.00", startDate: "2026-01-01" },
    ]).returning({ id: employees.id });
    const [runA, runB] = await db.insert(payrollRuns).values([
      { organizationId: a.id, legalEntityId: entityA.id, scopeOrgUnitId: unitA.id,
        periodLabel: "A 2026/10", periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-15", status: "Released" },
      { organizationId: b.id, legalEntityId: entityB.id, scopeOrgUnitId: unitB.id,
        periodLabel: "B 2026/10", periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-15", status: "Released" },
    ]).returning({ id: payrollRuns.id });
    const [entryA, entryB] = await db.insert(payrollEntries).values([
      { payrollRunId: runA.id, employeeId: employeeA.id, grossPay: "5000.00", netPay: "4500.00", deductions: "500.00" },
      { payrollRunId: runB.id, employeeId: employeeB.id, grossPay: "9000.00", netPay: "8000.00", deductions: "1000.00" },
    ]).returning({ id: payrollEntries.id });
    const [slipA, slipB] = await db.insert(payslips).values([
      { organizationId: a.id, employeeId: employeeA.id, payrollEntryId: entryA.id, periodLabel: "A", content: "%PDF-alpha-only" },
      { organizationId: b.id, employeeId: employeeB.id, payrollEntryId: entryB.id, periodLabel: "B", content: "%PDF-beta-private" },
    ]).returning({ id: payslips.id });
    await db.insert(providerEvents).values([
      { provider: "linaw", eventId: "test-alpha-"+nonce, organizationId: a.id, eventType: "employee.onboarded" },
      { provider: "linaw", eventId: "test-beta-"+nonce, organizationId: b.id, eventType: "employee.offboarded" },
      { provider: "paymongo", eventId: "other-"+nonce, organizationId: a.id, eventType: "transfer" },
    ]);
    const token = mintApiKey();
    const [key] = await db.insert(apiKeys).values({
      organizationId: a.id, name: "Extended Test", prefix: token.prefix,
      keyHash: token.keyHash, scopes: ["org-units:read", "payslips:read", "events:read"],
    }).returning({ id: apiKeys.id });
    const request = (path: string) => new Request("http://localhost"+path, {
      headers: { authorization: "Bearer "+token.key },
    });
    delete process.env.PUBLIC_API_V1_EXTENDED_ENABLED;
    assert.equal((await listUnits(request("/api/v1/org-units"))).status, 404);
    process.env.PUBLIC_API_V1_EXTENDED_ENABLED = "true";

    const units = await listUnits(request("/api/v1/org-units"));
    assert.equal(units.status, 200);
    const unitsJson = await units.json();
    assert.deepEqual(unitsJson.data.map((row: { id: number }) => row.id), [unitA.id]);
    assert.ok(!JSON.stringify(unitsJson).includes("Beta confidential"));

    const slips = await listPayslips(request("/api/v1/payslips"));
    assert.equal(slips.status, 200);
    const slipsJson = await slips.json();
    assert.deepEqual(slipsJson.data.map((row: { id: number }) => row.id), [slipA.id]);
    assert.ok(!JSON.stringify(slipsJson).includes(String(slipB.id)));

    const pdf = await downloadPayslip(request("/api/v1/payslips/"+slipA.id), { params: Promise.resolve({ id: String(slipA.id) }) });
    assert.equal(pdf.status, 200);
    assert.equal(await pdf.text(), "%PDF-alpha-only");
    assert.equal((await downloadPayslip(request("/api/v1/payslips/"+slipB.id), { params: Promise.resolve({ id: String(slipB.id) }) })).status, 404);

    const events = await listEvents(request("/api/v1/events"));
    assert.equal(events.status, 200);
    const eventJson = await events.json();
    assert.deepEqual(eventJson.data.map((row: { eventId: string }) => row.eventId), ["test-alpha-"+nonce]);
    assert.ok(!JSON.stringify(eventJson).includes("test-beta-"+nonce));

    await db.update(apiKeys).set({ scopes: ["org-units:read"] }).where(eq(apiKeys.id, key.id));
    assert.equal((await listPayslips(request("/api/v1/payslips"))).status, 403);
    await db.insert(legalEntities).values({
      organizationId: a.id, code: "SECOND", legalName: "Other entity", displayName: "Other entity",
    });
    assert.equal((await listUnits(request("/api/v1/org-units"))).status, 409,
      "A tenant-wide token cannot read a multi-entity workspace.");
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id));
    assert.equal((await listUnits(request("/api/v1/org-units"))).status, 401);
  } finally {
    if (prior === undefined) delete process.env.PUBLIC_API_V1_EXTENDED_ENABLED;
    else process.env.PUBLIC_API_V1_EXTENDED_ENABLED = prior;
    for (const id of orgIds) await db.delete(organizations).where(eq(organizations.id, id));
  }
});
