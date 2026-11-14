/**
 * Flag-ON Separation proof: genuine authenticated HTTP against disposable PG16.
 * One organization, two legal employers, independent maker/checker/releaser.
 * No payment provider, external network action, production DB or bank settlement.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";

function refuseUnsafeEnvironment() {
  assert.equal(process.env.CI, "true", "FICTIONAL_CI_ONLY");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "GITHUB_RUNNER_ONLY");
  assert.equal(process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED, "true");
  assert.equal(process.env.MULTI_ENTITY_ENABLED, "true");
  assert.equal(process.env.FINAL_PAY_MANUAL_RELEASE_ENABLED, "true",
    "Only a disposable money-disabled status-transition fixture may turn on manual release");
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "WORKER_ENABLED"]) {
    assert.equal(process.env[key], "false", key + " must remain disabled");
  }
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
}
refuseUnsafeEnvironment();

const [{ db, pool }, s, { eq }, { priorIntake }, { freezeSeparationIntent }] =
  await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("../../src/lib/year-end-prior-evidence-server.ts"),
    import("../../src/lib/hcm-separation-business-process.ts"),
  ]);

const base = process.env.SECURITY_SMOKE_URL;
function expect(response, code, label) {
  assert.equal(response.status, code,
    label + " expected " + code + " got " + response.status + " " + response.text.slice(0, 400));
  return response.json;
}
async function http(path, cookie, method = "GET", body) {
  const response = await fetch(base + path, {
    method, cache: "no-store", redirect: "manual",
    headers: { cookie, origin: base, "sec-fetch-site": "same-origin",
      "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* retain diagnostic text */ }
  return { status: response.status, json, text };
}
async function newSession(userId) {
  const token = randomBytes(32).toString("hex");
  await db.insert(s.sessions).values({
    userId, tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000),
    lastSeenAt: new Date(), mfaVerifiedAt: new Date(),
  });
  return "__Host-linaw_session=" + token;
}
async function prove() {
  const v = await pool.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(v.rows[0].server_version_num) / 10000), 16);
  assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
    "Use an EMPTY one-time disposable PG16 database");
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const [org] = await db.insert(s.organizations).values({
    name: "FICTIONAL Final Prior " + token, legalName: "Fictional Tax Fixture Inc",
  }).returning();
  const [primary, other] = await db.insert(s.legalEntities).values([
    { organizationId: org.id, code: "PRIMARY", legalName: "Fictional A Employer",
      displayName: "Fixture A", primaryEntity: true },
    { organizationId: org.id, code: "OTHER", legalName: "Fictional B Employer",
      displayName: "Fixture B", primaryEntity: false },
  ]).returning();
  const actors = await db.insert(s.users).values(
    ["maker", "checker", "releaser", "foreign"].map(name => ({
      email: "fp-prior-" + name + "-" + token + "@example.invalid",
      name: "Fictional " + name, role: "owner",
      passwordHash: "no-interactive-login", totpEnabled: true,
    })),
  ).returning();
  await db.insert(s.userOrganizations).values(actors.map(a => ({
    userId: a.id, organizationId: org.id, role: "owner", active: true,
  })));
  await db.insert(s.userLegalEntityGrants).values(actors.map((a, i) => ({
    organizationId: org.id, userId: a.id,
    legalEntityId: i === 3 ? other.id : primary.id,
  })));
  const cookies = await Promise.all(actors.map(a => newSession(a.id)));
  const [worker] = await db.insert(s.employees).values({
    organizationId: org.id, legalEntityId: primary.id,
    employeeNo: "PRIOR-" + token.slice(0, 8),
    firstName: "Fictional", lastName: "Worker", title: "Test Only",
    avatarInitials: "FW", basicRate: "30000.00",
    startDate: "2026-07-01", region: "NCR", mwe: false,
  }).returning();
  await db.insert(s.employeePayProfiles).values({
    organizationId: org.id, employeeId: worker.id, payBasis: "monthly",
    rateAmount: "30000.00", standardWorkDaysPerMonth: "22.00",
    standardHoursPerDay: "8.00",
  });
  const prior = {
    status: "verified", employerName: "Fictional Former Employer",
    employerTin: "123456789-0000", periodFrom: "2026-01-01", periodTo: "2026-06-30",
    taxableIncome: "240000.00", taxWithheld: "200.00",
    exemptBenefits: "0.00", sourceReference: "FIXTURE-FORM2316-" + token,
    sourceSha256: createHash("sha256").update("FIXTURE-" + token).digest("hex"),
    peraCredit: "0.00", peraReference: "", peraSha256: "",
  };
  const scope = { organizationId: org.id, employeeId: worker.id, taxYear: 2026 };
  await priorIntake(scope, actors[0], {
    action: "save", evidence: prior, expectedDigest: "",
  });
  const saved = await priorIntake(scope, actors[0]);
  assert.ok(saved?.digest);
  await priorIntake(scope, actors[1], {
    action: "approve", expectedDigest: saved.digest,
  });
  const [priorRow] = await db.select().from(s.yearEndPriorEvidence)
    .where(eq(s.yearEndPriorEvidence.employeeId, worker.id));
  assert.ok(priorRow?.approvedAt);
  assert.notEqual(priorRow.makerUserId, priorRow.checkerUserId);

  const lastDay = "2026-10-09", noticeDate = "2026-09-20";
  await db.insert(s.hcmBusinessProcessInstances).values({
    organizationId: org.id, definitionCode: "fictional-preapproved-separation",
    definitionVersion: 1, processType: "termination",
    sourceType: "separation_initiation",
    sourceKey: String(worker.id) + ":" + token, employeeId: worker.id,
    effectiveDate: lastDay, status: "approved",
    initiatedByUserId: actors[0].id, initiatedByName: actors[0].name,
    definitionSnapshot: { sourceEvidence: freezeSeparationIntent({
      organizationId: org.id, employeeId: worker.id,
      employeeStatus: "Active", employeeOrgUnitId: null,
      employeeStartDate: "2026-07-01",
      employmentTermDecisionId: null, separationType: "resignation",
      noticeDate, lastDay,
    }) },
  });

  const payload = {
    organizationId: org.id, employeeId: worker.id,
    separationType: "resignation", noticeDate, lastDay,
    unpaidBasicSalary: 15000, finalStatutoryReviewed: true,
    finalStatutoryDeductions: 0,
  };
  const created = expect(await http("/api/separation", cookies[0], "POST", payload),
    201, "Approved prior Form 2316 Separation POST");
  const id = created.id;
  assert.ok(Number.isInteger(id) && id > 0);
  const frozen = created.computationSnapshot?.priorEmployerEvidence;
  assert.equal(frozen?.digest, saved.digest);
  assert.equal(frozen?.revision, priorRow.revision);
  assert.equal(Number(created.prorated13thMonth), 1250);
  assert.equal(Number(created.taxDue), 750);
  assert.equal(Number(created.netFinalPay), 15700);
  assert.equal(created.computationSnapshot?.annualization?.taxWithheld, 0,
    "Prior WHT must not be current-employer withholding");

  const owned = expect(await http("/api/separation?organizationId=" + org.id, cookies[0]),
    200, "Owned employer GET");
  assert.ok(owned.separations.some(row => row.id === id));
  const unrelated = expect(await http("/api/separation?organizationId=" + org.id, cookies[3]),
    200, "Same-org foreign-entity GET returns only authorized employer rows");
  assert.equal(unrelated.separations.some(row => row.id === id), false,
    "Different legal employer must never see detailed final-pay calculation");
  expect(await http("/api/separation?organizationId=" + org.id + "&legalEntityId=" + primary.id, cookies[3]),
    403, "Foreign same-org user cannot select victim legal employer");
  const beforeDenials = await db.select().from(s.separationRecords)
    .where(eq(s.separationRecords.id, id));
  expect(await http("/api/separation", cookies[3], "POST", payload),
    403, "Foreign same-org Separation POST");
  expect(await http("/api/separation", cookies[3], "PATCH", {
    id, action: "approve",
  }), 403, "Foreign same-org Separation PATCH");
  const afterDenials = await db.select().from(s.separationRecords)
    .where(eq(s.separationRecords.id, id));
  assert.deepEqual(afterDenials, beforeDenials);

  for (const field of ["itCleared", "adminCleared", "financeCleared", "hrCleared"]) {
    expect(await http("/api/separation", cookies[1], "PATCH", {
      id, action: "clearance", [field]: true, previousValue: false,
      clearanceEvidenceReference: "FIXTURE-" + field,
      clearanceReason: "Fictional department clearance only; no outside action",
    }), 200, "Independent reviewer " + field + " clearance");
  }
  await db.update(s.yearEndPriorEvidence).set({ revision: priorRow.revision + 1 })
    .where(eq(s.yearEndPriorEvidence.id, priorRow.id));
  const stale = expect(await http("/api/separation", cookies[1], "PATCH", {
    id, action: "approve",
  }), 409, "Changed prior-2316 revision is blocked");
  assert.equal(stale.code, "FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED");
  const notApproved = await db.select().from(s.separationRecords)
    .where(eq(s.separationRecords.id, id));
  assert.equal(notApproved[0].status, "draft");
  // Restore only a synthetic injected revision in the disposable fixture.
  await db.update(s.yearEndPriorEvidence).set({ revision: priorRow.revision })
    .where(eq(s.yearEndPriorEvidence.id, priorRow.id));
  const approved = expect(await http("/api/separation", cookies[1], "PATCH", {
    id, action: "approve",
  }), 200, "Distinct checker approves immutable prior-based final pay");
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedByUserId, actors[1].id);
  const released = expect(await http("/api/separation", cookies[2], "PATCH", {
    id, action: "release",
    releaseReference: "FIXTURE-NO-BANK-TRANSFER-" + token,
  }), 200, "Third distinct actor releases fictional database status only");
  assert.equal(released.status, "released");
  assert.equal(released.releasedByUserId, actors[2].id);
  assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, org.id))).length, 0,
    "No payroll payout run or bank provider is involved");

  console.log("FINAL_PAY_PRIOR_EMPLOYER_FLAG_ON_HTTP_PROOF " + JSON.stringify({
    case: "fictional PostgreSQL 16 + real authenticated HTTP",
    sameOrganizationTwoLegalEmployers: true,
    reviewedPriorEvidence: true, independentEvidenceChecker: true,
    verifiedTaxDue: 750, verifiedNetFinalPay: 15700,
    foreignReadHidden: true, foreignPostDenied: true, foreignPatchDenied: true,
    changedEvidenceApprovalDenied: true,
    independentFinancialChecker: true, thirdReleaseActor: true,
    fictionalDbStatusOnly: true, bankSettlement: false,
    externalProvider: false, productionFlagEnabled: false,
    independentlyTaxAndSecurityApproved: false, tenantMethodCredits: 0,
  }));
}
try { await prove(); }
finally { await pool.end(); }
