/**
 * Manifest-driven, non-production HTTP/PG authorization test runner.
 * A method enters the registry only with an actual seeded own/foreign case.
 * All 494 manifest methods are read; outstanding GAPs are reported, NEVER
 * silently treated as successful coverage. Extensible by family adapters,
 * not hundreds of one-off tests. All writes below are fictional CI fixture SEEDING.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { assertLiveTenantCounts } from "../../tests/helpers/tenant-counts.mjs";
import {
  auditEvents, complianceActionTasks, employees, legalEntities, payrollRuns,
  statutoryRemittanceBatches, statutoryRemittancePaymentEvidence, statutoryPostingEvidenceArtifacts,
} from "../../src/db/schema";

const manifest = JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const specOf = (method, route) => method + " " + route;

function methodGaps() {
  return Object.entries(manifest.allApiRouteFiles).flatMap(([path, file]) =>
    file.methods.filter((m) => m.status === "GAP").map((method) => ({
      key: specOf(method.name, file.route),
      path, method: method.name,
      family: file.route.split("/")[0],
      record: method,
    })));
}

// Each entry is a *real method-specific adapter*, not a 401/empty-response
// placeholder. A single fixture family supplies high real IDs to its adapters.
const CASES = Object.freeze({
  "GET compliance/statutory-remittances/payment-evidence/[id]": {
    family: "download", denial: 403,
    path: ({ ownedEvidence, ownOrg, victimEvidence, victimOrg }) => ({
      own: "/api/compliance/statutory-remittances/payment-evidence/" +
        ownedEvidence.id + "?organizationId=" + ownOrg.id,
      foreign: "/api/compliance/statutory-remittances/payment-evidence/" +
        victimEvidence.id + "?organizationId=" + victimOrg.id,
    }),
    prove: (r, { ownBytes, ownedEvidence }) => {
      assert.equal(r.text, ownBytes.toString("utf8"), "Must return actual own payment proof bytes");
      assert.match(r.text, /^%PDF-/);
      assert.equal(r.headers.get("x-payment-proof-sha256"), ownedEvidence.fileSha256);
      assert.match(r.headers.get("content-disposition") ?? "", /^attachment/);
    },
  },
  "GET compliance/statutory-remittances/payment-evidence": {
    family: "download-index", denial: 403,
    path: ({ ownOrg, ownedBatch, victimOrg, victimBatch }) => ({
      own: "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
        ownOrg.id + "&batchId=" + ownedBatch.id,
      foreign: "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
        victimOrg.id + "&batchId=" + victimBatch.id,
    }),
    prove: (r, { ownOrg, ownedBatch, ownedEvidence, victimEvidence }) => {
      assert.equal(r.json?.organizationId, ownOrg.id,
        "Payment proof index must echo the authenticated employer scope");
      assert.equal(r.json?.batchId, ownedBatch.id,
        "Payment proof index must echo the real owned remittance batch");
      assert.ok(Array.isArray(r.json?.evidence));
      assert.ok(r.json.evidence.some((row) => row.id === ownedEvidence.id),
        "Must enumerate a real own evidence record");
      assert.ok(!r.json.evidence.some((row) => row.id === victimEvidence.id));
    },
  },
  "GET compliance/remittance-actions": {
    family: "statutory-case", denial: 403,
    path: ({ ownOrg, victimOrg }) => ({
      own: "/api/compliance/remittance-actions?organizationId=" + ownOrg.id,
      foreign: "/api/compliance/remittance-actions?organizationId=" + victimOrg.id,
    }),
    prove: (r, { ownOrg, ownedTask, victimTask }) => {
      assert.equal(r.json?.organizationId, ownOrg.id);
      assert.ok(r.json?.tasks?.some((x) => x.id === ownedTask.id),
        "Must enumerate an actual own-employer compliance task");
      assert.ok(!r.json?.tasks?.some((x) => x.id === victimTask.id),
        "Must not enumerate actual victim-only compliance task");
    },
  },
  "GET compliance/bir-1601c-remittances": {
    family: "statutory-read", denial: 403,
    path: ({ ownOrg, victimOrg }) => ({
      own: "/api/compliance/bir-1601c-remittances?organizationId=" + ownOrg.id,
      foreign: "/api/compliance/bir-1601c-remittances?organizationId=" + victimOrg.id,
    }),
    prove: (r, { ownEntity }) => {
      assert.equal(r.json?.legalEntity?.id, ownEntity.id,
        "BIR preview must resolve actual own legal-employer ID");
      assert.ok(Array.isArray(r.json?.batches));
    },
  },
  "GET compliance/government-loan-remittances": {
    family: "statutory-read", denial: 403,
    path: ({ ownOrg, victimOrg }) => ({
      own: "/api/compliance/government-loan-remittances?organizationId=" + ownOrg.id,
      foreign: "/api/compliance/government-loan-remittances?organizationId=" + victimOrg.id,
    }),
    prove: (r, { ownEntity }) => {
      assert.equal(r.json?.legalEntity?.id, ownEntity.id);
      assert.ok(Array.isArray(r.json?.batches));
    },
  },
  "GET compliance/statutory-remittances": {
    family: "statutory-read", denial: 403,
    path: ({ ownOrg, victimOrg }) => ({
      own: "/api/compliance/statutory-remittances?organizationId=" + ownOrg.id,
      foreign: "/api/compliance/statutory-remittances?organizationId=" + victimOrg.id,
    }),
    prove: (r, { ownOrg, ownEntity, ownedBatch }) => {
      assert.equal(r.json?.organizationId, ownOrg.id);
      assert.equal(r.json?.legalEntity?.id, ownEntity.id);
      assert.ok(Array.isArray(r.json?.batches));
      assert.ok(r.json.batches.some((batch) => batch.id === ownedBatch.id),
        "Statutory preview must include its real own remittance batch");
    },
  },
  "GET compliance/statutory-remittances/posting-evidence/[id]": {
    family: "download-posting-source", denial: 403,
    path: ({ ownedPosting, victimPosting }) => ({
      own: "/api/compliance/statutory-remittances/posting-evidence/" + ownedPosting.id,
      foreign: "/api/compliance/statutory-remittances/posting-evidence/" + victimPosting.id,
    }),
    prove: (r, { ownedPosting, ownPostingBytes }) => {
      assert.equal(r.text, ownPostingBytes.toString("utf8"), "Must download actual own source posting CSV");
      assert.equal(sha256(Buffer.from(r.text, "utf8")), ownedPosting.contentSha256,
        "Own posting bytes must match real PostgreSQL artifact digest");
      assert.match(r.headers.get("content-type") ?? "", /^text\/csv/i);
      assert.match(r.headers.get("content-disposition") ?? "", /^attachment;/);
      assert.ok(r.text.startsWith("Employee No,Posted Amount,Reference"),
        "Empty placeholder cannot count as downloadable posting evidence");
    },
  },
});
export const FIRST_ADAPTED_METHODS = Object.freeze(Object.keys(CASES));

async function snapshotVictim(victimId) {
  const [batches, evidence, posting, tasks, employers, runs, staff, audit] = await Promise.all([
    db.select().from(statutoryRemittanceBatches)
      .where(eq(statutoryRemittanceBatches.organizationId, victimId))
      .orderBy(statutoryRemittanceBatches.id),
    db.select().from(statutoryRemittancePaymentEvidence)
      .where(eq(statutoryRemittancePaymentEvidence.organizationId, victimId))
      .orderBy(statutoryRemittancePaymentEvidence.id),
    db.select().from(statutoryPostingEvidenceArtifacts)
      .where(eq(statutoryPostingEvidenceArtifacts.organizationId, victimId))
      .orderBy(statutoryPostingEvidenceArtifacts.id),
    db.select().from(complianceActionTasks).where(eq(complianceActionTasks.organizationId, victimId))
      .orderBy(complianceActionTasks.id),
    db.select().from(legalEntities).where(eq(legalEntities.organizationId, victimId))
      .orderBy(legalEntities.id),
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, victimId))
      .orderBy(payrollRuns.id),
    db.select().from(employees).where(eq(employees.organizationId, victimId))
      .orderBy(employees.id),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, victimId))
      .orderBy(auditEvents.id),
  ]);
  return { batches, evidence, posting, tasks, employers, runs, staff, audit };
}
async function seedStatutoryFixtures(f) {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ orgIndex: 0, month: "2025-0" + (i + 1) })),
    { orgIndex: 1, month: "2025-09" },
    { orgIndex: 2, month: "2025-10" },
    // Select the real victim-only target AFTER both attacker-owned objects.
    { orgIndex: 0, month: "2025-11" },
  ];
  const batches = await db.insert(statutoryRemittanceBatches).values(rows.map((row, i) => ({
    organizationId: f.orgs[row.orgIndex].id,
    legalEntityId: f.entities[row.orgIndex].id,
    agency: "SSS", applicableMonth: row.month, dueDate: "2025-12-15",
    snapshotHash: sha256(Buffer.from("CI-BATCH-" + nonce + "-" + i)),
    createdBy: f.owners[row.orgIndex].name,
  }))).returning({ id: statutoryRemittanceBatches.id,
    organizationId: statutoryRemittanceBatches.organizationId,
    legalEntityId: statutoryRemittanceBatches.legalEntityId });
  const bytes = rows.map((row, i) => Buffer.from("%PDF-1.4\nSYNTHETIC-ONLY-" +
    row.orgIndex + "-" + nonce + "-" + i + "\n%%EOF\n"));
  const evidence = await db.insert(statutoryRemittancePaymentEvidence)
    .values(rows.map((row, i) => ({
      organizationId: f.orgs[row.orgIndex].id, batchId: batches[i].id,
      fileName: "fictitious-payment-proof-" + nonce + "-" + i + ".pdf",
      mimeType: "application/pdf", byteSize: bytes[i].byteLength,
      fileSha256: sha256(bytes[i]), fileDataBase64: bytes[i].toString("base64"),
      uploadedByName: f.owners[row.orgIndex].name,
    }))).returning({ id: statutoryRemittancePaymentEvidence.id,
      organizationId: statutoryRemittancePaymentEvidence.organizationId,
      batchId: statutoryRemittancePaymentEvidence.batchId,
      fileSha256: statutoryRemittancePaymentEvidence.fileSha256 });
  const postingBytes = rows.map((row, i) => Buffer.from("Employee No,Posted Amount,Reference\n" +
    "FICTIONAL-" + row.orgIndex + "-" + nonce + "-" + i + ",0.00,CI-ONLY\n"));
  const posting = await db.insert(statutoryPostingEvidenceArtifacts)
    .values(rows.map((row, i) => ({
      organizationId: f.orgs[row.orgIndex].id, batchId: batches[i].id,
      sourceType: "csv_import", outcome: "accepted",
      fileName: "synthetic-posting-source-" + nonce + "-" + i + ".csv",
      mimeType: "text/csv; charset=utf-8", byteSize: postingBytes[i].byteLength,
      contentSha256: sha256(postingBytes[i]),
      fileDataBase64: postingBytes[i].toString("base64"),
      recordedByName: f.owners[row.orgIndex].name,
    }))).returning({
      id: statutoryPostingEvidenceArtifacts.id,
      organizationId: statutoryPostingEvidenceArtifacts.organizationId,
      batchId: statutoryPostingEvidenceArtifacts.batchId,
      contentSha256: statutoryPostingEvidenceArtifacts.contentSha256,
    });
  const tasks = await db.insert(complianceActionTasks).values(rows.map((row, i) => ({
    organizationId: f.orgs[row.orgIndex].id,
    sourceType: "statutory_remittance", sourceKey: "CI-CASE-" + nonce + "-" + i,
    severity: "warning", title: "Fictional missing compliance evidence " + i,
    detail: "Synthetic test task without real payment or provider events",
  }))).returning({ id: complianceActionTasks.id, organizationId: complianceActionTasks.organizationId });
  assert.ok(batches[7].id > 6 && evidence[7].id > 6 && tasks[7].id > 6,
    "Real victim-only high IDs must exist in disposable PostgreSQL");
  assert.ok(batches[10].id > batches[9].id && evidence[10].id > evidence[9].id &&
    posting[10].id > posting[9].id && tasks[10].id > tasks[9].id,
    "Selected existing victim-only object IDs must exceed both attacker objects");
  return { batches, evidence, posting, postingBytes, tasks, bytes, nonce };
}
export async function verifyManifestDrivenStatutoryBatch(f, { request, expectStatus, makeSession }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).hostname, "127.0.0.1");
  const gaps = methodGaps();
  assert.equal(gaps.length, manifest.metrics.gap, "No inaccurate method-level GAP baseline");
  verifyBir2316HistoricalGapBaseline(gaps);
  const certifiedGovernance = manifest.allApiRouteFiles["src/app/api/hcm/governance-readiness/route.ts"]?.methods.find((method) => method.name === "GET");
  assert.equal(certifiedGovernance?.status, "COVERED", "Closing a GAP requires independently exercised tenant-proof evidence");
  assert.equal(certifiedGovernance?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs", "HCM GET must retain the real authenticated own/foreign HTTP proof");
  const gapNames = new Set(gaps.map((x) => x.key));
  const methodByKey = new Map(Object.values(manifest.allApiRouteFiles).flatMap((file) =>
    file.methods.map((method) => [specOf(method.name, file.route), method])));
  for (const key of FIRST_ADAPTED_METHODS) {
    assert.ok(["GAP", "COVERED"].includes(methodByKey.get(key)?.status),
      "A test adapter cannot claim an unrecognized method: " + key);
  }
  // Retain the previously-credited BIR GET as a regression, but never
  // count it as a newly closed GAP after the main audit merge.
  const alreadyCoveredCases = FIRST_ADAPTED_METHODS.filter((key) => !gapNames.has(key));
  const candidates = [...gaps, ...alreadyCoveredCases.map((key) => ({ key }))];
  const fixtures = await seedStatutoryFixtures(f);
  const victimOrg = f.orgs[0];
  const victimEvidence = fixtures.evidence[10];
  const victimBatch = fixtures.batches[10];
  const victimTask = fixtures.tasks[10];
  const victimPosting = fixtures.posting[10];
  const [persistedVictimPosting] = await db.select().from(statutoryPostingEvidenceArtifacts)
    .where(eq(statutoryPostingEvidenceArtifacts.id, victimPosting.id)).limit(1);
  assert.equal(persistedVictimPosting?.organizationId, victimOrg.id,
    "Actual higher-ID victim-only posting source must exist in real PostgreSQL");
  assert.equal(persistedVictimPosting?.batchId, victimBatch.id);
  const [persistedVictimEvidence] = await db.select().from(statutoryRemittancePaymentEvidence)
    .where(eq(statutoryRemittancePaymentEvidence.id, victimEvidence.id)).limit(1);
  const [persistedVictimBatch] = await db.select().from(statutoryRemittanceBatches)
    .where(eq(statutoryRemittanceBatches.id, victimBatch.id)).limit(1);
  assert.equal(persistedVictimEvidence?.organizationId, victimOrg.id,
    "Actual victim-only proof must exist in PostgreSQL and belong only to the victim");
  assert.equal(persistedVictimEvidence?.batchId, victimBatch.id,
    "Existing victim-only proof must refer to the actual victim remittance batch");
  assert.equal(persistedVictimBatch?.organizationId, victimOrg.id,
    "Actual victim remittance batch must exist and be scoped to victim employer");
  const before = await snapshotVictim(victimOrg.id);
  const observations = [];
  for (const idx of [1, 2]) {
    const ownOrg = f.orgs[idx];
    const ownEntity = f.entities[idx];
    const ownedBatch = fixtures.batches[7 + idx];
    const ownedEvidence = fixtures.evidence[7 + idx];
    const ownedTask = fixtures.tasks[7 + idx];
    const ownBytes = fixtures.bytes[7 + idx];
    const ownedPosting = fixtures.posting[7 + idx];
    const ownPostingBytes = fixtures.postingBytes[7 + idx];
    assert.equal(ownedPosting.organizationId, ownOrg.id);
    assert.equal(ownedPosting.batchId, ownedBatch.id);
    assert.equal(victimPosting.organizationId, victimOrg.id);
    assert.ok(victimPosting.id > ownedPosting.id,
      "Real victim-only posting ID must be greater than the attacker's own posting ID");
    assert.equal(ownedEvidence.organizationId, ownOrg.id);
    assert.equal(ownedEvidence.batchId, ownedBatch.id);
    assert.equal(ownedBatch.organizationId, ownOrg.id);
    assert.equal(victimEvidence.organizationId, victimOrg.id);
    assert.equal(victimBatch.organizationId, victimOrg.id);
    assert.ok(victimEvidence.id > ownedEvidence.id && victimBatch.id > ownedBatch.id &&
      victimTask.id > ownedTask.id, "Victim-only IDs must exceed this attacker-owned object's IDs");
    const actor = { ownOrg, ownEntity, ownedBatch, ownedEvidence, ownedTask, ownBytes,
      ownedPosting, ownPostingBytes, victimOrg, victimBatch, victimEvidence, victimTask, victimPosting, f };
    const cookie = f.ownerSessions[idx].cookie;
    const account = expectStatus(await request("/api/account", { cookie }), 200,
      "Table-driven attacker must actually be signed in before own/foreign proofs");
    assert.equal(account.json?.profile?.id, f.owners[idx].id);

    for (const item of candidates) {
      const adapter = CASES[item.key];
      if (!adapter) continue; // GAP remains open; never credit or label safe.
      const urls = adapter.path(actor);
      const own = expectStatus(await request(urls.own, { cookie }), 200,
        item.key + " requires legitimate real-own-object access");
      adapter.prove(own, actor);
      const foreign = expectStatus(await request(urls.foreign, { cookie }), adapter.denial,
        item.key + " must reject another real employer's record");
      assert.ok(!foreign.text.includes("SYNTHETIC-ONLY-0-" + fixtures.nonce),
        item.key + ": actual victim-only document bytes leaked");
      observations.push({ key: item.key, employer: idx, positive: 200,
        foreignDenied: adapter.denial });
      console.log("PASS manifest-driven " + item.key + " authenticated attacker " + idx);

      // Same-employer selector pointing at an ACTUAL victim document: 404,
      // never made-up/empty-ID denial, and no victim bytes returned.
      if (item.key === "GET compliance/statutory-remittances/payment-evidence/[id]") {
        const crossId = expectStatus(await request(
          "/api/compliance/statutory-remittances/payment-evidence/" + victimEvidence.id +
          "?organizationId=" + ownOrg.id, { cookie }), 404,
        "Foreign existing proof ID cannot be read under own authorized employer");
        assert.ok(!crossId.text.startsWith("%PDF-"));
      }
      if (item.key === "GET compliance/statutory-remittances/payment-evidence") {
        const filtered = expectStatus(await request(
          "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
          ownOrg.id + "&batchId=" + victimBatch.id, { cookie }), 404,
        "Foreign real batch under own employer must be unavailable, not verified empty");
        assert.ok(!filtered.text.includes("SYNTHETIC-ONLY-0-" + fixtures.nonce),
          "Foreign batch denial must not reveal victim proof bytes or metadata");
      }
      if (item.key === "GET compliance/statutory-remittances/posting-evidence/[id]") {
        const forged = expectStatus(await request(
          "/api/compliance/statutory-remittances/posting-evidence/" + ownedPosting.id +
          "?organizationId=" + victimOrg.id + "&batchId=" + victimBatch.id, { cookie }), 200,
        "Posting GET must ignore forged victim organization and batch selectors");
        assert.equal(forged.text, ownPostingBytes.toString("utf8"));
        const denied = expectStatus(await request(
          "/api/compliance/statutory-remittances/posting-evidence/" + victimPosting.id +
          "?organizationId=" + ownOrg.id, { cookie }), 403,
        "Real higher-ID victim posting source denied even when attacker spoofs own employer");
        assert.ok(!denied.text.includes("FICTIONAL-0-" + fixtures.nonce));
      }
    }
    // This POST proof uses a real production-mode HTTP handler, a real
    // disposable-PG16 batch and a narrowly scoped CI-only TLS scan stub.
    // It never reaches a provider or proves production malware acceptance.
    const privileged = await makeSession(f.owners[idx].id, { privileged: true });
    const bytesFor = (tag) => Buffer.from("%PDF-1.4\nSYNTHETIC-PROOF-TENANT-QA:" + fixtures.nonce + ":" + idx + ":" + tag + "\n%%EOF\n");
    function proofForm(orgId, batchId, tag = "initial") {
      const form = new FormData();
      form.append("organizationId", String(orgId));
      form.append("batchId", String(batchId));
      form.append("replacementReason", "Synthetic CI replacement; no real statutory payment");
      form.append("file", new File([bytesFor(tag)], "synthetic-proof-" + idx + "-" + tag + ".pdf", { type: "application/pdf" }));
      return form;
    }
    const ownUpload = expectStatus(await request("/api/compliance/statutory-remittances/payment-evidence", {
      method: "POST", cookie: privileged.cookie, form: proofForm(ownOrg.id, ownedBatch.id),
    }), 201, "MFA-verified synthetic employer can store its own test payment proof");
    assert.equal(ownUpload.json?.organizationId, ownOrg.id, "POST response must echo the owning employer");
    assert.equal(ownUpload.json?.batchId, ownedBatch.id, "POST response must echo the real owned batch");
    assert.ok(Number.isSafeInteger(ownUpload.json?.evidence?.id), "Owned upload must return a real stored proof ID");
    const foreignUpload = expectStatus(await request("/api/compliance/statutory-remittances/payment-evidence", {
      method: "POST", cookie: privileged.cookie, form: proofForm(victimOrg.id, victimBatch.id),
    }), 403, "Authenticated employee may never upload a proof to a foreign real employer");
    assert.ok(!foreignUpload.text.includes("SYNTHETIC-ONLY-0-"), "Foreign upload must reveal no victim evidence");
    expectStatus(await request("/api/compliance/statutory-remittances/payment-evidence", {
      method: "POST", cookie: privileged.cookie, form: proofForm(ownOrg.id, victimBatch.id),
    }), 404, "A real victim batch ID must not be writable under the attacker's organization");
    // Concurrent own-batch replacements must never create two active records.
    const contenders = await Promise.all(["race-a", "race-b", "race-c", "race-d"].map(tag =>
      request("/api/compliance/statutory-remittances/payment-evidence", {
        method: "POST", cookie: privileged.cookie, form: proofForm(ownOrg.id, ownedBatch.id, tag),
      })));
    assert.ok(contenders.some(result => result.status === 201),
      "At least one parallel valid replacement must succeed");
    for (const attempt of contenders) {
      assert.ok(attempt.status === 201 || attempt.status === 409,
        "Parallel replacements must serialize or fail closed: " + attempt.status + " " + attempt.text.slice(0, 120));
      if (attempt.status === 201) {
        assert.equal(attempt.json?.organizationId, ownOrg.id);
        assert.equal(attempt.json?.batchId, ownedBatch.id);
      }
    }
    const indexAfterRace = expectStatus(await request(
      "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
      ownOrg.id + "&batchId=" + ownedBatch.id, { cookie: privileged.cookie }), 200,
      "Concurrent replacements must preserve a verified owned-batch index");
    const activeAfterRace = indexAfterRace.json?.evidence?.filter(row => row.status === "active") ?? [];
    assert.equal(activeAfterRace.length, 1,
      "Concurrent distinct-file replacements must leave exactly one active record");
    assert.equal(indexAfterRace.json?.active?.id, activeAfterRace[0].id,
      "The active metadata must identify the sole active receipt");
  }
  const after = await snapshotVictim(victimOrg.id);
  assert.deepEqual(after, before,
    "All real-HTTP own/foreign reads must leave victim employer evidence, tasks, employee, payroll and audit data unchanged");
  // HTTP 201 must have a matching durable employer/batch audit receipt.
  // CI seed rows predate this route, so only audit proof IDs created via HTTP.
  for (const idx of [1, 2]) {
    const organizationId = f.orgs[idx].id;
    const batchId = fixtures.batches[7 + idx].id;
    const seededProofId = fixtures.evidence[7 + idx].id;
    const [proofs, events] = await Promise.all([
      db.select({ id: statutoryRemittancePaymentEvidence.id,
        fileSha256: statutoryRemittancePaymentEvidence.fileSha256 })
        .from(statutoryRemittancePaymentEvidence)
        .where(and(eq(statutoryRemittancePaymentEvidence.organizationId, organizationId),
          eq(statutoryRemittancePaymentEvidence.batchId, batchId))),
      db.select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents).where(eq(auditEvents.organizationId, organizationId)),
    ]);
    const audited = new Map(events.filter(event =>
      event.metadata?.batchId === batchId &&
      ["Statutory remittance payment proof replaced",
        "Statutory remittance payment proof uploaded",
        "Historical statutory remittance payment proof backfilled"].includes(event.action)
    ).map(event => [event.metadata.evidenceId, event.metadata.fileSha256]));
    const newProofs = proofs.filter(proof => proof.id !== seededProofId);
    assert.ok(newProofs.length >= 2, "Fixture must execute a real POST and concurrent replacement");
    for (const proof of newProofs) {
      assert.equal(audited.get(proof.id), proof.fileSha256,
        "Every HTTP-committed receipt must have a matching same-employer/batch audit row");
    }
  }
  assert.equal(observations.length, FIRST_ADAPTED_METHODS.length * 2);
  assert.equal(new Set(observations.map((x) => x.key)).size, FIRST_ADAPTED_METHODS.length);
  console.log(JSON.stringify({
    kind: "DISPOSABLE_PG16_REAL_HTTP", auditSuite: "manifest-driven-statutes",
    manifestedMethods: manifest.metrics.methods,
    preexistingGaps: gaps.length, previouslyCoveredRegressionMethods: alreadyCoveredCases.length,
    newlyAdaptedGapMethods: FIRST_ADAPTED_METHODS.length - alreadyCoveredCases.length,
    distinctMethodsPassedInThisBatch: FIRST_ADAPTED_METHODS.length,
    independentAttackerEmployers: 2, completePositiveAndVictimDenialPairs: observations.length,
    sourceTraceCandidates: manifest.sourceTraceCandidates.length,
    unadaptedGapMethodsStillOpen: gaps.length - (FIRST_ADAPTED_METHODS.length - alreadyCoveredCases.length),
    trackedPagesStillOpen: manifest.scopedPages.length,
    highExistingVictimIds: [victimBatch.id, victimEvidence.id, victimPosting.id, victimTask.id],
    victimDatabaseUnchanged: true, productionTested: false, certified: false,
  }));
}
/** Keep the historical statutory HTTP test's exact source-pinned request lines
 * stable when new independently reviewed BIR method evidence is introduced.
 * Called by the real signed-in PG16 harness, never an acceptance bypass. */
