/** Synthetic filing-file downloads only: never submit a return or call a provider. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import { auditEvents, employees, governmentFilingValidations, payrollEntries, payrollRuns } from "../../src/db/schema.ts";
import { recordGeneratedFiling } from "../../src/lib/filing-evidence-store.ts";
import { FILING_FORMS } from "../../src/lib/filing-evidence.ts";

export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function requireDisposableFilingFile() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
}

async function snapshotVictimFilings(organizationId) {
  const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId)).orderBy(payrollRuns.id);
  assert.ok(runs.length > 0, "Actual victim payroll must exist");
  const [filings, staff, entries, audit] = await Promise.all([
    db.select().from(governmentFilingValidations).where(eq(governmentFilingValidations.organizationId, organizationId)).orderBy(governmentFilingValidations.id),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(employees.id),
    db.select().from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runs.map(run => run.id))).orderBy(payrollEntries.id),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)).orderBy(auditEvents.id),
  ]);
  return { runs, filings, staff, entries, audit };
}

function assertOwnedFilingBytes(response, fixture) {
  assert.ok(fixture.file.body.length > 100, "An empty or placeholder own file is not proof");
  assert.equal(response.text, fixture.file.body, "Serve the actual owned payroll worksheet bytes");
  assert.equal(response.headers.get("x-filing-sha256"), fixture.record.fileSha256);
  assert.equal(digest(Buffer.from(response.text, "utf8")), fixture.record.fileSha256);
  assert.equal(response.headers.get("content-type"), fixture.file.contentType);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="' + fixture.file.filename + '"');
  assert.ok(response.text.includes("# payrollRun=" + fixture.record.payrollRunId));
}

export async function verifyTenantFilingFile(f, { request, expectStatus }) {
  requireDisposableFilingFile();
  assert.equal(new Set(f.orgs.map(org => org.id)).size, 3);
  assert.equal(f.victimRuns.length, 8);
  const definition = FILING_FORMS.find(form => form.kind === "bir-1601c");
  assert.ok(definition, "Use the existing local worksheet generator, never invented file bytes");
  const fixtures = [];
  const ordered = [];
  const nonce = randomUUID();
  // This generator requires a final-month cutoff. Use dedicated synthetic runs,
  // and finish ALL payroll fixture inserts before recording immutable hashes.
  for (const orgIndex of [0, 0, 0, 0, 0, 0, 0, 1, 2, 0]) {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: f.orgs[orgIndex].id, legalEntityId: f.entities[orgIndex].id,
      periodLabel: "Fictional DL01 final cutoff " + nonce + "-" + ordered.length,
      periodStart: "2026-10-16", periodEnd: "2026-10-31", payDate: "2026-10-31",
      status: "Released", employeeCount: 1,
    }).returning();
    const employeeId = orgIndex === 0 ? f.victimEmployee.id : f.ownedEmployees[orgIndex - 1].id;
    await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId,
      grossPay: "5000.00", deductions: "500.00", netPay: "4500.00",
    });
    ordered.push({ orgIndex, run });
  }
  assert.equal(ordered.length, 10);
  for (const { orgIndex, run } of ordered) {
    const fixture = await recordGeneratedFiling({
      organizationId: f.orgs[orgIndex].id, runId: run.id, definition,
      actor: "Fictional DL-01 CI generator",
    });
    assert.equal(fixture.created, true, "This proof requires newly seeded, ordered records");
    assert.equal(fixture.record.organizationId, f.orgs[orgIndex].id);
    assert.equal(fixture.record.payrollRunId, run.id);
    assert.equal(fixture.record.fileSha256, digest(Buffer.from(fixture.file.body, "utf8")));
    fixtures.push(fixture);
  }
  const victimOrg = f.orgs[0];
  const victim = fixtures[9];
  const [persistedVictim] = await db.select().from(governmentFilingValidations)
    .where(eq(governmentFilingValidations.id, victim.record.id));
  assert.equal(persistedVictim?.organizationId, victimOrg.id);
  assert.equal(persistedVictim?.payrollRunId, ordered[9].run.id);
  assert.ok(victim.record.id > 6 && victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id);
  const before = await snapshotVictimFilings(victimOrg.id);
  const receipts = [];

  for (const idx of [1, 2]) {
    const owned = fixtures[6 + idx];
    const ownOrg = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    assert.equal(owned.record.organizationId, ownOrg.id);
    assert.notEqual(persistedVictim.organizationId, ownOrg.id);
    assert.ok(victim.record.id > owned.record.id);
    const account = expectStatus(await request("/api/account", { cookie }), 200,
      "The attacker remains signed in as its own fictional principal");
    assert.equal(account.json?.profile?.id, f.owners[idx].id);
    const ownUrl = "/api/compliance/filing-validations/" + owned.record.id + "/file?organizationId=" + ownOrg.id;
    const own = expectStatus(await request(ownUrl, { cookie }), 200, FILING_FILE_METHOD + " own stored file");
    assertOwnedFilingBytes(own, owned);

    const foreign = expectStatus(await request("/api/compliance/filing-validations/" + victim.record.id +
      "/file?organizationId=" + victimOrg.id, { cookie }), 403, FILING_FILE_METHOD + " actual victim file denied");
    assert.ok(!foreign.text.includes(victim.record.fileSha256));
    const wrongScope = expectStatus(await request("/api/compliance/filing-validations/" + victim.record.id +
      "/file?organizationId=" + ownOrg.id, { cookie }), 404, FILING_FILE_METHOD + " real victim ID under own employer denied");
    assert.ok(!wrongScope.text.includes(victim.file.body));
    const forged = expectStatus(await request(ownUrl + "&runId=" + victim.record.payrollRunId +
      "&employeeId=" + f.victimEmployee.id, { cookie }), 200, FILING_FILE_METHOD + " forged victim selectors ignored");
    assertOwnedFilingBytes(forged, owned);
    assert.notEqual(owned.record.fileSha256, victim.record.fileSha256);
    const after = await snapshotVictimFilings(victimOrg.id);
    assert.deepEqual(after, before, "Unauthorized downloads cannot mutate victim filing, payroll, staff or audit rows");
    receipts.push({ method: FILING_FILE_METHOD, attacker: ownOrg.id, ownObjectId: owned.record.id,
      victimObjectId: victim.record.id, ownStatus: own.status, victimStatus: foreign.status,
      wrongScopeStatus: wrongScope.status, forgedStatus: forged.status, victimDatabaseUnchanged: true });
    console.log("PASS DL-01 " + FILING_FILE_METHOD + " authenticated attacker " + idx);
  }
  assert.equal(receipts.length, 2);
  console.log(JSON.stringify({ kind: "DISPOSABLE_PG16_REAL_HTTP", auditSuite: "dl01-filing-file",
    receipts, productionTested: false, certified: false }));
}
