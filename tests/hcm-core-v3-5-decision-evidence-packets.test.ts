import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  canonicalJson,
  evidenceSha256,
  EMPLOYMENT_DECISION_EVIDENCE_KINDS,
  EMPLOYMENT_DECISION_NOTE_KINDS,
} from "../src/lib/hcm-employment-decision-evidence";

const read = (path: string) => readFileSync(path, "utf8");

test("Core 3.5 migration adds sealed decision evidence and append-only packet ledgers", () => {
  const migration = read("drizzle/0061_hcm_employment_decision_evidence.sql");
  assert.ok(migration.includes('"evidence_snapshot_sha256" varchar(64)'));
  assert.ok(migration.includes('"evidence_sealed_at" timestamptz'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_employment_decision_notes"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_employment_decision_documents"'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_employment_decision_events"'));
  assert.ok(migration.includes("hcm_employment_decision_document_unique"));
  assert.ok(migration.includes("'manager_review','hr_review','decision_rationale','other'"));
  assert.ok(migration.includes("'probation_evaluation','performance_review','contract','manager_recommendation','other'"));
});

test("Core 3.5 backfills legacy request approval application and cancellation history idempotently", () => {
  const migration = read("drizzle/0061_hcm_employment_decision_evidence.sql");
  for (const event of ["requested", "approved", "applied", "cancelled"]) {
    assert.ok(migration.includes(`'${event}'`));
  }
  assert.ok(migration.includes("WHERE NOT EXISTS"));
  assert.ok(migration.includes("d.\"approved_at\" IS NOT NULL"));
  assert.ok(migration.includes("d.\"applied_at\" IS NOT NULL"));
  assert.ok(migration.includes("d.\"cancelled_at\" IS NOT NULL"));
});

test("evidence hashing is canonical and insensitive to object key order", () => {
  const left = { b: 2, a: { y: "yes", x: [3, 2, 1] } };
  const right = { a: { x: [3, 2, 1], y: "yes" }, b: 2 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(evidenceSha256(left), evidenceSha256(right));
  assert.match(evidenceSha256(left), /^[a-f0-9]{64}$/);
});

test("evidence vocabularies are explicit and bounded", () => {
  assert.deepEqual([...EMPLOYMENT_DECISION_NOTE_KINDS], [
    "manager_review",
    "hr_review",
    "decision_rationale",
    "other",
  ]);
  assert.deepEqual([...EMPLOYMENT_DECISION_EVIDENCE_KINDS], [
    "probation_evaluation",
    "performance_review",
    "contract",
    "manager_recommendation",
    "other",
  ]);
});

test("approval locks the decision row and seals proposal plus source-term review evidence", () => {
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  assert.ok(source.includes("for update"));
  assert.ok(source.includes('decision.status !== "pending_approval"'));
  assert.ok(source.includes("proposalSnapshot"));
  assert.ok(source.includes("evidenceSha256(reviewEvidence)"));
  assert.ok(source.includes("evidenceSnapshotSha256: snapshotSha256"));
  assert.ok(source.includes("evidenceSealedAt: now"));
  assert.ok(source.includes('eventType: "approved"'));
  assert.ok(source.includes("Four-eyes control"));
});

test("approval refuses production evidence that has not passed malware scanning", () => {
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  assert.ok(source.includes("attachments.some"));
  assert.ok(source.includes("!document.scannedClean"));
  assert.ok(source.includes('process.env.NODE_ENV === "production"'));
  assert.ok(source.includes("must pass malware scanning before approval"));
});

test("decision endpoint uses evidence-sealing approval instead of directly stamping approval", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/route.ts");
  assert.ok(route.includes("approveEmploymentDecisionWithEvidence"));
  assert.ok(route.includes("DecisionEvidenceApprovalError"));
  assert.ok(route.includes("evidenceSnapshotSha256"));
  assert.ok(route.includes("evidenceNoteCount"));
  assert.ok(route.includes("evidenceAttachmentCount"));
});

