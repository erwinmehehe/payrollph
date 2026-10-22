/**
 * DL-01 provisional employee-document-vault proof on the *existing* disposable
 * three-employer PG16 + localhost HTTP runner. No live storage object is read,
 * written or removed; deletion only soft-removes fictional DB metadata.
 *
 * GET /api/employee-vault and DELETE /api/employee-vault/[id] stay GAP until
 * exact-head Security HTTP Smoke, source-line pinning and independent review.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, documents, employees, sessions, users } from "../../src/db/schema";

export const DL01_VAULT_METHODS = Object.freeze([
  "GET employee-vault",
  "DELETE employee-vault/[id]",
]);

function requireDisposable() {
  const app = new URL(process.env.SECURITY_SMOKE_URL ?? "");
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "true");
  assert.equal(app.href, "http://127.0.0.1:3000/");
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["127.0.0.1", "localhost"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
}

function fakeDocument({ org, employee, owner, marker }) {
  const buffer = Buffer.from("FICTIONAL VAULT PDF METADATA: " + marker);
  return {
    organizationId: org.id, employeeId: employee.id,
    kind: "onboarding", fileName: marker + ".pdf",
    mimeType: "application/pdf", byteSize: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    scannedClean: true, scanNote: "Disposable-PG16 fixture; no S3 object created",
    uploadedBy: owner.name, uploadedByUserId: owner.id,
    sourceType: "upload", sourceKey: null,
    objectStorageKey: "private-documents/" + org.id + "/" + employee.id + "/" + randomUUID(),
    content: buffer.toString("base64"),
  };
}

async function victimSnapshot(orgId) {
  return {
    documents: await db.select().from(documents)
      .where(eq(documents.organizationId, orgId)).orderBy(documents.id),
    audit: await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id),
  };
}

function assertOwnList(response, expectedDocId, victimDocId, victimMarker, orgId, employeeId) {
  assert.equal(response.json?.organizationId, orgId);
  assert.equal(response.json?.employeeId, employeeId);
  const listed = response.json?.documents;
  assert.ok(Array.isArray(listed) && listed.length > 0,
    "An empty/feature-disabled response is not own-positive vault coverage");
  assert.ok(listed.some(doc => doc.id === expectedDocId && doc.canRemove === true),
    "Own active uploaded document must be a genuine removable DB row");
  assert.ok(!listed.some(doc => doc.id === victimDocId),
    "Real higher-ID victim document must never appear in own vault");
  assert.ok(!response.text.includes(victimMarker),
    "Victim document name/metadata must not appear in own response");
  assert.match(response.headers.get("cache-control") ?? "", /private|no-store/i);
}

export async function verifyDl01Vault(f, { request, expectStatus }) {
  requireDisposable();
  assert.equal(DL01_VAULT_METHODS.length, 2);
  assert.equal(new Set(f.orgs.map(org => org.id)).size, 3);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const created = [];

  // Seed both attackers' legitimate source rows first. Their IDs must be
  // smaller than the later-created, REAL victim-only document ID.
  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const employee = f.ownedEmployees[idx - 1];
    const owner = f.owners[idx];
    const rows = await db.insert(documents).values([
      fakeDocument({ org, employee, owner, marker: "DL01-OWN-" + nonce + "-" + idx }),
      fakeDocument({ org, employee, owner, marker: "DL01-OWN-FORGED-" + nonce + "-" + idx }),
    ]).returning({ id: documents.id, organizationId: documents.organizationId });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.organizationId === org.id));
    created[idx] = rows;
  }
  const victimOrg = f.orgs[0];
  const victimWorker = f.victimEmployee;
  const victimMarker = "DL01-VAULT-VICTIM-" + nonce;
  const [victimDoc] = await db.insert(documents).values(
    fakeDocument({ org: victimOrg, employee: victimWorker, owner: f.owners[0],
      marker: victimMarker }),
  ).returning({ id: documents.id, organizationId: documents.organizationId });
  assert.equal(victimDoc.organizationId, victimOrg.id);
  assert.ok(victimDoc.id > 6 && victimDoc.id > created[1][1].id &&
    victimDoc.id > created[2][1].id,
    "Victim-only document must exist in PG and have higher ID than both attackers");

  const [persistedVictimDoc] = await db.select().from(documents)
    .where(eq(documents.id, victimDoc.id)).limit(1);
  assert.equal(persistedVictimDoc?.organizationId, victimOrg.id);
  assert.equal(persistedVictimDoc?.employeeId, victimWorker.id);
  const before = await victimSnapshot(victimOrg.id);

  for (const idx of [1, 2]) {
    const org = f.orgs[idx], worker = f.ownedEmployees[idx - 1];
    const cookie = f.ownerSessions[idx].cookie;
    const ownPrimary = created[idx][0], ownForged = created[idx][1];

    // MFA evidence exists only inside this disposable test DB/session, never
    // in production or an HTTP impersonation shortcut.
    await db.update(users).set({ totpEnabled: true })
      .where(eq(users.id, f.owners[idx].id));
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, f.ownerSessions[idx].id));

    const base = "/api/employee-vault?organizationId=" + org.id +
      "&employeeId=" + worker.id;
    const ownRead = expectStatus(await request(base, { cookie }), 200,
      "DL-01 vault GET real own employee and nonempty PDF metadata");
    assertOwnList(ownRead, ownPrimary.id, victimDoc.id, victimMarker,
      org.id, worker.id);
    expectStatus(await request("/api/employee-vault?organizationId=" +
      victimOrg.id + "&employeeId=" + victimWorker.id, { cookie }), 403,
      "DL-01 vault GET denies authenticated attacker for actual victim employer");
    expectStatus(await request("/api/employee-vault?organizationId=" +
      org.id + "&employeeId=" + victimWorker.id, { cookie }), 404,
      "DL-01 vault GET refuses actual foreign employee ID within own employer");
    const forged = expectStatus(await request(base +
      "&documentId=" + victimDoc.id + "&victimOrganizationId=" + victimOrg.id,
      { cookie }), 200, "DL-01 vault GET ignores unrecognized forged selectors");
    assertOwnList(forged, ownPrimary.id, victimDoc.id, victimMarker,
      org.id, worker.id);

    expectStatus(await request("/api/employee-vault/" + victimDoc.id, {
      method: "DELETE", cookie,
    }), 403, "DL-01 vault DELETE must deny actual higher-ID victim document");

    expectStatus(await request("/api/employee-vault/" + ownPrimary.id, {
      method: "DELETE", cookie,
    }), 204, "DL-01 vault DELETE must soft-remove a real owned PDF metadata row");
    const [removed] = await db.select().from(documents)
      .where(eq(documents.id, ownPrimary.id)).limit(1);
    assert.ok(removed?.sourceKey?.startsWith("vault-removed:"),
      "Own DELETE must persist private soft removal; must not erase object bytes");
    const hidden = expectStatus(await request(base, { cookie }), 200,
      "DL-01 removed document must no longer appear in the active vault");
    assert.ok(!hidden.json?.documents?.some(doc => doc.id === ownPrimary.id),
      "Soft-removed own document must not be listed as active");

    expectStatus(await request("/api/employee-vault/" + ownForged.id +
      "?organizationId=" + victimOrg.id + "&employeeId=" + victimWorker.id, {
      method: "DELETE", cookie,
    }), 204, "DL-01 vault DELETE ignores forged employer/worker query on owned ID");
    const [forgedRemoved] = await db.select().from(documents)
      .where(eq(documents.id, ownForged.id)).limit(1);
    assert.equal(forgedRemoved?.organizationId, org.id);
    assert.ok(forgedRemoved?.sourceKey?.startsWith("vault-removed:"));

    const ownAudit = await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, org.id));
    assert.ok(ownAudit.some(row => row.action === "Employee document removed from active vault" &&
      row.resource === String(ownPrimary.id)), "Owned removal audit must be persisted");
    assert.deepEqual(await victimSnapshot(victimOrg.id), before,
      "Victim documents and audit must remain byte-for-byte unchanged after own, foreign and forged vault HTTP requests");
    console.log("PASS provisional DL-01 vault GET and DELETE, independent attacker " + idx);
  }
  console.log("PROVISIONAL DL-01 vault: 2 candidate methods, 2 attackers, actual high-ID victim, unchanged PG; inventory stays NOT ACCEPTED.");
}