function verifyBir2316HistoricalGapBaseline(gaps) {
  // Preserve the pre-#1353/#1361 baseline (149 covered / 335 gaps) while
  // crediting three separately exercised BIR 2316 document methods and
  // one distinct successful payroll accounting-close POST.
  // A generic "three fewer gaps" subtraction is insufficient: require exact
  // GET/GET/POST identities and live own/victim evidence from their separate
  // synthetic HTTPS + PostgreSQL acceptance suite.
  const bir2316Methods = [
    ["src/app/api/separation/[id]/2316/route.ts", "GET", "ownDraft", "foreignDraft"],
    ["src/app/api/year-end/2316-certificate/route.ts", "GET", "ownSource", "foreignSource"],
    ["src/app/api/year-end/2316-certificate/route.ts", "POST", "ownPdf", "foreignPdf"],
  ];
  const proofFile = "scripts/qa/tenant-bir2316-http.mjs";
  const proofLines = readFileSync(proofFile, "utf8").split("\n");
  for (const [path, verb, own, foreign] of bir2316Methods) {
    const matching = manifest.allApiRouteFiles[path]?.methods.filter((m) => m.name === verb);
    assert.equal(matching?.length, 1, path + " " + verb + ": exact method required");
    const entry = matching[0];
    assert.equal(entry.status, "COVERED", path + " " + verb + ": only tested 2316 methods count");
    assert.equal(entry.testedBy?.file, proofFile, path + " " + verb + ": own/foreign PG16 proof required");
    assert.match(proofLines[entry.testedBy.ownPositiveLine - 1] ?? "",
      new RegExp("const " + own + " = expectStatus\\(await request\\("),
      path + " " + verb + ": own 2316 success must have a real HTTP request");
    assert.match(proofLines[entry.testedBy.foreignDenialLine - 1] ?? "",
      new RegExp("const " + foreign + " = expectStatus\\(await request\\("),
      path + " " + verb + ": a foreign victim denial must be exercised");
    if (verb === "POST") {
      assert.match(proofLines[entry.testedBy.unchangedDbLine - 1] ?? "",
        /assert\.deepEqual\(victimAfter, victimBefore/,
        "Unsigned PDF POST must leave the real victim database and audit untouched");
    }
  }
  const expenseBenefitMethods = Object.values(manifest.allApiRouteFiles).flatMap(route => route.methods)
    .filter(method => method.testedBy?.file === "scripts/qa/tenant-mny02-expenses-benefits-http.mjs");
  assert.equal(expenseBenefitMethods.length, 6, "Six independent expenses/de minimis HTTP proofs required");
  const piiReviewMethods = manifest.allApiRouteFiles["src/app/api/employee-identifier-requests/route.ts"]?.methods.filter(
    method => method.status === "COVERED" && method.testedBy?.file === "scripts/qa/tenant-pii01-identifier-review-http.mjs",
  ) ?? [];
  assert.deepEqual(piiReviewMethods.map(method => method.name), ["GET", "POST"],
    "Two distinct PII identifier review HTTP proofs must not be double-counted");
  // #1361 must add a genuinely successful POST, never reuse payroll-close GET.
  // The owning and foreign employer controls run inside disposable PG16 real HTTP.
  const closePost = manifest.allApiRouteFiles["src/app/api/payroll-runs/[id]/close/route.ts"]
    ?.methods.find((method) => method.name === "POST");
  assert.equal(closePost?.status, "COVERED",
    "Additional close POST credit requires separate executed positive/negative evidence");
  assert.equal(closePost.testedBy?.file, "scripts/qa/tenant-high-risk-01-http.mjs");
  const closeProof = closePost.testedBy;
  const closeSource = readFileSync(closeProof.file, "utf8");
  const closeLines = closeSource.split("\n");
  assert.deepEqual([closeProof.ownPositiveLine, closeProof.foreignDenialLine,
    closeProof.unchangedDbLine], [444, 456, 465],
    "Accounting-close POST must retain its exact own/victim/unchanged SQL proof");
  assert.match(closeLines[closeProof.ownPositiveLine - 1] ?? "",
    /const ownPost = expectStatus\(await request\(closeUrl, \{/);
  assert.match(closeLines.slice(closeProof.ownPositiveLine - 1,
    closeProof.ownPositiveLine + 3).join("\n"),
    /cookie, method: "POST"[\s\S]*\}\), 200,/);
  assert.match(closeLines[closeProof.foreignDenialLine - 1] ?? "",
    /const foreignPost = expectStatus\(await request\("\/api\/payroll-runs\/" \+ f\.victimRun\.id \+ "\/close"/);
  assert.match(closeLines.slice(closeProof.foreignDenialLine - 1,
    closeProof.foreignDenialLine + 7).join("\n"),
    /cookie, method: "POST"[\s\S]*\}\), 403,/);
  assert.match(closeLines[closeProof.unchangedDbLine - 1] ?? "",
    /assert\.deepEqual\(victimAfter, victimBefore/);
  assert.match(closeSource, /await verifyPayrollClosePostIsolation\(f, \{ request, expectStatus, makeSession \}\);/);
  assert.match(closeSource, /event\.action === "Payroll close completed"/,
    "Own close POST must persist a matching accounting audit receipt");
  const closePostCredits = 1;
  // Totals are invariants (tallies add up; nothing proven regresses against the base), not pinned
  // numbers that every later credit would have to edit.
  assertLiveTenantCounts(assert, manifest);
}

// Appended to preserve existing executable proof line pins above.
import { verifyMergedProofCredits } from "./tenant-merged-proof-credits.mjs";
verifyMergedProofCredits(manifest);
