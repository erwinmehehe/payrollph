/**
 * PATCH /api/compliance/filing-validations/[id], genuine production-mode HTTP.
 * Two independently authenticated fictional employer owners try to mutate an
 * actual, higher-ID victim's generated filing. The only own successful outcome
 * exercised is "rejected"; "accepted" requires independent official agency
 * evidence and is intentionally NOT claimed by this zero-credit proof.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  ENDPOINT, ORIGIN, requireDisposableFilingEnv, assertFilingDenied,
  assertOwnFilingRejection, assertFilingStateUnchanged,
} from "./tenant-filing-outcome-contract.mjs";

export async function verifyFilingOutcomeTenantBoundary() {
  // No application, DB, schema or fixture module is loaded before this gate.
  requireDisposableFilingEnv();
  const [{ db, pool }, schema, { asc, eq }, fixture, veto] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./disposable-insert-veto.mjs"),
  ]);
  const {
    users, organizations, payrollRuns, governmentFilingValidations, auditEvents,
    outbox, employees, employeePayProfiles,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  const { withDisposableInsertVeto } = veto;
  const tracked = {
    governmentFilingValidations, payrollRuns, auditEvents, outbox,
    employees, employeePayProfiles,
  };
  const plain = (rows) => JSON.parse(JSON.stringify(rows));
  async function snapshot(orgId) {
    const value = {};
    for (const [name, table] of Object.entries(tracked)) {
      assert.ok(table.id && table.organizationId, "Missing actual employer-owned table: " + name);
      value[name] = plain(await db.select().from(table)
        .where(eq(table.organizationId, orgId)).orderBy(asc(table.id)));
    }
    return value;
  }
  async function snapshots(subjects) {
    return new Map(await Promise.all(subjects.map(async x => [x.org.id, await snapshot(x.org.id)])));
  }
  async function assertAllUnchanged(subjects, before, label) {
    for (const actor of subjects) assertFilingStateUnchanged(
      before.get(actor.org.id), await snapshot(actor.org.id), label + " " + actor.marker);
  }
  async function requestFiling({ id, actor, organizationId = actor.org.id,
    cookie = actor.cookie, method = "PATCH", outcome = "rejected",
    submissionMethod = "manual_entry", note = "Fictional evidence rejected",
    headers = {} }) {
    const response = await fetch(new URL(ENDPOINT + id, ORIGIN), {
      method, redirect: "manual", cache: "no-store",
      headers: {
        "content-type": "application/json", origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: JSON.stringify({ organizationId, outcome, submissionMethod, note }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* rejected by assertions */ }
    return { status: response.status, json, text, headers: response.headers };
  }
  async function seedFiling(actor, suffix) {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: actor.org.id,
      legalEntityId: actor.entity.id,
      scopeOrgUnitId: actor.unit.id,
      periodLabel: actor.marker + " fictional " + suffix,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-15",
      payDate: "2026-02-20",
      status: "Draft", // no fictitious payroll release or official filing acceptance
    }).returning();
    const [filing] = await db.insert(governmentFilingValidations).values({
      organizationId: actor.org.id, legalEntityId: actor.entity.id,
      payrollRunId: run.id, agency: "SSS", form: "R-3",
      periodLabel: run.periodLabel,
      fileName: actor.marker + "-" + suffix + ".csv",
      fileSha256: createHash("sha256").update(actor.marker + ":" + suffix).digest("hex"),
      generatorVersion: "sss-r3-worksheet-v2",
      generatedBy: actor.owner.name,
    }).returning();
    return { ...actor, run, filing };
  }
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0]?.server_version_num);
    assert.ok(version >= 160000 && version < 170000,
      "FILING_OUTCOME_REFUSED: PostgreSQL 16 disposable database required");
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "FILING_OUTCOME_REFUSED: fixture database must start with no users");
    assert.equal((await db.select().from(organizations).limit(1)).length, 0,
      "FILING_OUTCOME_REFUSED: fixture database must start with no employers");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedFiling(await seedEmployer("ATTA", nonce, standaloneMakeSession), "own");
    const b = await seedFiling(await seedEmployer("ATTB", nonce, standaloneMakeSession), "own");
    // Consume real IDs; no "victim ID 1/2" or invented foreign resource.
    for (let i = 0; i < 7; i++) {
      await seedFiling(await seedEmployer("PAD" + i, nonce, standaloneMakeSession), "filler");
    }
    const victim = await seedFiling(await seedEmployer("VICTIM", nonce, standaloneMakeSession), "victim");
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.filing.id > Math.max(a.filing.id, b.filing.id, 6));
    assert.ok(victim.run.id > Math.max(a.run.id, b.run.id, 6));
    assert.equal(new Set([a.cookie, b.cookie, victim.cookie]).size, 3);

    const subjects = [a, b, victim];
    const victimInitial = await snapshot(victim.org.id);
    let denials = 0, ownRejections = 0, vetoes = 0, foreignIndistinguishable = 0;
    for (const actor of [a, b]) {
      const session = await standaloneRequest("/api/account", { cookie: actor.cookie });
      assert.equal(session.status, 200, "Filing caller must have a real authenticated session");
      assert.equal(session.json?.profile?.id, actor.owner.id);
      const forbidden = [victim.marker, victim.filing.fileName, victim.run.periodLabel];

      async function refused(input, expected, label) {
        const before = await snapshots(subjects);
        const response = await requestFiling({ actor, id: actor.filing.id, ...input });
        assertFilingDenied(response, expected, forbidden);
        await assertAllUnchanged(subjects, before, label);
        denials++;
        return response;
      }

      // An authenticated owner cannot switch workspace via a posted selector.
      await refused({ id: victim.filing.id, organizationId: victim.org.id },
        403, "forged victim organization");
      // A real foreign ID must be indistinguishable from an ID that never existed.
      const foreign = await refused({ id: victim.filing.id },
        404, "victim filing named inside own workspace");
      const absent = await refused({ id: victim.filing.id + 1000000 },
        404, "nonexistent filing ID");
      assert.deepEqual(foreign.json, absent.json,
        "Foreign and nonexistent filing identifiers must return the same result");
      foreignIndistinguishable++;
      await refused({ cookie: null }, 401, "unauthenticated filing");
      await refused({ headers: { origin: "https://attacker.example.invalid",
        "sec-fetch-site": "cross-site" } }, 403, "cross-site filing mutation");
      await refused({ submissionMethod: "external_gateway" }, 400,
        "unrecognized submission method");
      await refused({ note: "" }, 400, "missing agency rejection reason");

      // Reject the ACTUAL audit insert and check that the accepted SQL update
      // did not survive a failed audit transaction. This is not a fake handler.
      const beforeVeto = await snapshots(subjects);
      await withDisposableInsertVeto(pool, "audit_events", actor.org.id, async () => {
        const response = await requestFiling({
          actor, id: actor.filing.id, note: actor.marker + " vetoed fictional agency rejection",
        });
        assertFilingDenied(response, 409, forbidden);
      });
      await assertAllUnchanged(subjects, beforeVeto, "real audit-insert veto");
      vetoes++;

      // Own success must be a stored, one-time rejection AND one actor-bound audit.
      const before = await snapshots(subjects);
      const note = actor.marker + " fictional agency rejection";
      const actual = await requestFiling({ actor, id: actor.filing.id, note });
      const row = assertOwnFilingRejection(actual, actor, actor.filing.id, note, forbidden);
      const after = await snapshot(actor.org.id);
      assert.equal(after.governmentFilingValidations.length,
        before.get(actor.org.id).governmentFilingValidations.length);
      const saved = after.governmentFilingValidations.find(x => x.id === row.id);
      assert.ok(saved && saved.status === "rejected" && saved.outcomeNote === note);
      assert.equal(saved.recordedBy, actor.owner.name);
      assert.equal(after.auditEvents.length, before.get(actor.org.id).auditEvents.length + 1);
      const audit = after.auditEvents.at(-1);
      assert.equal(audit.organizationId, actor.org.id);
      assert.equal(audit.actor, actor.owner.name);
      assert.equal(audit.action, "SSS R-3 filing rejected");
      assert.equal(audit.metadata.recordId, actor.filing.id);
      assert.equal(audit.metadata.runId, actor.run.id);
      for (const name of ["payrollRuns", "outbox", "employees", "employeePayProfiles"]) {
        assert.deepEqual(after[name], before.get(actor.org.id)[name],
          "Government rejection cannot mutate " + name);
      }
      for (const other of subjects.filter(x => x !== actor)) assertFilingStateUnchanged(
        before.get(other.org.id), await snapshot(other.org.id),
        "Own filing cannot mutate another employer: " + other.marker);
      ownRejections++;

      await refused({ note: "Attempted second decision" },
        409, "previously resolved filing cannot be rewritten");
    }
    assertFilingStateUnchanged(victimInitial, await snapshot(victim.org.id),
      "Higher-ID victim remained byte-identical across both independent attackers");
    assert.equal(denials, 16);
    assert.equal(ownRejections, 2);
    assert.equal(vetoes, 2);
    assert.equal(foreignIndistinguishable, 2);
    console.log(JSON.stringify({
      kind: "fictional-compliance-filing-outcome-tenant-proof",
      method: "PATCH /api/compliance/filing-validations/[id]",
      attackerEmployers: 2, higherIdVictimEmployers: 1,
      ownPersistedRejections: ownRejections,
      tenantAndInputDenials: denials,
      foreignEqualsNonexistent: foreignIndistinguishable,
      actualAuditVetoRollbacks: vetoes,
      officialFilingAcceptanceProven: false,
      submittedToAgency: false,
      moneyMoved: false, coverageCredits: 0,
      independentSecurityReview: "PENDING",
      productionTested: false,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

await verifyFilingOutcomeTenantBoundary();
