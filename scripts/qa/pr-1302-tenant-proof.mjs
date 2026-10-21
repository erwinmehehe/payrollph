/**
 * #1302 tenant read and legal-employer method proof using fictional PostgreSQL
 * rows and production-mode localhost HTTP. No provider payments or live tenants.
 * First-payroll proof runs only inside its dedicated, isolated draft CI job.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, firstPayrollJourneyProgress, legalEntities, payrollRuns,
} from "../../src/db/schema";

export async function verifyFirstPayrollTenantRead(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_1302_FIRST_PAYROLL_PROOF, "isolated-ci-only");
  assert.equal(process.env.FIRST_PAYROLL_INLINE_ENABLED, "true");
  const victim = f.orgs[0];
  const victimProgressBefore = await db.select().from(firstPayrollJourneyProgress)
    .where(eq(firstPayrollJourneyProgress.organizationId, victim.id));
  const victimPayrollBefore = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, victim.id));
  const victimAuditBefore = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id));
  const dates = "&periodStart=2026-10-01&periodEnd=2026-10-15&payDate=2026-10-16";

  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownEmployee = f.ownedEmployees[idx - 1];
    // Real worker and released cutoff, not an empty 200 or guessed foreign ID.
    const ownPreview = expectStatus(await request("/api/first-payroll/preview?organizationId=" + org.id + dates, { cookie }), 200,
      "Owned canonical first-payroll preview must return a read-only snapshot");
    assert.equal(ownPreview.json?.organizationId, org.id);
    assert.equal(ownPreview.json?.periodStart, "2026-10-01");
    assert.equal(ownPreview.json?.periodEnd, "2026-10-15");
    assert.ok(ownPreview.json?.rows?.some(row => row.employeeId === ownEmployee.id),
      "Own preview must contain an actual employer worker");
    assert.ok(ownPreview.json.rows.every(row => row.employeeId !== f.victimEmployee.id),
      "Other employers' workers cannot appear in this preview");
    expectStatus(await request("/api/first-payroll/preview?organizationId=" + victim.id + dates, { cookie }), 403,
      "Existing foreign employer preview must be denied");

    // Progress-only confirmation; never draft, release or remit a payroll.
    const ownProgressPatch = expectStatus(await request("/api/first-payroll/progress", {
      method: "PATCH", cookie,
      body: { organizationId: org.id, key: "company", action: "company_confirm" },
    }), 200, "Company owner may confirm fictional setup progress");
    assert.equal(ownProgressPatch.json?.organizationId, org.id);
    const [storedProgress] = await db.select().from(firstPayrollJourneyProgress)
      .where(eq(firstPayrollJourneyProgress.organizationId, org.id));
    assert.equal(storedProgress?.step, "company", "Owned PATCH must persist a real progress row");
    assert.equal(storedProgress?.updatedByUserId, f.owners[idx].id);

    const ownProgress = expectStatus(await request("/api/first-payroll/progress?organizationId=" + org.id, { cookie }), 200,
      "Owned first-payroll progress must show persisted confirmation");
    assert.equal(ownProgress.json?.organizationId, org.id);
    assert.equal(ownProgress.json?.progress?.completedSteps?.company?.byUserId, f.owners[idx].id);
    expectStatus(await request("/api/first-payroll/progress?organizationId=" + victim.id, { cookie }), 403,
      "Forged victim employer progress GET must be denied");
    expectStatus(await request("/api/first-payroll/progress", {
      method: "PATCH", cookie,
      body: { organizationId: victim.id, key: "company", action: "company_confirm" },
    }), 403, "Forged victim employer progress PATCH must fail before writing");
  }

  const victimProgressAfter = await db.select().from(firstPayrollJourneyProgress)
    .where(eq(firstPayrollJourneyProgress.organizationId, victim.id));
  assert.deepEqual(victimProgressAfter, victimProgressBefore, "Denied progress PATCH leaves victim setup unchanged");
  const victimPayrollAfter = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, victim.id));
  assert.deepEqual(victimPayrollAfter, victimPayrollBefore, "Preview and denied writes leave victim payroll unchanged");
  const victimAuditAfter = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id));
  assert.deepEqual(victimAuditAfter, victimAuditBefore, "Denied victim progress writes cannot add victim audit events");
}

export async function verifyLegalEmployerTenantMutations(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  const victim = f.orgs[0];
  const victimLegalBefore = await db.select().from(legalEntities)
    .where(eq(legalEntities.organizationId, victim.id));
  const victimAuditBefore = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id));

  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    // Synthetic owner session is MFA-verified earlier; no real registrations,
    // bank accounts or external money movement are used.
    const ownLegalPost = expectStatus(await request("/api/legal-entities", {
      method: "POST", cookie, body: {
        organizationId: org.id, code: "CI1302-" + idx,
        legalName: "Fictional employer " + idx, displayName: "Fictional employer " + idx,
      },
    }), 201, "Owned legal-employer creation persists");
    const entityId = ownLegalPost.json?.legalEntity?.id;
    assert.equal(ownLegalPost.json?.legalEntity?.organizationId, org.id);
    const [created] = await db.select().from(legalEntities).where(eq(legalEntities.id, entityId));
    assert.equal(created?.organizationId, org.id, "Created legal entity belongs to the signed-in employer");
    expectStatus(await request("/api/legal-entities", {
      method: "POST", cookie, body: { organizationId: victim.id,
        code: "FORGED-VICTIM-" + idx, legalName: "Forbidden fictional foreign entity" },
    }), 403, "Foreign legal-employer POST is denied");

    const ownLegalPatch = expectStatus(await request("/api/legal-entities", {
      method: "PATCH", cookie, body: { organizationId: org.id, legalEntityId: entityId,
        action: "update_entity", displayName: "Updated fictional employer " + idx },
    }), 200, "Owned legal-employer update persists");
    assert.equal(ownLegalPatch.json?.legalEntity?.organizationId, org.id);
    const [updated] = await db.select().from(legalEntities).where(eq(legalEntities.id, entityId));
    assert.equal(updated?.displayName, "Updated fictional employer " + idx);
    expectStatus(await request("/api/legal-entities", {
      method: "PATCH", cookie, body: { organizationId: victim.id, legalEntityId: f.entities[0].id,
        action: "update_entity", displayName: "Forbidden foreign update" },
    }), 403, "Forged victim organization PATCH must fail");
    expectStatus(await request("/api/legal-entities", {
      method: "PATCH", cookie, body: { organizationId: org.id, legalEntityId: f.entities[0].id,
        action: "update_entity", displayName: "Forbidden cross-entity update" },
    }), 404, "Victim-only legal entity must not resolve inside caller employer");
  }

  const victimLegalAfter = await db.select().from(legalEntities)
    .where(eq(legalEntities.organizationId, victim.id));
  assert.deepEqual(victimLegalAfter, victimLegalBefore, "Denied legal-employer writes leave victim data unchanged");
  const victimAuditAfter = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, victim.id));
  assert.deepEqual(victimAuditAfter, victimAuditBefore, "Denied legal-employer writes leave victim audit trail unchanged");
}
