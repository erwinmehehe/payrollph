/**
 * Provisional, uncredited GET /api/self/documents proof.
 * Real independently authenticated ESS accounts, three persisted employers,
 * high-ID victim, coworker rows and deliberately poisoned legacy ID-only joins.
 * PostgreSQL 16 + localhost production-mode HTTP; no real documents or providers.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, documents, employees, hcmDocumentRequirements,
  hcmEmployeeDocumentCompliance, hcmPolicyAssignments, hcmPolicyVersions,
  organizations, payrollRuns, userOrganizations, users,
} from "../../src/db/schema";
import { addWorker, seedEmployer, standaloneMakeSession, standaloneRequest,
  standaloneExpectStatus } from "./tenant-table-http.mjs";
import { assertEssDocumentDenial, assertEssDocumentView } from "./tenant-ess-documents-read-contract.mjs";

const PATH = "/api/self/documents";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const selectOrg = (table, orgId) => db.select().from(table)
  .where(eq(table.organizationId, orgId)).orderBy(table.id);

function requireDisposable() {
  const app = new URL(process.env.SECURITY_SMOKE_URL ?? "");
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.TENANT_ESS_DOCUMENTS_READ_MODE, "isolated-ci-only");
  assert.equal(app.href, "http://127.0.0.1:3000/");
  assert.equal(pg.protocol, "postgresql:");
  assert.equal(pg.hostname, "127.0.0.1");
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY,
    "external payout credentials are never allowed in this test");
  assert.ok(!process.env.RESEND_API_KEY && !process.env.POSTMARK_SERVER_TOKEN &&
    !process.env.SMTP_URL, "external email providers must be absent");
}

async function businessSnapshot(orgId) {
  return {
    org: await db.select().from(organizations).where(eq(organizations.id, orgId)),
    workers: await selectOrg(employees, orgId),
    policies: await selectOrg(hcmPolicyVersions, orgId),
    assignments: await selectOrg(hcmPolicyAssignments, orgId),
    requirements: await selectOrg(hcmDocumentRequirements, orgId),
    compliance: await selectOrg(hcmEmployeeDocumentCompliance, orgId),
    documents: await selectOrg(documents, orgId),
    payroll: await selectOrg(payrollRuns, orgId),
    audit: await selectOrg(auditEvents, orgId),
  };
}

async function makeEmployee(employer) {
  const [account] = await db.insert(users).values({
    email: "ess-documents-" + randomUUID() + "@example.invalid",
    name: "Fictional documents employee " + employer.label,
    passwordHash: "fictional-only-never-used",
    role: "employee",
    employeeId: employer.worker.id,
  }).returning();
  await db.insert(userOrganizations).values({
    userId: account.id, organizationId: employer.org.id,
    role: "employee", active: true,
  });
  const [unlinked] = await db.insert(users).values({
    email: "ess-unlinked-" + randomUUID() + "@example.invalid",
    name: "Fictional unlinked employee " + employer.label,
    passwordHash: "fictional-only-never-used", role: "employee",
  }).returning();
  await db.insert(userOrganizations).values({
    userId: unlinked.id, organizationId: employer.org.id,
    role: "employee", active: true,
  });
  const session = await standaloneMakeSession(account.id);
  const unlinkedSession = await standaloneMakeSession(unlinked.id);
  return { account, cookie: session.cookie, unlinkedCookie: unlinkedSession.cookie };
}

async function createRequirement(employer, suffix) {
  const [row] = await db.insert(hcmDocumentRequirements).values({
    organizationId: employer.org.id,
    code: "ESS-DOC-" + employer.label + "-" + suffix,
    name: employer.marker + " " + suffix + " requirement",
    kind: "contract",
    createdByUserId: employer.owner.id,
    createdByName: employer.owner.name,
  }).returning();
  return row;
}

async function createDocument(employer, employee, suffix) {
  const value = Buffer.from("FICTIONAL DOCUMENT " + employer.marker + " " + suffix, "utf8");
  const [row] = await db.insert(documents).values({
    organizationId: employer.org.id,
    employeeId: employee.id,
    kind: "contract",
    fileName: employer.marker + "-" + suffix + ".pdf",
    mimeType: "application/pdf",
    byteSize: value.length,
    sha256: sha256(value),
    scannedClean: true,
    sourceType: "upload",
    uploadedBy: employer.owner.name,
    content: value.toString("base64"),
  }).returning();
  return row;
}

async function createCompliance(employer, requirement, documentId, status) {
  const [row] = await db.insert(hcmEmployeeDocumentCompliance).values({
    organizationId: employer.org.id, employeeId: employer.worker.id,
    requirementId: requirement.id, documentId, status,
  }).returning();
  return row;
}

function expectedCompliance(row, requirement, document = null) {
  return {
    complianceId: row.id, requirementId: requirement.id,
    code: requirement.code, name: requirement.name, status: row.status,
    documentId: document?.id ?? null,
    fileName: document?.fileName ?? null,
  };
}

async function seedOwnedDocuments(employer) {
  const coworker = await addWorker(employer, "DOC-PEER");
  const identity = await makeEmployee(employer);
  const content = "Published fictional employee policy for " + employer.marker;
  const [policy] = await db.insert(hcmPolicyVersions).values({
    organizationId: employer.org.id,
    policyCode: "ESSREAD-" + employer.label,
    title: "Employee policy " + employer.marker,
    version: "1",
    status: "published",
    effectiveFrom: "2026-01-01",
    content, contentSha256: sha256(content),
    createdByUserId: employer.owner.id, createdByName: employer.owner.name,
  }).returning();
  const [assignment] = await db.insert(hcmPolicyAssignments).values({
    organizationId: employer.org.id, employeeId: employer.worker.id, policyId: policy.id,
  }).returning();
  const [coworkerAssignment] = await db.insert(hcmPolicyAssignments).values({
    organizationId: employer.org.id, employeeId: coworker.id, policyId: policy.id,
  }).returning();

  const ownRequirement = await createRequirement(employer, "OWN");
  const coworkerRequirement = await createRequirement(employer, "PEER-POISON");
  const ownDocument = await createDocument(employer, employer.worker, "own-file");
  const coworkerDocument = await createDocument(employer, coworker, "peer-secret");
  const ownCompliance = await createCompliance(
    employer, ownRequirement, ownDocument.id, "submitted");
  const coworkerPoison = await createCompliance(
    employer, coworkerRequirement, coworkerDocument.id, "missing");
  const [coworkerCompliance] = await db.insert(hcmEmployeeDocumentCompliance).values({
    organizationId: employer.org.id, employeeId: coworker.id,
    requirementId: ownRequirement.id, documentId: coworkerDocument.id,
    status: "submitted",
  }).returning();

  const expected = {
    employee: {
      id: employer.worker.id,
      employeeNo: employer.worker.employeeNo,
      name: employer.worker.firstName + " " + employer.worker.lastName,
    },
    policies: [{
      assignmentId: assignment.id, policyId: policy.id,
      policyCode: policy.policyCode, content: policy.content,
      status: "assigned", policyStatus: "published",
    }],
    documents: [
      expectedCompliance(ownCompliance, ownRequirement, ownDocument),
      expectedCompliance(coworkerPoison, coworkerRequirement),
    ],
    forbiddenValues: [coworkerDocument.fileName],
  };
  return {
    employer, identity, coworker, policy, assignment, coworkerAssignment,
    coworkerCompliance, ownRequirement, ownDocument, coworkerDocument,
    ownCompliance, expected,
  };
}

async function attachPoisonedReferences(attacker, victim) {
  // These tables historically use ID-only references, not a matching tenant FK.
  // The actual read joins must refuse these real cross-employer references.
  const foreignRequirement = await createRequirement(attacker.employer, "VICTIM-DOCUMENT");
  const poisonedForeignDocument = await createCompliance(
    attacker.employer, foreignRequirement, victim.ownDocument.id, "missing");
  attacker.expected.documents.push(expectedCompliance(
    poisonedForeignDocument, foreignRequirement));

  const [foreignPolicyAssignment] = await db.insert(hcmPolicyAssignments).values({
    organizationId: attacker.employer.org.id,
    employeeId: attacker.employer.worker.id,
    policyId: victim.policy.id,
    status: "assigned",
  }).returning();

  const [foreignRequirementCompliance] = await db.insert(hcmEmployeeDocumentCompliance).values({
    organizationId: attacker.employer.org.id,
    employeeId: attacker.employer.worker.id,
    requirementId: victim.ownRequirement.id,
    status: "missing",
  }).returning();
  assert.ok(foreignPolicyAssignment.id > 0 && foreignRequirementCompliance.id > 0,
    "poisoned joins need genuine, persisted cross-employer FKs");
  attacker.expected.forbiddenValues.push(
    victim.policy.content, victim.policy.title, victim.ownRequirement.name,
    victim.ownDocument.fileName, victim.employer.marker);
  return { foreignPolicyAssignment, foreignRequirementCompliance, poisonedForeignDocument };
}

async function requestView(actor, extra = "") {
  return standaloneRequest(PATH + extra, { cookie: actor.identity.cookie });
}

export async function verifyEssDocumentsReadIsolation() {
  requireDisposable();
  const pg = await db.execute(sql.raw("SELECT current_setting('server_version_num') AS version"));
  assert.match(String(pg.rows?.[0]?.version ?? ""), /^16\d{4}$/,
    "this evidence must run against real PostgreSQL 16");

  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const attackers = [
    await seedEmployer("ATTA", nonce, standaloneMakeSession),
    await seedEmployer("ATTB", nonce, standaloneMakeSession),
  ];
  const victimEmployer = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  assert.ok(victimEmployer.org.id > attackers[0].org.id &&
    victimEmployer.org.id > attackers[1].org.id);
  assert.ok(victimEmployer.worker.id > attackers[0].worker.id &&
    victimEmployer.worker.id > attackers[1].worker.id);
  const owned = [];
  for (const employer of [...attackers, victimEmployer]) {
    owned.push(await seedOwnedDocuments(employer));
  }
  const victim = owned[2];
  for (const attacker of owned.slice(0, 2)) {
    assert.ok(victim.policy.id > attacker.policy.id &&
      victim.ownRequirement.id > attacker.ownRequirement.id &&
      victim.ownDocument.id > attacker.ownDocument.id,
      "victim's actual policy, requirement and document IDs must be higher than both attackers");
    await attachPoisonedReferences(attacker, victim);
  }
  const baseline = await Promise.all(owned.map((actor) =>
    businessSnapshot(actor.employer.org.id)));

  const victimPositive = standaloneExpectStatus(await requestView(victim),
    200, "victim must have its own genuine populated policy and document view");
  assertEssDocumentView(victimPositive, victim.expected);

  const responses = [];
  for (const actor of owned.slice(0, 2)) {
    const own = standaloneExpectStatus(await requestView(actor),
      200, "own employee must have real populated documents");
    assertEssDocumentView(own, actor.expected);
    responses.push(own);
    const forged = standaloneExpectStatus(await requestView(actor,
      "?organizationId=" + victim.employer.org.id +
      "&employeeId=" + victim.employer.worker.id +
      "&policyId=" + victim.policy.id + "&documentId=" + victim.ownDocument.id),
      200, "query-only foreign selectors must not change session-bound GET");
    assertEssDocumentView(forged, actor.expected);
    const ownerDenied = await standaloneRequest(PATH, {
      cookie: actor.employer.cookie,
    });
    assertEssDocumentDenial(ownerDenied, 403,
      [victim.policy.content, victim.ownDocument.fileName]);
    const unlinkedDenied = await standaloneRequest(PATH, {
      cookie: actor.identity.unlinkedCookie,
    });
    assertEssDocumentDenial(unlinkedDenied, 403, [victim.policy.content]);
  }
  assert.throws(() => assertEssDocumentView(responses[0], owned[1].expected),
    "a genuine attacker A HTTP view must not pass attacker B's own-data contract");

  const anonymous = await standaloneRequest(PATH);
  assertEssDocumentDenial(anonymous, 401, [victim.policy.content]);
  const afterReads = await Promise.all(owned.map((actor) =>
    businessSnapshot(actor.employer.org.id)));
  assert.deepEqual(afterReads, baseline,
    "real own/forged/denied GETs must not mutate any employer's documents, policies, payroll or audit");

  // Keep the same victim employee session authenticated via a second employer
  // membership while revoking the membership for its actual linked employee.
  await db.insert(userOrganizations).values({
    userId: victim.identity.account.id,
    organizationId: attackers[0].org.id, role: "employee", active: true,
  });
  await db.update(userOrganizations).set({ active: false }).where(and(
    eq(userOrganizations.userId, victim.identity.account.id),
    eq(userOrganizations.organizationId, victim.employer.org.id),
  ));
  const stillAuthenticated = standaloneExpectStatus(
    await standaloneRequest("/api/auth/me", { cookie: victim.identity.cookie }),
    200, "alternate active membership keeps the same session authenticated");
  assert.equal(stillAuthenticated.json?.user?.id, victim.identity.account.id);
  const revoked = await requestView(victim);
  assertEssDocumentDenial(revoked, 403,
    [victim.policy.content, victim.ownDocument.fileName]);
  const afterRevoke = await Promise.all(owned.map((actor) =>
    businessSnapshot(actor.employer.org.id)));
  assert.deepEqual(afterRevoke, baseline,
    "revoked-session denial must not mutate any employer business, PII, payroll or audit rows");

  console.log("ESS DOCUMENTS READ TENANT PASS: 1 GAP, 0 credits; real PG16 and authenticated HTTP; " +
    "two attackers, populated higher-ID victim, wrong-tenant policy/requirement/document joins, " +
    "same-tenant coworker, forged query, own positivity, revoked membership, DB unchanged.");
}

if (process.argv[1] &&
  process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-ess-documents-read-http.mjs")) {
  verifyEssDocumentsReadIsolation().then(() => process.exit(0),
    (error) => { console.error(error); process.exit(1); });
}
