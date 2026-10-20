/**
 * Manifest-driven, non-production HTTP/PG authorization test runner.
 * A method enters the registry only with an actual seeded own/foreign case.
 * All 490 manifest methods are read; outstanding GAPs are reported, NEVER
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
  statutoryRemittanceBatches, statutoryRemittancePaymentEvidence,
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
// placeholder. A single fixture family supplies high real IDs to all six.
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
});
export const FIRST_ADAPTED_METHODS = Object.freeze(Object.keys(CASES));

async function snapshotVictim(victimId) {
  const [batches, evidence, tasks, employers, runs, staff, audit] = await Promise.all([
    db.select().from(statutoryRemittanceBatches)
      .where(eq(statutoryRemittanceBatches.organizationId, victimId))
      .orderBy(statutoryRemittanceBatches.id),
    db.select().from(statutoryRemittancePaymentEvidence)
      .where(eq(statutoryRemittancePaymentEvidence.organizationId, victimId))
      .orderBy(statutoryRemittancePaymentEvidence.id),
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
  return { batches, evidence, tasks, employers, runs, staff, audit };
}
async function seedStatutoryFixtures(f) {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ orgIndex: 0, month: "2025-0" + (i + 1) })),
    { orgIndex: 1, month: "2025-09" },
    { orgIndex: 2, month: "2025-10" },
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
  const tasks = await db.insert(complianceActionTasks).values(rows.map((row, i) => ({
    organizationId: f.orgs[row.orgIndex].id,
    sourceType: "statutory_remittance", sourceKey: "CI-CASE-" + nonce + "-" + i,
    severity: "warning", title: "Fictional missing compliance evidence " + i,
    detail: "Synthetic test task without real payment or provider events",
  }))).returning({ id: complianceActionTasks.id, organizationId: complianceActionTasks.organizationId });
  assert.ok(batches[7].id > 6 && evidence[7].id > 6 && tasks[7].id > 6,
    "Real victim-only high IDs must exist in disposable PostgreSQL");
  return { batches, evidence, tasks, bytes, nonce };
}
export async function verifyManifestDrivenStatutoryBatch(f, { request, expectStatus, makeSession }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).hostname, "127.0.0.1");
  const gaps = methodGaps();
  assert.equal(gaps.length, manifest.metrics.gap, "No inaccurate method-level GAP baseline");
  assert.equal(gaps.length, 420, "HCM and statutory proof GET/POST use specific tenant evidence; 420 GAPs remain open");
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
  const victimEvidence = fixtures.evidence[7];
  const victimBatch = fixtures.batches[7];
  const victimTask = fixtures.tasks[7];
  const before = await snapshotVictim(victimOrg.id);
  const observations = [];
  for (const idx of [1, 2]) {
    const ownOrg = f.orgs[idx];
    const ownEntity = f.entities[idx];
    const ownedBatch = fixtures.batches[7 + idx];
    const ownedEvidence = fixtures.evidence[7 + idx];
    const ownedTask = fixtures.tasks[7 + idx];
    const ownBytes = fixtures.bytes[7 + idx];
    const actor = { ownOrg, ownEntity, ownedBatch, ownedEvidence, ownedTask, ownBytes,
      victimOrg, victimBatch, victimEvidence, victimTask, f };
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
    }
    // This POST proof uses a real production-mode HTTP handler, a real
    // disposable-PG16 batch and a narrowly scoped CI-only TLS scan stub.
    // It never reaches a provider or proves production malware acceptance.
    const privileged = await makeSession(f.owners[idx].id, { privileged: true });
    const syntheticBytes = Buffer.from("%PDF-1.4\nSYNTHETIC-PROOF-TENANT-QA:" + fixtures.nonce + ":" + idx + "\n%%EOF\n");
    function proofForm(orgId, batchId) {
      const form = new FormData();
      form.append("organizationId", String(orgId));
      form.append("batchId", String(batchId));
      form.append("replacementReason", "Synthetic CI replacement; no real statutory payment");
      form.append("file", new File([syntheticBytes], "synthetic-proof-" + idx + ".pdf", { type: "application/pdf" }));
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
    highExistingVictimIds: [victimBatch.id, victimEvidence.id, victimTask.id],
    victimDatabaseUnchanged: true, productionTested: false, certified: false,
  }));
}
