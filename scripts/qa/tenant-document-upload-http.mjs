/**
 * POST /api/documents: actual multipart Next.js HTTP against disposable PG16.
 * Two independent employers, a higher-ID persisted victim, genuine success,
 * forged selectors, scoped compliance, audit veto and unchanged victim SQL.
 * This is a zero-credit development proof, NOT a production security acceptance.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import * as s from "../../src/db/schema";
import { seedEmployer, standaloneMakeSession, standaloneRequest } from "./tenant-table-http.mjs";
import { withDisposableInsertVeto } from "./disposable-insert-veto.mjs";
import {
  APP_ORIGIN, ENDPOINT, requireDisposableDocumentEnv,
  assertDeniedDocumentResponse, assertStoredDocument, assertNoChanges,
} from "./tenant-document-upload-contract.mjs";

requireDisposableDocumentEnv();
const plain = (value) => JSON.parse(JSON.stringify(value));
const TABLES = Object.freeze([
  "employees", "employeePayProfiles", "payrollRuns", "documents",
  "hcmDocumentRequirements", "hcmEmployeeDocumentCompliance",
  "auditEvents", "outbox",
]);

async function snapshot(organizationId) {
  const result = {};
  for (const name of TABLES) {
    const table = s[name];
    assert.ok(table?.organizationId && table.id, "Required real tenant table missing: " + name);
    result[name] = await db.select().from(table).where(eq(table.organizationId, organizationId))
      .orderBy(asc(table.id));
  }
  return plain(result);
}
async function snapshotAll(subjects) {
  const rows = await Promise.all(subjects.map(async subject =>
    [subject.org.id, await snapshot(subject.org.id)]));
  return new Map(rows);
}
async function assertAllUnchanged(subjects, before, label) {
  for (const subject of subjects) assertNoChanges(
    before.get(subject.org.id), await snapshot(subject.org.id), label + " " + subject.marker);
}
async function assertOthersUnchanged(subjects, before, current, label) {
  for (const subject of subjects.filter(s => s !== current)) assertNoChanges(
    before.get(subject.org.id), await snapshot(subject.org.id), label + " " + subject.marker);
}
function pdf(actor, suffix) {
  return Buffer.from("%PDF-1.4\nFICTIONAL-DOCUMENT-TEST-ONLY\n" +
    actor.marker + " " + suffix + "\n%%EOF\n", "utf8");
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function postDocument({ actor, organizationId = actor.org.id,
  employeeId = actor.worker.id, requirementId = null,
  suffix = "standalone", bytes = pdf(actor, suffix), cookie = actor.cookie }) {
  const form = new FormData();
  form.set("organizationId", String(organizationId));
  form.set("employeeId", String(employeeId));
  form.set("kind", "contract");
  if (requirementId != null) form.set("requirementId", String(requirementId));
  form.set("file", new File([bytes], actor.marker + "-" + suffix + ".pdf", {
    type: "application/pdf",
  }));
  const response = await fetch(APP_ORIGIN + ENDPOINT, {
    method: "POST",
    headers: { origin: APP_ORIGIN, "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}) },
    body: form, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Non-JSON is asserted by caller. */ }
  return { status: response.status, text, json, headers: response.headers };
}
function ensureNotLeaking(response, subjects, actor) {
  for (const other of subjects.filter(s => s !== actor)) {
    assert.ok(!response.text.includes(other.marker),
      "An upload response must not expose another employer's marker");
  }
}

async function fixtureEmployer(label, nonce) {
  const actor = await seedEmployer(label, nonce, standaloneMakeSession);
  const [requirement] = await db.insert(s.hcmDocumentRequirements).values({
    organizationId: actor.org.id,
    code: "DOC-" + label + "-" + nonce,
    name: actor.marker + " fictional policy requirement",
    kind: "contract",
    createdByUserId: actor.owner.id,
    createdByName: actor.owner.name,
  }).returning();
  const [compliance] = await db.insert(s.hcmEmployeeDocumentCompliance).values({
    organizationId: actor.org.id, employeeId: actor.worker.id,
    requirementId: requirement.id, status: "missing",
  }).returning();
  return { ...actor, requirement, compliance };
}

