/**
 * Isolated compliance batch: authentic fictional PG16 HTTP acceptance of
 * government filing evidence for two separate employers, plus foreign
 * and forged-ID denials. The agency references are test strings ONLY.
 *
 * No request is made to an actual government agency, money system, email
 * provider, deployed app, Neon database or external tenant.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  ENDPOINT, ORIGIN, requireDisposableFilingEnv,
  assertFilingDenied, assertFilingStateUnchanged,
} from "./tenant-filing-outcome-contract.mjs";

export async function proveFictionalAcceptedFilingIsolation() {
  // All environment checks MUST happen before DB, service or fixture import.
  requireDisposableFilingEnv();
  assert.equal(process.env.TENANT_COMPLIANCE_ACCEPTED_BATCH, "fictional-only",
    "COMPLIANCE_ACCEPTED_REFUSED: independent CI-only batch required");
  const [{ db, pool }, schema, orm, fixture, veto, store, govCrypto, forms] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./disposable-insert-veto.mjs"),
    import("../../src/lib/filing-evidence-store.ts"),
    import("../../src/lib/government-id-crypto.ts"),
    import("../../src/lib/filing-evidence.ts"),
  ]);
  const { asc, eq, inArray } = orm;
  const { seedEmployer, standaloneMakeSession } = fixture;
  const { withDisposableInsertVeto } = veto;

  const tracked = {
    governmentFilingValidations: schema.governmentFilingValidations,
    payrollRuns: schema.payrollRuns,
    auditEvents: schema.auditEvents,
    outbox: schema.outbox,
    employees: schema.employees,
    employeePayProfiles: schema.employeePayProfiles,
    userOrganizations: schema.userOrganizations,
    organizations: schema.organizations,
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  async function snapshot(orgId) {
    const result = {};
    for (const [key, table] of Object.entries(tracked)) {
      const orgField = key === "organizations" ? table.id : table.organizationId;
      assert.ok(orgField && table.id, "Expected scoped table field: " + key);
      result[key] = clone(await db.select().from(table)
        .where(eq(orgField, orgId)).orderBy(asc(table.id)));
    }
    const runIds = result.payrollRuns.map(row => row.id);
    result.payrollEntries = runIds.length
      ? clone(await db.select().from(schema.payrollEntries)
          .where(inArray(schema.payrollEntries.payrollRunId, runIds))
          .orderBy(asc(schema.payrollEntries.id)))
      : [];
    return result;
  }

  async function request(actor, id, overrides = {}) {
    const payload = {
      organizationId: actor.org.id,
      outcome: "accepted",
      submissionMethod: overrides.submissionMethod ?? "manual_entry",
      agencyReference: overrides.agencyReference ?? ("CI-FICTIONAL-ACK-" + actor.org.id),
      submittedAt: overrides.submittedAt ?? "2026-02-28",
      note: overrides.note ?? "Synthetic isolated review; not a real agency acknowledgement.",
      ...overrides.body,
    };
    const response = await fetch(new URL(ENDPOINT + id, ORIGIN), {
      method: "PATCH", cache: "no-store", redirect: "manual",
      headers: {
        "content-type": "application/json", origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        ...(overrides.cookie === null ? {} : { cookie: overrides.cookie ?? actor.cookie }),
        ...(overrides.headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: response.status, json, text, headers: response.headers };
  }

  async function seedGenerated(actor, suffix, { released = true } = {}) {
    // Every genuine accepted-path record is backed by a reproducible
    // SSS R-3 file from a fictitious released pay period and employee.
    await db.update(schema.employees).set({
      sssNo: govCrypto.encryptGovernmentId("33" + String(actor.worker.id).padStart(8, "0"),
        { required: true }),
    }).where(eq(schema.employees.id, actor.worker.id));
    const [run] = await db.insert(schema.payrollRuns).values({
      organizationId: actor.org.id, legalEntityId: actor.entity.id,
      scopeOrgUnitId: actor.unit.id,
      periodLabel: actor.marker + " synthetic SSS " + suffix,
      periodStart: "2026-02-16", periodEnd: "2026-02-28",
      payDate: "2026-02-28", status: released ? "Released" : "Draft",
      employeeCount: 1, grossPay: "20000.00", netPay: "18000.00",
    }).returning();
    await db.insert(schema.payrollEntries).values({
      payrollRunId: run.id, employeeId: actor.worker.id,
      grossPay: "20000.00", deductions: "2000.00", netPay: "18000.00",
      trace: { inputs: ["statutoryMonthlyCompensation=20000"] },
    });
    const source = await store.recordGeneratedFiling({
      organizationId: actor.org.id, runId: run.id,
      definition: forms.FILING_FORMS.find(x => x.agency === "SSS" && x.form === "R-3"),
      actor: actor.owner.name,
    });
    assert.ok(source.record?.id && source.record.organizationId === actor.org.id);
    assert.equal(source.record.status, "generated");
    assert.match(source.record.fileSha256, /^[a-f0-9]{64}$/);
    assert.ok(source.file?.body?.includes(actor.worker.employeeNo) ||
      source.file?.body?.includes(actor.worker.lastName),
    "Actual generated SSS source must contain own fictional employee");
    return { ...actor, run, filing: source.record };
  }

  let accepted = 0, denied = 0, auditRollbacks = 0;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000,
      "COMPLIANCE_ACCEPTED_REFUSED: disposable PostgreSQL 16 required");
    assert.equal((await db.select().from(schema.organizations).limit(1)).length, 0,
      "COMPLIANCE_ACCEPTED_REFUSED: only empty freshly seeded app_db allowed");
    assert.equal((await db.select().from(schema.users).limit(1)).length, 0,
      "COMPLIANCE_ACCEPTED_REFUSED: existing user data not allowed");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedGenerated(
      await seedEmployer("ATTA", nonce, standaloneMakeSession), "own-a");
    const b = await seedGenerated(
      await seedEmployer("ATTB", nonce, standaloneMakeSession), "own-b");
    // Consume real SQL IDs to prevent a tiny placeholder victim record.
    // Pad records are unaccepted, throwaway, with no external submissions.
    for (let i = 0; i < 7; i++) {
      const pad = await seedEmployer("PAD" + i, nonce, standaloneMakeSession);
      await seedGenerated(pad, "padding-" + i, { released: false });
    }
    const victim = await seedGenerated(
      await seedEmployer("VICTIM", nonce, standaloneMakeSession), "victim");
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.filing.id > Math.max(a.filing.id, b.filing.id, 6));
    assert.ok(victim.run.id > Math.max(a.run.id, b.run.id, 6));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id, 6));
    assert.equal(new Set([a.cookie, b.cookie, victim.cookie]).size, 3);
    const subjects = [a, b, victim];
    const victimBefore = await snapshot(victim.org.id);
    assert.ok(victimBefore.governmentFilingValidations.length > 0 &&
      victimBefore.payrollRuns.length > 0 &&
      victimBefore.payrollEntries.length > 0 &&
      victimBefore.employees.length > 0, "Victim must have nonempty real SQL source");

    const immutable = async (before, label) => {
      for (const e of subjects) {
        assertFilingStateUnchanged(before.get(e.org.id), await snapshot(e.org.id),
          label + " " + e.marker);
      }
    };
    const allBefore = () => Promise.all(subjects.map(async e => [e.org.id, await snapshot(e.org.id)]))
      .then(x => new Map(x));

    for (const [actor, method] of [[a, "manual_entry"], [b, "file_upload"]]) {
      const forbidden = [victim.marker, victim.filing.fileName, victim.run.periodLabel];
      async function rejected(id, expected, label, extra = {}) {
        const before = await allBefore();
        const response = await request(actor, id, { submissionMethod: method, ...extra });
        assertFilingDenied(response, expected, forbidden);
        await immutable(before, label);
        denied++;
        return response;
      }

      // Both employer selection and resource ID must be authorized independently.
      await rejected(victim.filing.id, 403, "forged victim employer selection", {
        body: { organizationId: victim.org.id },
      });
      const foreign = await rejected(victim.filing.id, 404,
        "foreign filing id inside own employer");
      const absent = await rejected(victim.filing.id + 900000, 404,
        "nonexistent filing id");
      assert.deepEqual(foreign.json, absent.json,
        "Foreign and nonexistent filing IDs must not be distinguishable");
      await rejected(actor.filing.id, 401, "anonymous cannot accept", { cookie: null });
      await rejected(actor.filing.id, 403, "cross-origin acceptance blocked", {
        headers: { origin: "https://attacker.example.invalid",
          "sec-fetch-site": "cross-site" },
      });
      await rejected(actor.filing.id, 400, "missing acknowledgement is rejected", {
        agencyReference: "",
      });
      await rejected(actor.filing.id, 400, "invalid submitted date rejected", {
        submittedAt: "2026-02-30",
      });
      await rejected(actor.filing.id, 400, "wrong submission method denied", {
        submissionMethod: "other",
      });

      // A real audit insertion failure MUST roll back the otherwise-valid
      // accepted status in the same transaction.
      const beforeVeto = await allBefore();
      await withDisposableInsertVeto(pool, "audit_events", actor.org.id, async () => {
        const response = await request(actor, actor.filing.id, { submissionMethod: method });
        assertFilingDenied(response, 409, forbidden);
      });
      await immutable(beforeVeto, "actual PostgreSQL audit veto");
      auditRollbacks++;

      // Two independent positive outcomes, both backed by generated file
      // SHA and a fictional acknowledgement. Never claim real government proof.
      const before = await allBefore();
      const response = await request(actor, actor.filing.id, { submissionMethod: method });
      assert.equal(response.status, 200,
        "Own accepted-path must succeed: " + response.text.slice(0, 220));
      const row = response.json?.record;
      assert.equal(row?.id, actor.filing.id);
      assert.equal(row.organizationId, actor.org.id);
      assert.equal(row.legalEntityId, actor.entity.id);
      assert.equal(row.payrollRunId, actor.run.id);
      assert.equal(row.status, "accepted");
      assert.equal(row.submissionMethod, method);
      assert.equal(row.agencyReference, "CI-FICTIONAL-ACK-" + actor.org.id);
      assert.ok(row.recordedAt && row.submittedAt);
      assert.equal(row.fileSha256, actor.filing.fileSha256);
      assert.ok(!response.text.includes(victim.marker));
      const after = await snapshot(actor.org.id);
      assert.equal(after.governmentFilingValidations.length,
        before.get(actor.org.id).governmentFilingValidations.length);
      const stored = after.governmentFilingValidations.find(x => x.id === row.id);
      assert.equal(stored.status, "accepted");
      assert.equal(stored.recordedBy, actor.owner.name);
      assert.equal(stored.submissionMethod, method);
      assert.equal(stored.fileSha256, actor.filing.fileSha256);
      assert.equal(after.auditEvents.length,
        before.get(actor.org.id).auditEvents.length + 1);
      assert.equal(after.auditEvents.at(-1).organizationId, actor.org.id);
      assert.equal(after.auditEvents.at(-1).actor, actor.owner.name);
      assert.equal(after.auditEvents.at(-1).action, "SSS R-3 filing accepted");
      assert.equal(after.auditEvents.at(-1).metadata.recordId, actor.filing.id);
      assert.equal(after.auditEvents.at(-1).metadata.runId, actor.run.id);
      for (const key of ["payrollRuns", "payrollEntries", "outbox",
        "employees", "employeePayProfiles", "userOrganizations", "organizations"]) {
        assert.deepEqual(after[key], before.get(actor.org.id)[key],
          "Accepted filing must not mutate own unrelated " + key);
      }
      for (const other of subjects.filter(e => e !== actor)) {
        assertFilingStateUnchanged(before.get(other.org.id), await snapshot(other.org.id),
          "Owned acceptance changed foreign tenant " + other.marker);
      }
      accepted++;

      await rejected(actor.filing.id, 409, "already accepted filing is immutable");
    }
    assertFilingStateUnchanged(victimBefore, await snapshot(victim.org.id),
      "Victim immutable after both attackers and own acceptance");
    assert.equal(accepted, 2);
    assert.equal(auditRollbacks, 2);
    assert.equal(denied, 18);
    console.log("TENANT_COMPLIANCE_ACCEPTED_HTTP_PASS " + JSON.stringify({
      method: "PATCH /api/compliance/filing-validations/[id]",
      acceptedModes: ["manual_entry", "file_upload"],
      independentFictionalEmployers: 2, higherIdVictim: true,
      realOwnAccepted200: accepted, realDenials: denied,
      crossTenantDbAndAuditImmutable: true, realAuditRollbacks: auditRollbacks,
      evidenceSourceReproduced: true,
      agencyContacted: false, actualAcknowledgementVerified: false,
      payrollReleasedToRealEmployees: false, moneyMoved: false,
      coverageCredits: 0, independentlyAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}

proveFictionalAcceptedFilingIsolation().catch(error => {
  console.error("TENANT_COMPLIANCE_ACCEPTED_HTTP_FAILED " +
    (error instanceof Error ? error.stack : String(error)));
  process.exitCode = 1;
});
