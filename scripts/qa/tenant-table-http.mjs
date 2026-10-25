/**
 * TABLE-DRIVEN TENANT ISOLATION PROOF for employer-scoped methods whose only employer selector is
 * `organizationId`. One row per method; every row runs for TWO independent attacker employers:
 *   1. own employer request succeeds AND the row's `prove` shows the body is that employer's data;
 *   2. the same session naming the real victim employer is denied with the exact status;
 *   3. no victim marker appears in either response, and victim rows are unchanged afterwards.
 * Fixture-only, fictional PostgreSQL rows on the disposable 127.0.0.1 app_db; production-mode
 * localhost HTTP. No provider, payout, filing or production system is contacted.
 *
 * Standalone: TENANT_SECOND_PASS_MODE=isolated-ci-only CI=true node --import tsx scripts/qa/tenant-table-http.mjs
 * Discovery (never credits anything): add TENANT_TABLE_DISCOVER=1 to print what each route returns.
 * Profiles: TENANT_TABLE_PROFILE=default|multi-entity selects rows whose server flags are compatible.
 */
import assert from "node:assert/strict";
import { bindTenantReadRequests, loadTenantRows } from "./tenant-table-loader.mjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import {
  apiKeys, applicantPrivacyEvidence, approvalChainPolicies, approvalDelegations, attendanceCorrectionRequests, auditEvents, dataRequests, disciplinaryCases, dynamicWorkerGroups,
  earnedWageRequests, employeeLoans, employeePayoutChangeRequests, jobApplicants, jobRequisitions, shiftDefinitions, timePunches,
  hcmEmploymentTermDecisions, hcmEmploymentTerms, leaveConversions, workerEffectiveChanges, biometricDevices, employeePayProfiles, employees, engagementSurveys,
  hcmBusinessProcessDefinitions, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, importBatches,
  integrationConnectors, invoices, laborInspectionDrills, leaveRequests, legalEntities, organizations, orgUnits, outbox,
  performanceCycles, scheduleSwapRequests, sessions, userLegalEntityGrants, userOrganizations, users, workforcePlanAllocations,
  workforcePlanBaselines, workforcePlanPositionExecutions, workforcePlanningScenarios, workforcePlans,
  workforceScheduleGuardrailPolicies, worksites,
} from "../../src/db/schema";
import { essIdentifierRequests } from "../../src/lib/ess-profile-schema";
import { organizationModuleSettings } from "../../src/lib/tenant-module-storage";
import { auditBusinessSnapshot, seedTableRow } from "./tenant-table-invariants.mjs";
export const hex64 = () => randomBytes(32).toString("hex");
/** A further fictional worker of the same employer (own marker plus suffix). */
export async function addWorker(e, suffix, { payProfile = true } = {}) {
  const [worker] = await db.insert(employees).values({ organizationId: e.org.id, legalEntityId: e.entity.id, orgUnitId: e.unit.id,
    employeeNo: e.marker + "-" + suffix, firstName: "Table", lastName: e.marker + "-" + suffix, title: "Fictional", avatarInitials: "TT",
    basicRate: "20000.00", startDate: "2026-01-05" }).returning();
  if (payProfile) {
    await db.insert(employeePayProfiles).values({ organizationId: e.org.id, employeeId: worker.id, payBasis: "monthly",
      rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
  }
  return worker;
}
export const activeWorkers = async (orgId) => Number((await db.select({ n: count() }).from(employees)
  .where(and(eq(employees.organizationId, orgId), eq(employees.status, "Active"))))[0].n);
export const auditCount = async (orgId) => Number((await db.select({ n: count() }).from(auditEvents)
  .where(eq(auditEvents.organizationId, orgId)))[0].n);
/** Multi-entity scopes a non-group role to its granted legal employer: grant the owner its own one. */
const grantOwnEntity = (e) => db.insert(userLegalEntityGrants)
  .values({ organizationId: e.org.id, userId: e.owner.id, legalEntityId: e.entity.id }).onConflictDoNothing();
export async function seedPlan(e, purpose) {
  const [plan] = await db.insert(workforcePlans).values({ organizationId: e.org.id, name: e.marker + " " + purpose,
    startDate: "2026-01-01", endDate: "2026-12-31" }).returning();
  return plan;
}

/** Body checks shared by rows: each proves the response belongs to the legitimate employer. */
const proofs = {
  echoesOrganization: (field = "organizationId") => (r, c) =>
    assert.equal(Number(field.split(".").reduce((v, k) => v?.[k], r.json)), c.org.id, field + " must identify the legitimate employer"),
  listsOwnRow: (listPath, rowField, ctxField) => (r, c) => {
    const rows = listPath.split(".").reduce((v, k) => v?.[k], r.json);
    assert.ok(Array.isArray(rows), listPath + " must be a real list");
    assert.ok(rows.some((row) => Number(row?.[rowField]) === Number(c[ctxField])), listPath + " must contain the seeded own " + ctxField);
  },
  /** `path.to.list` holds a row whose `field` carries this employer's seeded marker. */
  listsOwnMarker: (listPath, field) => (r, c) => {
    const rows = listPath.split(".").reduce((v, k) => v?.[k], r.json);
    assert.ok(Array.isArray(rows) && rows.length > 0, listPath + " must be a populated list");
    assert.ok(rows.some((row) => String(row?.[field] ?? "").includes(c.marker)), listPath + "[]." + field + " must carry the own employer marker");
  },
  /** `listPath[]` rows hold, at the dotted `fieldPath`, a value carrying this employer's marker. */
  listsOwnMarkerAt: (listPath, fieldPath) => (r, c) => {
    const rows = listPath.split(".").reduce((v, k) => v?.[k], r.json);
    assert.ok(Array.isArray(rows) && rows.length > 0, listPath + " must be a populated list");
    assert.ok(rows.some((row) => String(fieldPath.split(".").reduce((v, k) => v?.[k], row) ?? "").includes(c.marker)),
      listPath + "[]." + fieldPath + " must carry the own employer marker");
  },
  /** The value at `path` carries this employer's seeded marker. */
  valueHasOwnMarker: (path) => (r, c) =>
    assert.ok(String(path.split(".").reduce((v, k) => v?.[k], r.json) ?? "").includes(c.marker), path + " must carry the own employer marker"),
  isObjectWithKeys: (...keys) => (r) => {
    assert.ok(r.json && typeof r.json === "object", "a JSON object is required");
    for (const key of keys) assert.ok(key in r.json, "response must carry " + key);
  },
  all: (...checks) => async (r, c) => { for (const check of checks) await check(r, c); },
  /** The value at `path` is this employer's own fixture id (`ctxField`, e.g. entityId). */
  echoesOwn: (path, ctxField) => (r, c) =>
    assert.equal(Number(path.split(".").reduce((v, k) => v?.[k], r.json)), c[ctxField], path + " must be the own " + ctxField),
  /** The value at `path` equals what this employer's row seed stored (distinct per employer). */
  equalsOwnSeed: (path) => (r, c) =>
    assert.deepEqual(path.split(".").reduce((v, k) => v?.[k], r.json), c.seeded, path + " must equal the own employer's seeded value"),
};
export { proofs };

/**
 * Rows. `key` is exactly "<METHOD> <manifest route>". `flags` are server env flags that must be
 * "true" in the job running this row. `prove(response, ctx)` must show own-employer data.
 * A row without `prove` is discovery-only and can never be credited.
 */
// Family row factories receive only the shared fixture/proof dependencies.


const BASE = process.env.SECURITY_SMOKE_URL ?? "";

export function requireTenantTableDisposable(env = process.env) {
  let app, database;
  try { app = new URL(env.SECURITY_SMOKE_URL ?? ""); database = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("TENANT_TABLE_REFUSED: explicit localhost server and database URLs are required"); }
  if (env.CI !== "true" || env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      app.protocol !== "http:" || app.hostname !== "127.0.0.1" ||
      database.hostname !== "127.0.0.1" || database.pathname !== "/app_db" ||
      env.PAYMONGO_DISBURSEMENTS_ENABLED === "true" || env.XENDIT_PAYOUTS_ENABLED === "true") {
    throw new Error("TENANT_TABLE_REFUSED: disposable localhost app_db and server only");
  }
}

export async function standaloneRequest(path, { method = "GET", cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") Object.assign(headers, { origin: BASE, "sec-fetch-site": "same-origin" });
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL(path, BASE), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", cache: "no-store",
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: response.headers };
}
export function standaloneExpectStatus(response, status, label) {
  assert.equal(response.status, status, label + " got " + response.status + " " + response.text.slice(0, 200));
  return response;
}
export async function standaloneMakeSession(userId) {
  const raw = randomBytes(32).toString("hex");
  const [row] = await db.insert(sessions).values({
    userId, tokenHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(),
  }).returning({ id: sessions.id });
  return { id: row.id, cookie: "__Host-linaw_session=" + raw };
}

export async function seedEmployer(label, nonce, makeSession) {
  const marker = "TTBL-" + label + "-" + nonce;
  const [org] = await db.insert(organizations).values({ name: marker + " employer", legalName: marker + " Inc." }).returning();
  const [entity] = await db.insert(legalEntities).values({ organizationId: org.id, code: marker.slice(0, 30),
    legalName: marker + " Inc.", displayName: marker, primaryEntity: true }).returning();
  const [unit] = await db.insert(orgUnits).values({ organizationId: org.id, legalEntityId: entity.id, type: "department",
    code: marker.slice(0, 30), name: marker + " department" }).returning();
  const [owner] = await db.insert(users).values({ email: marker.toLowerCase() + "@example.invalid", name: marker + " owner",
    passwordHash: "fictional-session-only", role: "owner", totpEnabled: true }).returning();
  await db.insert(userOrganizations).values({ userId: owner.id, organizationId: org.id, role: "owner", active: true });
  const session = await makeSession(owner.id);
  // Fictional fixture sessions only: a verified MFA timestamp for MFA-gated reads.
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
  const [worker] = await db.insert(employees).values({ organizationId: org.id, legalEntityId: entity.id, orgUnitId: unit.id,
    employeeNo: marker, firstName: "Table", lastName: marker, title: "Fictional", avatarInitials: "TT",
    basicRate: "20000.00", startDate: "2026-01-05" }).returning();
  await db.insert(employeePayProfiles).values({ organizationId: org.id, employeeId: worker.id, payBasis: "monthly",
    rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
  return { org, entity, unit, owner, cookie: session.cookie, worker, marker, label, rank: { ATTA: 1, ATTB: 2, VICTIM: 4 }[label], seeded: {} };
}

export async function victimSnapshot(orgId) {
  const [org, staff, units, entities, audit] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)),
    db.select().from(employees).where(eq(employees.organizationId, orgId)).orderBy(employees.id),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, orgId)).orderBy(orgUnits.id),
    db.select().from(legalEntities).where(eq(legalEntities.organizationId, orgId)).orderBy(legalEntities.id),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id).then(auditBusinessSnapshot),
  ]);
  return { org, staff, units, entities, audit };
}

