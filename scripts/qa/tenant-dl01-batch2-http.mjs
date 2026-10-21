/**
 * DL-01 follow-on real HTTP/PG16 proof. The application server and PostgreSQL
 * database are disposable localhost CI fixtures, never production resources.
 * Credit four method-specific proofs only after exact-head PG16 HTTP success,
 * source-line reconciliation and renewed CI; no global tenant acceptance.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, employees, payrollRuns,
  statutoryContributionIssueCases, statutoryContributionIssueEvents,
  statutoryRemittanceBatches, statutoryRemittanceMembers,
  statutoryPostingEvidenceArtifacts,
} from "../../src/db/schema";

export const DL01_BATCH2_METHODS = Object.freeze([
  "POST compliance/statutory-remittances/posting-import",
  "GET compliance/contribution-issues/evidence",
  "GET compliance/labor-inspection/evidence-pack",
  "GET exports",
  "GET bi-exports",
]);

function requireDisposable() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  const app = new URL(process.env.SECURITY_SMOKE_URL);
  const pg = new URL(process.env.DATABASE_URL);
  assert.equal(app.href, "http://127.0.0.1:3000/");
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["127.0.0.1", "localhost"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function victimSnapshot(organizationId) {
  const filter = (table) => eq(table.organizationId, organizationId);
  const [batches, members, posting, cases, events, audit, runs, staff] = await Promise.all([
    db.select().from(statutoryRemittanceBatches).where(filter(statutoryRemittanceBatches)).orderBy(statutoryRemittanceBatches.id),
    db.select().from(statutoryRemittanceMembers).where(filter(statutoryRemittanceMembers)).orderBy(statutoryRemittanceMembers.id),
    db.select().from(statutoryPostingEvidenceArtifacts).where(filter(statutoryPostingEvidenceArtifacts)).orderBy(statutoryPostingEvidenceArtifacts.id),
    db.select().from(statutoryContributionIssueCases).where(filter(statutoryContributionIssueCases)).orderBy(statutoryContributionIssueCases.id),
    db.select().from(statutoryContributionIssueEvents).where(filter(statutoryContributionIssueEvents)).orderBy(statutoryContributionIssueEvents.id),
    db.select().from(auditEvents).where(filter(auditEvents)).orderBy(auditEvents.id),
    db.select().from(payrollRuns).where(filter(payrollRuns)).orderBy(payrollRuns.id),
    db.select().from(employees).where(filter(employees)).orderBy(employees.id),
  ]);
  return { batches, members, posting, cases, events, audit, runs, staff };
}

async function seedPostingAndCases(f) {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const realOwnWorkers = await Promise.all(f.ownedEmployees.map(async (worker) => {
    const [row] = await db.select().from(employees).where(eq(employees.id, worker.id)).limit(1);
    assert.ok(row?.employeeNo && row?.organizationId);
    return row;
  }));
  const owners = [
    ...Array.from({ length: 8 }, (_, i) => ({ index: 0, month: "2024-0" + (i + 1), worker: f.victimEmployees[i] })),
    { index: 1, month: "2024-09", worker: realOwnWorkers[0] },
    { index: 2, month: "2024-10", worker: realOwnWorkers[1] },
    { index: 0, month: "2024-11", worker: f.victimEmployee },
  ];
  const batches = await db.insert(statutoryRemittanceBatches).values(owners.map((row, i) => ({
    organizationId: f.orgs[row.index].id,
    legalEntityId: f.entities[row.index].id,
    agency: "SSS", applicableMonth: row.month, dueDate: "2024-12-15",
    status: "paid", employeeCount: 1,
    expectedEmployeeShare: "40.00", expectedEmployerShare: "60.00",
    expectedTotal: "100.00", amountPaid: "100.00",
    snapshotHash: sha256("dl01-real-posting-" + nonce + "-" + i),
    createdBy: "Fictional isolated CI only",
  }))).returning();
  const members = await db.insert(statutoryRemittanceMembers).values(owners.map((row, i) => ({
    organizationId: f.orgs[row.index].id,
    legalEntityId: f.entities[row.index].id,
    batchId: batches[i].id, employeeId: row.worker.id,
    employeeNo: row.worker.employeeNo,
    employeeShare: "40.00", employerShare: "60.00", totalContribution: "100.00",
    postingStatus: "pending",
  }))).returning();
  const cases = await db.insert(statutoryContributionIssueCases).values(owners.map((row, i) => ({
    organizationId: f.orgs[row.index].id, legalEntityId: f.entities[row.index].id,
    employeeId: row.worker.id, batchId: batches[i].id, remittanceMemberId: members[i].id,
    agency: "SSS", applicableMonth: row.month, issueType: "wrong_posted_amount",
    description: "Synthetic evidence only " + nonce + "-" + i,
    employeeSnapshot: { source: "dl01-disposable-pg16", secretMarker: row.index === 0 ? "VICTIM-CASE-" + nonce : "OWN-CASE-" + nonce, memberId: members[i].id },
    reportedByName: "Fictional CI reviewer",
  }))).returning();
  await db.insert(statutoryContributionIssueEvents).values(owners.map((row, i) => ({
    organizationId: f.orgs[row.index].id,
    caseId: cases[i].id, employeeId: row.worker.id,
    eventType: "reported", visibility: "employee",
    message: "Synthetic case timeline " + nonce + "-" + i,
    actorName: "Fictional CI reviewer",
  })));

  const victimOrg = f.orgs[0];
  // Both victim-only export targets are inserted AFTER each attacker's
  // existing employee/payroll IDs. A low-ID victim can mask enumeration bugs.
  const [victimExportWorker] = await db.insert(employees).values({
    organizationId: victimOrg.id, legalEntityId: f.entities[0].id,
    employeeNo: "VICTIM-HIGH-ID-" + nonce, firstName: "LaterVictim",
    lastName: "Only", title: "Disposable QA worker", avatarInitials: "LV",
    basicRate: "21000.00", startDate: "2026-10-01",
  }).returning();
  const [victimBiRun] = await db.insert(payrollRuns).values({
    organizationId: victimOrg.id, legalEntityId: f.entities[0].id,
    periodLabel: "VICTIM-ONLY-BI-" + nonce,
    periodStart: "2026-10-01", periodEnd: "2026-10-15",
    payDate: "2026-10-16", status: "Released",
  }).returning();
  const [persistedVictimWorker] = await db.select().from(employees)
    .where(eq(employees.id, victimExportWorker.id)).limit(1);
  const [persistedVictimBiRun] = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.id, victimBiRun.id)).limit(1);
  assert.equal(persistedVictimWorker?.organizationId, victimOrg.id);
  assert.equal(persistedVictimBiRun?.organizationId, victimOrg.id);
  assert.ok(victimExportWorker.id > f.ownedEmployees[0].id &&
    victimExportWorker.id > f.ownedEmployees[1].id && victimExportWorker.id > 6,
    "The real victim-only worker must be higher-ID than both attackers' workers");
  assert.ok(victimBiRun.id > f.ownRuns[1].id &&
    victimBiRun.id > f.ownRuns[2].id && victimBiRun.id > 6,
    "The real victim-only BI payroll run must be higher-ID than both attackers' runs");
  const victimBatch = batches[10];
  const victimMember = members[10];
  const victimCase = cases[10];
  const persistedVictimBatch = (await db.select().from(statutoryRemittanceBatches)
    .where(eq(statutoryRemittanceBatches.id, victimBatch.id)).limit(1))[0];
  const persistedVictimMember = (await db.select().from(statutoryRemittanceMembers)
    .where(eq(statutoryRemittanceMembers.id, victimMember.id)).limit(1))[0];
  const persistedVictimCase = (await db.select().from(statutoryContributionIssueCases)
    .where(eq(statutoryContributionIssueCases.id, victimCase.id)).limit(1))[0];
  assert.equal(persistedVictimBatch?.organizationId, victimOrg.id);
  assert.equal(persistedVictimMember?.organizationId, victimOrg.id);
  assert.equal(persistedVictimCase?.organizationId, victimOrg.id);
  for (const idx of [8, 9]) {
    assert.ok(victimBatch.id > batches[idx].id && victimMember.id > members[idx].id
      && victimCase.id > cases[idx].id && victimBatch.id > 6 && victimCase.id > 6,
    "Victim-only target IDs must be real later-created PostgreSQL rows");
  }
  return { nonce, owners, batches, members, cases, victimBatch, victimMember, victimCase,
    victimExportWorker, victimBiRun };
}

function postingCsv(employeeNo, nonce, idx) {
  return "employee_no,posted_amount,posting_reference,posted_at\n" +
    employeeNo + ",100.00,FICTIONAL-POST-" + nonce + "-" + idx + ",2024-10-11\n";
}

export async function verifyDl01Batch2(f, { request, expectStatus }) {
  requireDisposable();
  assert.equal(new Set(f.orgs.map(x => x.id)).size, 3);
  const fixture = await seedPostingAndCases(f);
  const victimOrg = f.orgs[0];
  const victimMarker = "VICTIM-CASE-" + fixture.nonce;
  const before = await victimSnapshot(victimOrg.id);
  const receipts = [];

  for (const idx of [1, 2]) {
    const ownOrg = f.orgs[idx];
    const ownedBatch = fixture.batches[7 + idx];
    const ownedMember = fixture.members[7 + idx];
    const ownedCase = fixture.cases[7 + idx];
    const cookie = f.ownerSessions[idx].cookie;
    const worker = fixture.owners[7 + idx].worker;
    const csv = postingCsv(worker.employeeNo, fixture.nonce, idx);
    assert.equal(ownedBatch.organizationId, ownOrg.id);
    assert.equal(ownedMember.organizationId, ownOrg.id);
    assert.equal(ownedCase.organizationId, ownOrg.id);
    assert.ok(fixture.victimExportWorker.id > worker.id);
    assert.ok(fixture.victimBiRun.id > f.ownRuns[idx].id);

    const account = expectStatus(await request("/api/account", { cookie }), 200,
      "Authenticated independent DL-01 attacker session");
    assert.equal(account.json?.profile?.id, f.owners[idx].id);

    // A real successful POST must persist one own member posting; dryRun 200,
    // malformed CSV, missing MFA, rate-limit 429 and disabled 501 do NOT qualify.
    const ownPosting = expectStatus(await request("/api/compliance/statutory-remittances/posting-import", {
      method: "POST", cookie, body: {
        organizationId: ownOrg.id, batchId: ownedBatch.id,
        csv, fileName: "fictional-" + fixture.nonce + "-" + idx + ".csv",
        dryRun: false, openMismatchCases: false,
        employeeId: f.victimEmployee.id, legalEntityId: f.entities[0].id,
        runId: f.victimRun.id, caseId: fixture.victimCase.id,
      },
    }), 200, "DL-01 posting-import own valid CSV POST must APPLY");
    assert.equal(ownPosting.json?.applied, true);
    assert.equal(ownPosting.json?.dryRun, false);
    assert.equal(ownPosting.json?.batchId, ownedBatch.id);
    assert.equal(ownPosting.json?.validRows, 1);
    assert.equal(ownPosting.json?.fileHash, sha256(csv));
    const [posted] = await db.select().from(statutoryRemittanceMembers)
      .where(eq(statutoryRemittanceMembers.id, ownedMember.id)).limit(1);
    const [artifact] = await db.select().from(statutoryPostingEvidenceArtifacts)
      .where(and(eq(statutoryPostingEvidenceArtifacts.organizationId, ownOrg.id),
        eq(statutoryPostingEvidenceArtifacts.batchId, ownedBatch.id),
        eq(statutoryPostingEvidenceArtifacts.id, ownPosting.json.evidenceArtifactId))).limit(1);
    assert.equal(posted?.organizationId, ownOrg.id);
    assert.equal(posted?.employeeId, worker.id);
    assert.equal(posted?.postingStatus, "confirmed");
    assert.equal(posted?.postingReference, "FICTIONAL-POST-" + fixture.nonce + "-" + idx);
    assert.equal(posted?.postingEvidenceArtifactId, artifact?.id);
    assert.equal(artifact?.contentSha256, sha256(csv));
    assert.equal(Buffer.from(artifact.fileDataBase64, "base64").toString("utf8"), csv);
    assert.equal(artifact?.outcome, "applied");

    const foreignPosting = expectStatus(await request("/api/compliance/statutory-remittances/posting-import", {
      method: "POST", cookie, body: {
        organizationId: victimOrg.id, batchId: fixture.victimBatch.id,
        csv: postingCsv(f.victimEmployee.employeeNo, fixture.nonce, 0),
        fileName: "victim-only-" + fixture.nonce + ".csv", dryRun: false,
        employeeId: f.victimEmployee.id, legalEntityId: f.entities[0].id,
      },
    }), 403, "DL-01 real victim employer posting-import POST explicitly denied");
    assert.ok(!foreignPosting.text.includes(victimMarker));
    const forgedPosting = expectStatus(await request("/api/compliance/statutory-remittances/posting-import", {
      method: "POST", cookie, body: {
        organizationId: ownOrg.id, batchId: fixture.victimBatch.id,
        csv: postingCsv(f.victimEmployee.employeeNo, fixture.nonce, 0),
        dryRun: false, employeeId: f.victimEmployee.id,
        legalEntityId: f.entities[0].id, runId: f.victimRun.id,
      },
    }), 404, "DL-01 real victim batch under attacker's authorized employer must be 404");
    assert.ok(!forgedPosting.text.includes(victimMarker));

    const ownExport = expectStatus(await request("/api/exports?organizationId=" + ownOrg.id +
      "&kind=employees", { cookie }), 200, "DL-01 real own-employer employee CSV export");
    assert.match(ownExport.headers.get("content-type") ?? "", /^text\/csv/i);
    assert.match(ownExport.headers.get("content-disposition") ?? "", /attachment/i);
    assert.ok(ownExport.text.includes(worker.employeeNo) && ownExport.text.includes(worker.firstName),
      "Own export must include the real seeded employee, not just a CSV header");
    assert.ok(!ownExport.text.includes(fixture.victimExportWorker.employeeNo));
    const foreignExport = expectStatus(await request("/api/exports?organizationId=" + victimOrg.id +
      "&kind=employees", { cookie }), 403, "DL-01 foreign employer employee CSV export forbidden");
    assert.ok(!foreignExport.text.includes(fixture.victimExportWorker.employeeNo));
    const forgedExport = expectStatus(await request("/api/exports?organizationId=" + ownOrg.id +
      "&kind=employees&employeeId=" + fixture.victimExportWorker.id + "&legalEntityId=" +
      f.entities[0].id + "&runId=" + fixture.victimBiRun.id, { cookie }), 200,
    "DL-01 forged victim selectors cannot change own employee export");
    assert.equal(forgedExport.text, ownExport.text);

    const biUrl = "/api/bi-exports?organizationId=" + ownOrg.id +
      "&key=payroll_runs&format=csv&startDate=2026-10-01&endDate=2026-10-31";
    const ownBi = expectStatus(await request(biUrl, { cookie }), 200,
      "DL-01 real own employer BI payroll-run export");
    assert.match(ownBi.headers.get("content-type") ?? "", /text\/csv/i);
    assert.ok(ownBi.text.includes(String(f.ownRuns[idx].id)) &&
      ownBi.text.includes("ATTACKER-"), "BI file must contain an existing own payroll run");
    assert.ok(!ownBi.text.includes(fixture.victimBiRun.periodLabel));
    const foreignBi = expectStatus(await request(biUrl.replace("organizationId=" + ownOrg.id,
      "organizationId=" + victimOrg.id), { cookie }), 403,
      "DL-01 foreign employer BI payroll-run export denied");
    assert.ok(!foreignBi.text.includes(fixture.victimBiRun.periodLabel));
    const forgedBi = expectStatus(await request(biUrl + "&legalEntityId=" + f.entities[0].id +
      "&runId=" + fixture.victimBiRun.id,
      { cookie }), 400, "DL-01 own BI export with real victim legal entity rejected");
    assert.ok(!forgedBi.text.includes(fixture.victimBiRun.periodLabel));

    const ownCase = expectStatus(await request("/api/compliance/contribution-issues/evidence?organizationId=" +
      ownOrg.id + "&caseId=" + ownedCase.id, { cookie }), 200,
    "DL-01 signed-in own contribution issue evidence attachment");
    assert.equal(ownCase.json?.case?.caseId, ownedCase.id);
    assert.equal(ownCase.json?.case?.employeeId, worker.id);
    assert.equal(ownCase.json?.reportedSnapshot?.memberId, ownedMember.id);
    assert.ok(ownCase.json?.timeline?.length >= 1, "Own issue evidence must include a real persisted event");
    assert.match(ownCase.json?.evidenceHashSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(ownCase.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.ok(!ownCase.text.includes(victimMarker));
    const foreignCase = expectStatus(await request("/api/compliance/contribution-issues/evidence?organizationId=" +
      victimOrg.id + "&caseId=" + fixture.victimCase.id, { cookie }), 403,
    "DL-01 real victim-only contribution case evidence forbidden");
    assert.ok(!foreignCase.text.includes(victimMarker));
    const forgedCase = expectStatus(await request("/api/compliance/contribution-issues/evidence?organizationId=" +
      ownOrg.id + "&caseId=" + ownedCase.id + "&employeeId=" + f.victimEmployee.id +
      "&batchId=" + fixture.victimBatch.id + "&legalEntityId=" + f.entities[0].id, { cookie }), 200,
    "DL-01 forged victim employee/batch/entity cannot alter actual own case evidence");
    assert.equal(forgedCase.json?.case?.caseId, ownedCase.id);
    assert.equal(forgedCase.json?.reportedSnapshot?.memberId, ownedMember.id);
    const wrongScopedCase = expectStatus(await request("/api/compliance/contribution-issues/evidence?organizationId=" +
      ownOrg.id + "&caseId=" + fixture.victimCase.id, { cookie }), 404,
    "DL-01 existing victim case ID must not resolve under own authorized employer");
    assert.ok(!wrongScopedCase.text.includes(victimMarker));

    const ownInspection = expectStatus(await request("/api/compliance/labor-inspection/evidence-pack?organizationId=" +
      ownOrg.id, { cookie }), 200, "DL-01 actual own labor inspection evidence pack");
    assert.equal(ownInspection.json?.organization?.id, ownOrg.id);
    assert.ok(ownInspection.json?.sections?.workerRoster?.rowCount > 0);
    assert.ok(ownInspection.json.sections.workerRoster.rows.some(row => row.employeeNo === worker.employeeNo),
      "Own inspection pack must include a real PostgreSQL worker, not an empty report");
    assert.ok(!ownInspection.text.includes(fixture.victimExportWorker.employeeNo));
    assert.match(ownInspection.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(ownInspection.headers.get("x-payrollph-evidence-sha256"), ownInspection.json?.snapshot?.sha256);
    const foreignInspection = expectStatus(await request("/api/compliance/labor-inspection/evidence-pack?organizationId=" +
      victimOrg.id, { cookie }), 403, "DL-01 other employer labor inspection pack forbidden");
    assert.ok(!foreignInspection.text.includes(fixture.victimExportWorker.employeeNo));
    const forgedInspection = expectStatus(await request("/api/compliance/labor-inspection/evidence-pack?organizationId=" +
      ownOrg.id + "&employeeId=" + fixture.victimExportWorker.id + "&legalEntityId=" +
      f.entities[0].id + "&caseId=" + fixture.victimCase.id, { cookie }), 200,
    "DL-01 real victim selectors must not change own inspection pack");
    assert.equal(forgedInspection.json?.organization?.id, ownOrg.id);
    assert.deepEqual(forgedInspection.json?.sections?.workerRoster?.rows,
      ownInspection.json?.sections?.workerRoster?.rows);

    const after = await victimSnapshot(victimOrg.id);
    assert.deepEqual(after, before, "DL-01 write/read/forged attempts must leave actual victim batches, members, artifacts, cases, timeline, payroll and audit unchanged");
    receipts.push({
      attacker: idx, actorUserId: f.owners[idx].id, ownBatchId: ownedBatch.id,
      ownMemberId: ownedMember.id, ownCaseId: ownedCase.id,
      victimBatchId: fixture.victimBatch.id, victimCaseId: fixture.victimCase.id,
      ownPostingApplied: true, foreignPostingDenied: 403, forgedBatchDenied: 404,
      ownDownloads: 4, foreignDownloadsDenied: 4, forgedSelectorsChecked: true,
      unchangedVictimDatabase: true,
    });
    console.log("PASS DL-01 follow-on POST posting-import and four real GET exports for attacker " + idx);
  }
  assert.equal(receipts.length, 2, "Both independent attackers must execute every real method");
  console.log(JSON.stringify({ kind: "DISPOSABLE_PG16_DL01_BATCH2_REAL_HTTP",
    methods: DL01_BATCH2_METHODS, receipts, syntheticOnly: true,
    accepted: false, actualFundsMoved: false, humanUatAccepted: false }));
}
