/**
 * Manifest-driven, non-production HTTP/PG authorization test runner.
 * A method enters the registry only with an actual seeded own/foreign case.
 * All 493 manifest methods are read; outstanding GAPs are reported, NEVER
 * silently treated as successful coverage. Extensible by family adapters,
 * not hundreds of one-off tests. All writes below are fictional CI fixture SEEDING.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
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
    prove: (r, { ownedEvidence, victimEvidence }) => {
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
export async function verifyManifestDrivenStatutoryBatch(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).hostname, "127.0.0.1");
  const gaps = methodGaps();
  assert.equal(gaps.length, manifest.metrics.gap, "No inaccurate method-level GAP baseline");
  assert.equal(gaps.length, 383, "Merged main, loan and legacy DOLE proofs retained; unverified methods stay GAP");
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
          ownOrg.id + "&batchId=" + victimBatch.id, { cookie }), 200,
        "Legitimate own-employer filter with another employer's batch ID");
        assert.deepEqual(filtered.json?.evidence, [],
          "Foreign batch must not enumerate victim proof bytes or metadata");
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
  }
  const after = await snapshotVictim(victimOrg.id);
  assert.deepEqual(after, before,
    "All real-HTTP own/foreign reads must leave victim employer evidence, tasks, employee, payroll and audit data unchanged");
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
