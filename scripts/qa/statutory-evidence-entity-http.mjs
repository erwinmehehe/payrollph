/**
 * PR #1344: Three exact statutory evidence GET methods, authenticated HTTP
 * against a disposable localhost PostgreSQL 16 database. Two foreign tenants,
 * two legal employers within one tenant, real high-ID victim artifacts, and
 * exact before/after database assertions. Never production acceptance.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, employees, legalEntities, organizations, payrollRuns, sessions,
  statutoryContributionIssueCases, statutoryPostingEvidenceArtifacts,
  statutoryRemittanceBatches, statutoryRemittancePaymentEvidence,
  userLegalEntityGrants, userOrganizations, users,
} from "../../src/db/schema";
import { evidenceHash } from "../../src/lib/statutory-contribution-evidence-pack";

const BASE = process.env.STATUTORY_EVIDENCE_URL;
const flagOn = process.env.MULTI_ENTITY_ENABLED === "true";
let assertions = 0;

function check(value, message) { assert.ok(value, message); assertions++; }
function equals(actual, expected, message) { assert.equal(actual, expected, message); assertions++; }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function requireDisposable() {
  equals(process.env.GITHUB_ACTIONS, "true", "GitHub Actions-only proof");
  equals(process.env.CI, "true", "CI-only proof");
  equals(process.env.STATUTORY_EVIDENCE_PROOF_MODE, "isolated-pg16-only", "Expected proof mode");
  const app = new URL(BASE ?? "");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  equals(app.href, "http://127.0.0.1:3017/", "Only disposable localhost app accepted");
  equals(process.env.APP_BASE_URL, "http://127.0.0.1:3017", "App origin must be localhost");
  equals(dbUrl.href, "postgresql://postgres:postgres@127.0.0.1:5432/app_db", "Only disposable app_db accepted");
  equals(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false", "No PayMongo payouts");
  equals(process.env.XENDIT_PAYOUTS_ENABLED, "false", "No Xendit payouts");
  equals(process.env.REQUIRE_PRIVILEGED_MFA, "true", "MFA enabled during real HTTP");
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    check(!process.env[name], "No live payment credentials: " + name);
  }
}
async function request(path, cookie, headers = {}) {
  const response = await fetch(new URL(path, BASE), {
    method: "GET", headers: { cookie, ...headers }, redirect: "manual", cache: "no-store",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  let json = null;
  try { json = JSON.parse(text); } catch { /* Expected for PDF and CSV */ }
  return { status: response.status, bytes, text, json, headers: response.headers };
}
function status(response, expected, label) {
  equals(response.status, expected, label + ": " + response.text.slice(0, 220));
  return response;
}
async function makeActor(org, label, nonce) {
  const [user] = await db.insert(users).values({
    email: "evidence-" + label + "-" + nonce + "@example.invalid",
    name: "Fictional " + label, role: "owner", passwordHash: "no-password-fixture",
    totpEnabled: true,
  }).returning({ id: users.id, name: users.name });
  await db.insert(userOrganizations).values({
    userId: user.id, organizationId: org.id, role: "owner", active: true,
  });
  const raw = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    userId: user.id, tokenHash: digest(raw), expiresAt: new Date(Date.now() + 3600000),
    lastSeenAt: new Date(), mfaVerifiedAt: new Date(), authMethod: "oidc",
  });
  return { ...user, cookie: "__Host-linaw_session=" + raw };
}
async function makeEmployee(org, entity, name, nonce) {
  const [employee] = await db.insert(employees).values({
    organizationId: org.id, legalEntityId: entity.id,
    employeeNo: "EVID-" + name + "-" + nonce,
    firstName: "Fictional", lastName: name, title: "Synthetic",
    avatarInitials: "QA", basicRate: "20000.00", startDate: "2026-01-01",
  }).returning({ id: employees.id, employeeNo: employees.employeeNo });
  return employee;
}
async function makeArtifacts(org, entity, employee, actor, tag, nonce, count = 1) {
  const items = [];
  for (let k = 0; k < count; k++) {
    const month = "2026-" + String(k + 1).padStart(2, "0");
    const sentinel = "QA-EVIDENCE-" + tag + "-" + nonce + "-" + k;
    const [batch] = await db.insert(statutoryRemittanceBatches).values({
      organizationId: org.id, legalEntityId: entity.id, agency: "SSS",
      applicableMonth: month, dueDate: month + "-20",
      snapshotHash: digest(sentinel), createdBy: actor.name,
    }).returning({ id: statutoryRemittanceBatches.id });
    const [issue] = await db.insert(statutoryContributionIssueCases).values({
      organizationId: org.id, legalEntityId: entity.id, employeeId: employee.id,
      batchId: batch.id, agency: "SSS", applicableMonth: month,
      issueType: "missing_contribution", description: sentinel,
      employeeSnapshot: { employeeNo: employee.employeeNo, sentinel },
      reportedByName: actor.name,
    }).returning({ id: statutoryContributionIssueCases.id });
    const paymentBytes = Buffer.from(sentinel + "-PAYMENT-PDF-BYTES");
    const [payment] = await db.insert(statutoryRemittancePaymentEvidence).values({
      organizationId: org.id, batchId: batch.id, fileName: tag + "-" + k + ".pdf",
      mimeType: "application/pdf", byteSize: paymentBytes.length,
      fileSha256: digest(paymentBytes), fileDataBase64: paymentBytes.toString("base64"),
      uploadedByName: actor.name,
    }).returning({ id: statutoryRemittancePaymentEvidence.id });
    const postingBytes = Buffer.from("employee,amount\n" + sentinel + ",100.00\n");
    const [posting] = await db.insert(statutoryPostingEvidenceArtifacts).values({
      organizationId: org.id, batchId: batch.id, sourceType: "csv_import",
      outcome: "matched", fileName: tag + "-" + k + ".csv",
      mimeType: "text/csv; charset=utf-8", byteSize: postingBytes.length,
      contentSha256: digest(postingBytes), fileDataBase64: postingBytes.toString("base64"),
      recordedByName: actor.name,
    }).returning({ id: statutoryPostingEvidenceArtifacts.id });
    items.push({ issue, payment, posting, batch, sentinel, paymentBytes, postingBytes });
  }
  return items.at(-1);
}
function routePaths(org, proof, legalEntityId) {
  const base = "?organizationId=" + org.id +
    (legalEntityId === undefined ? "" : "&legalEntityId=" + legalEntityId);
  return [
    "/api/compliance/contribution-issues/evidence" + base + "&caseId=" + proof.issue.id,
    "/api/compliance/statutory-remittances/payment-evidence/" + proof.payment.id + base,
    "/api/compliance/statutory-remittances/posting-evidence/" + proof.posting.id + base,
  ];
}
async function successfulTriplet(actor, org, entity, proof, headers = {}) {
  const [casePath, paymentPath, postingPath] = routePaths(org, proof, entity.id);
  const caseResult = status(await request(casePath, actor.cookie, headers), 200, "Actual owned case evidence");
  equals(caseResult.headers.get("content-type")?.startsWith("application/json"), true, "Case MIME");
  equals(caseResult.json?.case?.caseId, proof.issue.id, "Actual own case ID");
  equals(caseResult.json?.case?.legalEntityId, entity.id, "Actual own employer attribution");
  const { evidenceHashSha256, ...casePayload } = caseResult.json ?? {};
  equals(evidenceHashSha256, evidenceHash(casePayload), "Case pack digest");

  const paymentResult = status(await request(paymentPath, actor.cookie, headers), 200, "Actual owned payment proof");
  equals(paymentResult.headers.get("content-type"), "application/pdf", "Payment MIME");
  equals(paymentResult.headers.get("x-payment-proof-sha256"), digest(proof.paymentBytes), "Payment header SHA");
  equals(digest(paymentResult.bytes), digest(proof.paymentBytes), "Actual payment payload digest");
  equals(paymentResult.bytes.equals(proof.paymentBytes), true, "Actual payment bytes");

  const postingResult = status(await request(postingPath, actor.cookie, headers), 200, "Actual owned posting proof");
  equals(postingResult.headers.get("content-type")?.startsWith("text/csv"), true, "Posting MIME");
  equals(digest(postingResult.bytes), digest(proof.postingBytes), "Actual posting payload digest");
  equals(postingResult.bytes.equals(proof.postingBytes), true, "Actual posting bytes");
}
async function deniedTriplet(actor, org, proof, expected, label, headers = {}, legalEntityId) {
  const paths = routePaths(org, proof, legalEntityId);
  for (const [i, path] of paths.entries()) {
    const res = status(await request(path, actor.cookie, headers), expected, label + " method " + i);
    check(!res.text.includes(proof.sentinel), label + " leaked victim sentinel in body");
    check(![...res.headers].some(([name, value]) => (name + value).includes(proof.sentinel)),
      label + " leaked victim sentinel in headers");
    check(!res.headers.has("content-disposition"), label + " served an attachment");
  }
}
async function snapshot(org) {
  return {
    issues: await db.select().from(statutoryContributionIssueCases)
      .where(eq(statutoryContributionIssueCases.organizationId, org.id)).orderBy(statutoryContributionIssueCases.id),
    batches: await db.select().from(statutoryRemittanceBatches)
      .where(eq(statutoryRemittanceBatches.organizationId, org.id)).orderBy(statutoryRemittanceBatches.id),
    payment: await db.select().from(statutoryRemittancePaymentEvidence)
      .where(eq(statutoryRemittancePaymentEvidence.organizationId, org.id)).orderBy(statutoryRemittancePaymentEvidence.id),
    posting: await db.select().from(statutoryPostingEvidenceArtifacts)
      .where(eq(statutoryPostingEvidenceArtifacts.organizationId, org.id)).orderBy(statutoryPostingEvidenceArtifacts.id),
    audit: await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, org.id)).orderBy(auditEvents.id),
    payroll: await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, org.id)).orderBy(payrollRuns.id),
  };
}
async function main() {
  requireDisposable();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const [victimOrg, outsideA, outsideB] = await db.insert(organizations).values([
    { name: "QA evidence employer group " + nonce, legalName: "Fictional group " + nonce },
    { name: "QA outside A " + nonce, legalName: "Fictional outside A " + nonce },
    { name: "QA outside B " + nonce, legalName: "Fictional outside B " + nonce },
  ]).returning({ id: organizations.id });
  const [entityA, entityB, foreignA, foreignB] = await db.insert(legalEntities).values([
    { organizationId: victimOrg.id, code: "OWN", legalName: "QA own employer", displayName: "QA own", primaryEntity: true },
    { organizationId: victimOrg.id, code: "VICTIM", legalName: "QA victim employer", displayName: "QA victim" },
    { organizationId: outsideA.id, code: "OUT-A", legalName: "QA outside A", displayName: "QA outside A", primaryEntity: true },
    { organizationId: outsideB.id, code: "OUT-B", legalName: "QA outside B", displayName: "QA outside B", primaryEntity: true },
  ]).returning({ id: legalEntities.id });
  const ownerA = await makeActor(victimOrg, "own-A", nonce);
  const ownerB = await makeActor(victimOrg, "own-B", nonce);
  const attackerA = await makeActor(outsideA, "outsider-A", nonce);
  const attackerB = await makeActor(outsideB, "outsider-B", nonce);
  await db.insert(userLegalEntityGrants).values([
    { organizationId: victimOrg.id, userId: ownerA.id, legalEntityId: entityA.id },
    { organizationId: victimOrg.id, userId: ownerB.id, legalEntityId: entityB.id },
    { organizationId: outsideA.id, userId: attackerA.id, legalEntityId: foreignA.id },
    { organizationId: outsideB.id, userId: attackerB.id, legalEntityId: foreignB.id },
  ]);
  const [workerA, workerB, workerForeignA, workerForeignB] = await Promise.all([
    makeEmployee(victimOrg, entityA, "own", nonce),
    makeEmployee(victimOrg, entityB, "victim", nonce),
    makeEmployee(outsideA, foreignA, "outsider-A", nonce),
    makeEmployee(outsideB, foreignB, "outsider-B", nonce),
  ]);
  const own = await makeArtifacts(victimOrg, entityA, workerA, ownerA, "OWN", nonce);
  const protectedVictim = await makeArtifacts(victimOrg, entityB, workerB, ownerB, "VICTIM", nonce, 7);
  const foreignProofA = await makeArtifacts(outsideA, foreignA, workerForeignA, attackerA, "OUT-A", nonce);
  const foreignProofB = await makeArtifacts(outsideB, foreignB, workerForeignB, attackerB, "OUT-B", nonce);
  for (const id of [protectedVictim.issue.id, protectedVictim.payment.id, protectedVictim.posting.id]) {
    check(Number.isSafeInteger(id) && id > 6, "Victim-only record must exist at an actual ID > 6");
  }
  // True positive controls: each of the three routes must return verified
  // bytes to an independently authenticated authorized employer.
  await successfulTriplet(ownerA, victimOrg, entityA, own, { "x-legal-entity-id": String(entityA.id) });
  await successfulTriplet(ownerB, victimOrg, entityB, protectedVictim);
  await successfulTriplet(attackerA, outsideA, foreignA, foreignProofA);
  await successfulTriplet(attackerB, outsideB, foreignB, foreignProofB);

  if (!flagOn) {
    // The release flag is inert: the established company-wide role may
    // download other legal-employer evidence within the same tenant.
    await successfulTriplet(ownerA, victimOrg, entityB, protectedVictim);
    await successfulTriplet(ownerA, victimOrg, entityB, protectedVictim, {
      "x-legal-entity-id": String(entityA.id),
    });
  }
  // A legacy record whose tenant differs from its parent batch must never
  // be served even when its child row appears to belong to the caller.
  const mismatchedBytes = Buffer.from("MISMATCHED-PARENT-" + nonce);
  const [mismatchedPayment] = await db.insert(statutoryRemittancePaymentEvidence).values({
    organizationId: victimOrg.id, batchId: foreignProofA.batch.id,
    fileName: "mismatched.pdf", mimeType: "application/pdf",
    byteSize: mismatchedBytes.length, fileSha256: digest(mismatchedBytes),
    fileDataBase64: mismatchedBytes.toString("base64"),
    status: "superseded", uploadedByName: ownerA.name,
  }).returning({ id: statutoryRemittancePaymentEvidence.id });
  const [mismatchedPosting] = await db.insert(statutoryPostingEvidenceArtifacts).values({
    organizationId: victimOrg.id, batchId: foreignProofA.batch.id, sourceType: "csv_import",
    outcome: "matched", fileName: "mismatched.csv",
    mimeType: "text/csv; charset=utf-8", byteSize: mismatchedBytes.length,
    contentSha256: digest(mismatchedBytes), fileDataBase64: mismatchedBytes.toString("base64"),
    recordedByName: ownerA.name,
  }).returning({ id: statutoryPostingEvidenceArtifacts.id });
  const baseline = await snapshot(victimOrg);
  const externalBaselines = await Promise.all([snapshot(outsideA), snapshot(outsideB)]);

  for (const attacker of [attackerA, attackerB]) {
    await deniedTriplet(attacker, victimOrg, protectedVictim, 403, "Other authenticated tenant");
  }

  if (flagOn) {
    await deniedTriplet(ownerA, victimOrg, protectedVictim, 403,
      "Ungranted employer via default selection");
    await deniedTriplet(ownerA, victimOrg, protectedVictim, 403,
      "Forged legal-employer query", {}, entityB.id);
    await deniedTriplet(ownerA, victimOrg, protectedVictim, 403,
      "Forged legal-employer header", { "x-legal-entity-id": String(entityB.id) }, entityA.id);
    await deniedTriplet(ownerA, victimOrg, protectedVictim, 403,
      "Mismatched real-resource employer", { "x-legal-entity-id": String(entityA.id) }, entityA.id);
  }

  // Nonexistent IDs can never count as the foreign-victim denial proof.
  const nonexistent = { issue: { id: 999999999 }, payment: { id: 999999999 },
    posting: { id: 999999999 }, sentinel: protectedVictim.sentinel };
  await deniedTriplet(ownerA, victimOrg, nonexistent, 404, "Missing source record", {},
    entityA.id);
  status(await request("/api/compliance/statutory-remittances/payment-evidence/" +
    mismatchedPayment.id + "?organizationId=" + victimOrg.id +
    "&legalEntityId=" + entityA.id, ownerA.cookie), 404, "Mismatched payment parent tenant");
  status(await request("/api/compliance/statutory-remittances/posting-evidence/" +
    mismatchedPosting.id + "?organizationId=" + victimOrg.id +
    "&legalEntityId=" + entityA.id, ownerA.cookie), 404, "Mismatched posting parent tenant");

  await db.delete(userLegalEntityGrants).where(and(
    eq(userLegalEntityGrants.organizationId, victimOrg.id),
    eq(userLegalEntityGrants.userId, ownerB.id),
    eq(userLegalEntityGrants.legalEntityId, entityB.id),
  ));
  if (flagOn) {
    await deniedTriplet(ownerB, victimOrg, protectedVictim, 403,
      "Revoked legal-employer grant", {}, entityB.id);
  } else {
    await successfulTriplet(ownerB, victimOrg, entityB, protectedVictim);
  }

  // Any authorized reads after the snapshot occur only in flag-OFF parity,
  // where the pre-existing endpoint correctly emits a download audit entry.
  const expectedAuditIncrease = flagOn ? 0 : 3;
  const after = await snapshot(victimOrg);
  for (const key of ["issues", "batches", "payment", "posting", "payroll"]) {
    assert.deepEqual(after[key], baseline[key], "Forbidden requests mutated protected " + key);
    assertions++;
  }
  if (expectedAuditIncrease === 0) {
    assert.deepEqual(after.audit, baseline.audit, "Denials must not audit an evidence export");
    assertions++;
  } else {
    equals(after.audit.length, baseline.audit.length + expectedAuditIncrease,
      "Flag-off authorized exports must be audited");
  }
  for (const [idx, org] of [outsideA, outsideB].entries()) {
    assert.deepEqual(await snapshot(org), externalBaselines[idx],
      "Cross-tenant attempts must not mutate foreign financial/audit/payroll rows");
    assertions++;
  }
  console.log(JSON.stringify({
    result: "PASS", kind: "STATUTORY_EVIDENCE_ENTITY_HTTP_PG16",
    multiEntityEnabled: flagOn, exactGetMethods: 3, outsideAttackerTenants: 2,
    sameTenantLegalEmployers: 2, victimIdsAboveSix: true,
    mismatchedParentDenied: true, revokedGrantChecked: true, assertions,
    paymentProviderCalls: 0, productionAcceptance: false,
  }));
}
main().catch(error => {
  console.error("STATUTORY_EVIDENCE_ENTITY_HTTP_FAILED",
    error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});