test("secure evidence API permits company People admins or the worker's current linked manager", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts");
  assert.ok(route.includes("WORKFORCE_MANAGER_ROLES"));
  assert.ok(route.includes("roleAllowed(access.role, PEOPLE_ADMIN_ROLES)"));
  assert.ok(route.includes('access.role !== "manager"'));
  assert.ok(route.includes("positions.managerEmployeeId"));
  assert.ok(route.includes("eq(positions.managerEmployeeId, user.employeeId)"));
  assert.ok(route.includes("isNull(positionAssignments.effectiveUntil)"));
  assert.ok(route.includes("This worker is not currently assigned to you as manager."));
});

test("managers can contribute manager review notes but cannot masquerade as HR evidence", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts");
  assert.ok(route.includes('gate.managerReviewOnly && noteKind !== "manager_review"'));
  assert.ok(route.includes("Managers can contribute manager-review notes only."));
  assert.ok(route.includes("createdByUserId: user.id"));
  assert.ok(route.includes("createdByName: user.name"));
});

test("evidence upload reuses file validation malware scanning hashing and employee binding", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts");
  assert.ok(route.includes("documentUploadsEnabled"));
  assert.ok(route.includes("MAX_UPLOAD_BYTES"));
  assert.ok(route.includes("validateUpload"));
  assert.ok(route.includes("scanUpload"));
  assert.ok(route.includes('kind: "employment_decision_evidence"'));
  assert.ok(route.includes("employeeId: locked.employeeId"));
  assert.ok(route.includes('createHash("sha256")'));
  assert.ok(route.includes("documentId: document.id"));
  assert.ok(route.includes('eventType: "document_attached"'));
});

test("review evidence cannot be appended after the decision leaves pending approval", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts");
  const occurrences = route.split('locked.status !== "pending_approval"').length - 1;
  assert.ok(occurrences >= 2);
  assert.ok(route.includes("Review evidence is sealed once an employment decision leaves pending approval."));
  assert.equal(route.includes("export async function DELETE"), false);
  assert.equal(route.includes("export async function PATCH"), false);
});

test("packet export contains integrity state, timeline, and content hashes without embedding file bytes", () => {
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  const route = read("src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts");
  assert.ok(source.includes('packetVersion: "hcm-employment-decision-packet-v1"'));
  assert.ok(source.includes("sealedSha256"));
  assert.ok(source.includes('status: sealedHash'));
  assert.ok(source.includes('"verified" : "mismatch"'));
  assert.ok(source.includes("timeline: events"));
  assert.ok(route.includes('url.searchParams.get("download") === "1"'));
  assert.ok(route.includes('Content-Disposition'));
  assert.ok(route.includes("JSON.stringify(packet, null, 2)"));
  assert.equal(source.includes("document.content"), false);
});

test("decision application and non-renewal Separation append lifecycle evidence events", () => {
  const decisionLib = read("src/lib/hcm-employment-term-decisions.ts");
  const separation = read("src/app/api/separation/route.ts");
  assert.ok(decisionLib.includes('eventType: "applied"'));
  assert.ok(decisionLib.includes('eventType: "failed"'));
  assert.ok(separation.includes('eventType: "separation_started"'));
  assert.ok(separation.includes('eventType: "separation_completed"'));
  assert.ok(separation.includes("hcmEmploymentDecisionEvents"));
});

test("HR decision UI and manager notification inbox both expose the same evidence packet", () => {
  const worker = read("src/components/hcm-employment-lifecycle-worker.tsx");
  const inbox = read("src/components/hcm-lifecycle-notification-inbox.tsx");
  const evidence = read("src/components/hcm-employment-decision-evidence.tsx");
  assert.ok(worker.includes("HcmEmploymentDecisionEvidence"));
  assert.ok(inbox.includes("HcmEmploymentDecisionEvidence"));
  assert.ok(inbox.includes("Evidence"));
  assert.ok(evidence.includes("Download packet"));
  assert.ok(evidence.includes("Add immutable note"));
  assert.ok(evidence.includes("Attach evidence"));
  assert.ok(evidence.includes("APPROVAL &amp; LIFECYCLE HISTORY"));
});

test("Core 3.5 evidence packet does not acquire authority to change employment state", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts");
  const source = read("src/lib/hcm-employment-decision-evidence.ts");
  assert.equal(route.includes('status: "Separated"'), false);
  assert.equal(route.includes("activateEmploymentTerm"), false);
  assert.equal(route.includes("separationHandoffStatus: "started""), false);
  assert.equal(source.includes("activateEmploymentTerm"), false);
});