export async function verifyTenantTable(_f, { request = standaloneRequest, expectStatus = standaloneExpectStatus, makeSession = standaloneMakeSession } = {}) {
  requireTenantTableDisposable();
  const TENANT_TABLE = await loadTenantRows("read", { activeWorkers, addWorker, apiKeys, applicantPrivacyEvidence, approvalChainPolicies, approvalDelegations, assert, attendanceCorrectionRequests, auditCount, auditEvents, biometricDevices, count, dataRequests, db, disciplinaryCases, dynamicWorkerGroups, earnedWageRequests, employeeLoans, employeePayoutChangeRequests, employees, engagementSurveys, eq, essIdentifierRequests, grantOwnEntity, hcmBusinessProcessDefinitions, hcmEmploymentTermDecisions, hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, hex64, importBatches, integrationConnectors, invoices, jobApplicants, jobRequisitions, laborInspectionDrills, leaveConversions, leaveRequests, organizationModuleSettings, outbox, performanceCycles, proofs, scheduleSwapRequests, seedPlan, shiftDefinitions, timePunches, workerEffectiveChanges, workforcePlanAllocations, workforcePlanBaselines, workforcePlanPositionExecutions, workforcePlanningScenarios, workforceScheduleGuardrailPolicies, worksites });
  const discover = process.env.TENANT_TABLE_DISCOVER === "1";
  const profile = process.env.TENANT_TABLE_PROFILE ?? "default";
  const rows = (discover && process.env.TENANT_TABLE_DISCOVER_KEYS
    ? process.env.TENANT_TABLE_DISCOVER_KEYS.split(",").map((key) => TENANT_TABLE.find((row) => row.key === key.trim()) ?? { key: key.trim(), profile })
    : TENANT_TABLE).filter((row) => (row.profile ?? "default") === profile);
  assert.ok(rows.length > 0, "tenant table profile " + profile + " has no rows; an empty job proves nothing");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  // Attackers first, victim last: every victim ID is larger than any attacker-owned ID, so a
  // response cannot pass by echoing a low or shared identifier.
  const employers = [null];
  for (const label of ["ATTA", "ATTB"]) employers.push(await seedEmployer(label, nonce, makeSession));
  const victim = employers[0] = await seedEmployer("VICTIM", nonce, makeSession);
  for (const field of ["org", "worker", "unit", "entity"]) {
    assert.ok(Number.isSafeInteger(victim[field].id) && victim[field].id > employers[1][field].id && victim[field].id > employers[2][field].id,
      "Victim-only " + field + " ID must really exist and exceed both attackers' IDs");
  }
  // Row seeds run for every employer, victim included, so a leak of the victim's seeded row is
  // detectable and each attacker's own row is what its proof looks for. Distinct per employer.
  // Developer aid only: TENANT_TABLE_TRY=1 reports every failing row instead of stopping at the first,
  // and never prints the credit line, so it cannot be mistaken for a passing proof.
  const tryMode = process.env.TENANT_TABLE_TRY === "1";
  const tryFailures = [];
  const seedFailures = new Map();
  for (const item of rows) {
    if (!item.seed) continue;
    try {
      await seedTableRow(item, employers);
    } catch (error) {
      if (!tryMode) throw error;
      seedFailures.set(item.key, String(error.cause?.message ?? error.message).split("\n")[0].slice(0, 200));
    }
  }
  const victimBefore = await victimSnapshot(victim.org.id);
  const passed = new Set();
  const firstAttackerResponses = new Map();
  let discriminatingProofs = 0;
  const report = [];

  for (const idx of [1, 2]) {
    const own = employers[idx];
    const base = { org: own.org, entity: own.entity, unit: own.unit, worker: own.worker, owner: own.owner, marker: own.marker,
      orgId: own.org.id, workerId: own.worker.id, unitId: own.unit.id, entityId: own.entity.id, rank: own.rank, victim };
    for (const definition of rows) {
      const ctx = { ...base, seeded: own.seeded[definition.key], victimSeeded: victim.seeded[definition.key] };
      const [method] = definition.key.split(" ");
      assert.equal(method, "GET", definition.key + ": the table runner only proves organization-scoped reads so far");
      // Discovery only: TENANT_TABLE_DISCOVER_QUERIES='{"GET route":"a=1&b=2"}' tries a query before a row exists.
      const tried = discover ? JSON.parse(process.env.TENANT_TABLE_DISCOVER_QUERIES ?? "{}")[definition.key] : undefined;
      const extra = definition.query ? "&" + definition.query(ctx) : tried ? "&" + tried.replace(/\{(\w+)\}/g, (_, name) => ctx[name]) : "";
      const item = bindTenantReadRequests(definition, own.org.id, victim.org.id, extra);
      if (!discover) {
        for (const flag of item.flags ?? []) assert.equal(process.env[flag], "true", item.key + ": server flag " + flag + " must be on in this job");
        assert.equal(typeof item.prove, "function", item.key + ": a row without an own-data proof cannot be credited");
      }
      if (discover) {
        const o = await request(item.own, { cookie: own.cookie });
        const v = await request(item.foreign, { cookie: own.cookie });
        const hits = [];
        const walk = (v, path) => {
          if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + "[" + i + "]"));
          else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path + "." + k);
          else if (typeof v === "string" && v.includes(own.marker)) hits.push(path + "~marker");
          else if (typeof v === "number" && path.length < 80 && [own.org.id, own.worker.id, own.unit.id, own.entity.id].includes(v) && /(organization|employee|unit|entity)Id$|\.id$/i.test(path)) hits.push(path + "=" + v);
        };
        walk(o.json, "");
        report.push({ key: item.key, attacker: idx, own: o.status, hits: hits.slice(0, 8), ownKeys: o.json && typeof o.json === "object" ? Object.keys(o.json).slice(0, 12) : null,
          ownSnippet: o.text.slice(0, process.env.TENANT_TABLE_DISCOVER_FULL === "1" ? 20000 : 160), ownHasOwnMarker: o.text.includes(own.marker), foreign: v.status,
          leaksVictimMarker: o.text.includes(victim.marker) || v.text.includes(victim.marker) });
        continue;
      }
      // The cited proof lines below stay at the loop's own indentation on purpose: the manifest pins their exact text.
      try {
      if (seedFailures.has(item.key)) throw new Error("seed failed: " + seedFailures.get(item.key));
      const owned = expectStatus(await request(item.own, { cookie: own.cookie }), item.status ?? 200, item.key + " own employer");
      await item.prove(owned, ctx);
      // The proof must tell employers apart: the first attacker's genuine response fails the second's proof.
      if (idx === 1) firstAttackerResponses.set(item.key, owned);
      else {
        await assert.rejects(async () => item.prove(firstAttackerResponses.get(item.key), ctx), item.key + ": proof accepts another employer's data");
        discriminatingProofs++;
      }
      assert.ok(!owned.text.includes(victim.marker), item.key + ": own response leaked a victim marker");
      const foreign = expectStatus(await request(item.foreign, { cookie: own.cookie }), item.deny ?? 403, item.key + " victim employer");
      assert.ok(!foreign.text.includes(victim.marker), item.key + ": denial leaked a victim marker");
      passed.add(item.key + "#" + idx);
      } catch (error) {
        if (!tryMode) throw error;
        tryFailures.push(item.key + " (attacker " + idx + "): " + String(error.message ?? error).split("\n")[0].slice(0, 230));
      }
    }
  }
  const victimAfter = await victimSnapshot(victim.org.id);
  if (discover) {
    console.log(JSON.stringify({ kind: "tenant-table-discovery", profile, credited: 0, report }, null, 1));
    return { discovered: report.length };
  }
  if (tryMode) {
    const failedKeys = new Set(tryFailures.map((line) => line.split(" (attacker")[0]));
    console.log(JSON.stringify({ kind: "tenant-table-try", profile, credited: 0, rows: rows.length,
      passingRows: rows.filter((row) => !failedKeys.has(row.key)).map((row) => row.key), failures: tryFailures }, null, 1));
    return { tried: rows.length };
  }
  assert.deepEqual(victimAfter, victimBefore, "table reads leave the victim employer's rows and audit trail unchanged");
  assert.equal(passed.size, rows.length * 2, "every row passed for both independent attacker employers");
  assert.equal(discriminatingProofs, rows.length, "every row's proof rejected the other attacker's genuine response");
  await db.delete(sessions).where(inArray(sessions.userId, employers.map((e) => e.owner.id)));
  console.log(JSON.stringify({ kind: "tenant-table-proof", profile, rows: rows.length, ownAndForeignPairs: passed.size,
    discriminatingProofs, victimDatabaseUnchanged: true, productionTested: false, certified: false }));
  return { rows: rows.length, pairs: passed.size };
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-table-http.mjs")) {
  verifyTenantTable(null).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
}
