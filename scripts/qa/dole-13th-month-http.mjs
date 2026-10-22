/**
 * Executed from tenant-second-pass-http against disposable PG16 only.
 * Establishes a real victim profile and portal row before GET/POST probes.
 * No external submission, payment or live database action is permitted.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { doleReportingProfiles, doleComplianceSubmissions, employees } from "../../src/db/schema";

export async function verifyDoleReportTenantIsolation(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      !/^postgresql:\/\/[^/]+@(127\.0\.0\.1|localhost):5432\/app_db$/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("DOLE probes require disposable localhost PostgreSQL.");
  }
  const victim = f.orgs[0];
  await db.insert(doleReportingProfiles).values({
    organizationId: victim.id, establishmentAddress: "PRIVATE VICTIM ADDRESS",
    principalBusiness: "Fictional victim business",
    contactName: "Fictional Victim Contact", contactPosition: "Manager",
    contactPhone: "0000000000",
  });
  await db.insert(doleComplianceSubmissions).values({
    organizationId: victim.id, reportType: "13th_month_pay",
    reportYear: 2026, reportHash: "f".repeat(64),
    portalReference: "VICTIM-ONLY-SYNTHETIC-REFERENCE",
    submittedAt: new Date("2026-10-15T00:00:00.000Z"),
    recordedByUserId: f.owners[0].id, recordedByName: "Fictional Victim Owner",
  });
  const victimProfilesBefore = await db.select().from(doleReportingProfiles)
    .where(eq(doleReportingProfiles.organizationId, victim.id));
  const victimSubmissionsBefore = await db.select().from(doleComplianceSubmissions)
    .where(eq(doleComplianceSubmissions.organizationId, victim.id));
  assert.ok(victimProfilesBefore.length > 0 && victimSubmissionsBefore.length > 0,
    "Victim must have genuine stored synthetic evidence, not empty placeholders");

  for (const idx of [1, 2]) {
    const employer = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const [ownEmployee] = await db.select({ employeeNo: employees.employeeNo }).from(employees)
      .where(and(eq(employees.organizationId, employer.id),
        eq(employees.id, f.ownedEmployees[idx - 1].id))).limit(1);
    assert.ok(ownEmployee?.employeeNo, "Own seeded employee must exist");

    const ownDoleRead = expectStatus(await request("/api/compliance/dole-13th-month?organizationId=" +
      employer.id + "&taxYear=2026", { cookie }), 200,
      "Real own-employer DOLE report GET must succeed in legacy mode");
    assert.equal(ownDoleRead.json?.organizationId, employer.id);
    assert.equal(ownDoleRead.json?.organization?.id, employer.id);
    assert.ok(ownDoleRead.json?.report?.employees?.some(e => e.employeeNo === ownEmployee.employeeNo),
      "Positive control must contain own payroll employee");
    assert.ok(!ownDoleRead.text.includes("VICTIM-ONLY-SYNTHETIC-REFERENCE") &&
      !ownDoleRead.text.includes("PRIVATE VICTIM ADDRESS"), "No foreign submission/profile data");
    expectStatus(await request("/api/compliance/dole-13th-month?organizationId=" + victim.id +
      "&taxYear=2026", { cookie }), 403, "Attacker must not read victim-only DOLE report");
    expectStatus(await request(
      "/api/compliance/dole-13th-month?organizationId=" + victim.id + "&taxYear=2026&format=csv",
      { cookie },
    ), 403, "Attacker must not download victim-only DOLE worksheet");

    const ownDoleProfile = expectStatus(await request("/api/compliance/dole-13th-month", {
      method: "POST", cookie,
      body: { organizationId: employer.id, taxYear: 2026, action: "save_profile",
        establishmentAddress: "OWN FICTIONAL ADDRESS", principalBusiness: "Fictional business",
        contactName: "Owned Contact", contactPosition: "Payroll", contactPhone: "0000000000" },
    }), 200, "Authorized own-employer DOLE profile update");
    assert.equal(ownDoleProfile.json?.profile?.organizationId, employer.id);
    expectStatus(await request("/api/compliance/dole-13th-month", {
      method: "POST", cookie,
      body: { organizationId: victim.id, taxYear: 2026, action: "save_profile",
        establishmentAddress: "FORGED VICTIM ADDRESS", principalBusiness: "Forged business",
        contactName: "Forged Contact", contactPosition: "Intruder", contactPhone: "9999999999" },
    }), 403, "Foreign employer DOLE profile mutation must be denied");
    expectStatus(await request("/api/compliance/dole-13th-month", {
      method: "POST", cookie,
      body: { organizationId: victim.id, taxYear: 2026, action: "record_submission",
        portalReference: "FORGED VICTIM SUBMISSION", submittedAt: "2026-10-15" },
    }), 403, "Foreign DOLE portal attestation must be denied");
  }
  const victimProfilesAfter = await db.select().from(doleReportingProfiles)
    .where(eq(doleReportingProfiles.organizationId, victim.id));
  const victimSubmissionsAfter = await db.select().from(doleComplianceSubmissions)
    .where(eq(doleComplianceSubmissions.organizationId, victim.id));
  assert.deepEqual(victimProfilesAfter, victimProfilesBefore, "Victim DOLE profile unchanged after cross-employer attacks");
  assert.deepEqual(victimSubmissionsAfter, victimSubmissionsBefore, "Victim DOLE submission unchanged after cross-employer attacks");
}