async function main() {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 9);
  const subjects = [];
  try {
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      subjects.push(await fixtureEmployer(label, nonce));
    }
    const [a, b, victim] = subjects;
    assert.equal(new Set(subjects.map(x => x.org.id)).size, 3);
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);
    for (const actor of [a, b]) {
      for (const key of ["org", "worker", "requirement", "compliance"]) {
        assert.ok(victim[key].id > actor[key].id,
          "The higher-ID victim must have an actual persisted " + key);
      }
    }
    // Persist real victim document bytes before any negative test. This is not
    // just a made-up numeric ID or an empty victim company.
    const victimBytes = pdf(victim, "persisted-victim");
    const [victimDocument] = await db.insert(s.documents).values({
      organizationId: victim.org.id, employeeId: victim.worker.id,
      kind: "contract", fileName: victim.marker + "-existing.pdf",
      mimeType: "application/pdf", byteSize: victimBytes.length,
      sha256: sha256(victimBytes), scannedClean: true,
      scanNote: "Fictional fixture bytes", uploadedBy: victim.owner.name,
      content: victimBytes.toString("base64"),
    }).returning();
    assert.ok(victimDocument.id > 0);
    const initial = await snapshotAll(subjects);
    assert.equal(initial.get(victim.org.id).documents.length, 1);
    let denials = 0, positives = 0, vetoes = 0;
    for (const actor of [a, b]) {
      const account = await standaloneRequest("/api/account", { cookie: actor.cookie });
      assert.equal(account.status, 200, "Authenticated session must be real");
      assert.equal(account.json?.profile?.id, actor.owner.id);
      const hidden = [victim.marker, victimDocument.fileName, victim.requirement.name];

      async function refused(args, expectedStatus, name) {
        const before = await snapshotAll(subjects);
        const response = await postDocument({ actor, ...args });
        assertDeniedDocumentResponse(response, expectedStatus, hidden);
        await assertAllUnchanged(subjects, before, name);
        denials++;
        return response;
      }
      // The caller may try to switch employers and borrow real persisted
      // employee and requirement IDs. All are denied before document inserts.
      await refused({ organizationId: victim.org.id, employeeId: victim.worker.id,
        requirementId: victim.requirement.id }, 403, "forged employer selector");
      await refused({ employeeId: victim.worker.id }, 404, "foreign employee ID");
      await refused({ requirementId: victim.requirement.id }, 404, "foreign requirement ID");
      await refused({ cookie: null }, 401, "anonymous multipart upload");
      await refused({ bytes: Buffer.from("FICTIONAL-DOCUMENT-TEST-ONLY not a PDF") },
        422, "bad magic number");
      // Simulate a failed audit insert without mocking the HTTP handler. A
      // successful upload must not survive if its mandatory audit row fails.
      const beforeVeto = await snapshotAll(subjects);
      await withDisposableInsertVeto(pool, "audit_events", actor.org.id, async () => {
        const response = await postDocument({
          actor, requirementId: actor.requirement.id, suffix: "audit-veto",
        });
        assertDeniedDocumentResponse(response, 409, hidden);
      });
      await assertAllUnchanged(subjects, beforeVeto, "audit veto rolls back upload");
      vetoes++;

      for (const [suffix, requirementId] of [["unattached", null],
        ["assigned-requirement", actor.requirement.id]]) {
        const before = await snapshotAll(subjects);
        const bytes = pdf(actor, suffix);
        const expected = {
          fileName: actor.marker + "-" + suffix + ".pdf",
          sha256: sha256(bytes), byteSize: bytes.length,
          requirementId, forbiddenMarker: victim.marker,
        };
        const result = await postDocument({ actor, suffix, requirementId });
        assertStoredDocument(result, actor, expected);
        ensureNotLeaking(result, subjects, actor);
        const after = await snapshot(actor.org.id);
        const saved = after.documents.find(row => row.id === result.json.id);
        assert.ok(saved, "Own document must be persisted, not just acknowledged");
        assert.equal(saved.organizationId, actor.org.id);
        assert.equal(saved.employeeId, actor.worker.id);
        assert.equal(saved.sha256, expected.sha256);
        assert.equal(saved.content, bytes.toString("base64"));
        assert.equal(saved.scannedClean, true);
        assert.equal(after.documents.length, before.get(actor.org.id).documents.length + 1);
        assert.equal(after.auditEvents.length, before.get(actor.org.id).auditEvents.length + 1);
        const audit = after.auditEvents.at(-1);
        assert.equal(audit.organizationId, actor.org.id);
        assert.equal(audit.action, "Document uploaded");
        if (requirementId != null) {
          const compliance = after.hcmEmployeeDocumentCompliance.find(
            row => row.id === actor.compliance.id);
          assert.equal(compliance.documentId, result.json.id);
          assert.equal(compliance.status, "submitted");
        } else {
          assert.deepEqual(after.hcmEmployeeDocumentCompliance,
            before.get(actor.org.id).hcmEmployeeDocumentCompliance);
        }
        for (const name of ["employees", "employeePayProfiles", "payrollRuns", "outbox",
          "hcmDocumentRequirements"]) {
          assert.deepEqual(after[name], before.get(actor.org.id)[name],
            "Document upload cannot mutate " + name);
        }
        await assertOthersUnchanged(subjects, before, actor, suffix);
        positives++;
      }
    }
    // The high-ID victim's document bytes and other business state are still
    // precisely the same after both attackers' real HTTP mutations.
    assertNoChanges(initial.get(victim.org.id), await snapshot(victim.org.id),
      "victim remains byte-identical through the entire proof");
    assert.equal(denials, 10);
    assert.equal(positives, 4);
    assert.equal(vetoes, 2);
    console.log(JSON.stringify({
      kind: "fictional-document-upload-tenant-proof",
      methods: ["POST /api/documents"], attackerEmployers: 2,
      victimEmployers: 1, ownPersistedUploads: positives,
      tenantAndInputDenials: denials, auditVetoRollbacks: vetoes,
      simulatedScannerOnly: true, claimedCoverageCredits: 0,
      independentSecurityReview: "PENDING", productionTested: false,
    }, null, 2));
  } finally {
    await pool.end();
  }
}
await main();
