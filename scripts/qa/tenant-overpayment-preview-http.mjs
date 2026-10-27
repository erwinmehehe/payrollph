/**
 * Executable real-source / real HTTP isolation for read-only
 * POST /api/payroll-overpayment-preview.
 *
 * Strict disposable-only environment, zero real people or provider calls.
 * Directly seeded Released records are fictional historical input; they are
 * NOT evidence of an independently approved real payroll release.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  requireDisposableOverpaymentEnv, fictionalOverpaymentAmounts,
  ownOverpaymentBody, proveOwnedOverpaymentPreview, proveOverpaymentDenial,
  assertOverpaymentSourcesUnchanged, PAYROLL_PERIOD, AMBIGUOUS_PAYROLL_PERIOD,
} from "./tenant-overpayment-preview-contract.mjs";

const BASE = "http://127.0.0.1:3000";
const ROUTE = "/api/payroll-overpayment-preview";
const plain = value => JSON.parse(JSON.stringify(value));

function fingerprint(entry) {
  return createHash("sha256").update(JSON.stringify({
    id: entry.id, payrollRunId: entry.payrollRunId, employeeId: entry.employeeId,
    grossPay: entry.grossPay, deductions: entry.deductions, netPay: entry.netPay,
    status: entry.status, lineItems: entry.lineItems, trace: entry.trace,
  })).digest("hex");
}

export async function verifyOverpaymentPreviewTenantHttp() {
  requireDisposableOverpaymentEnv(); // before importing any DB or app module
  const [database, schema, orm, shared, invariants] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { db, pool } = database;
  const { asc, eq, inArray } = orm;
  const { organizations, auditEvents, employees, employeePayProfiles,
    payrollRuns, payrollEntries, employeeLoans, leaveRequests,
    payoutBatches, users, userOrganizations, sessions,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest,
    requireTenantTableDisposable, victimSnapshot, addWorker } = shared;
  requireTenantTableDisposable();

  try {
    assert.equal((await db.select({ id: organizations.id })
      .from(organizations).limit(1)).length, 0,
    "OVERPAYMENT_TENANT_REFUSED: requires a genuinely fresh PG16");
    assert.equal((await db.select({ id: auditEvents.id })
      .from(auditEvents).limit(1)).length, 0,
    "OVERPAYMENT_TENANT_REFUSED: synthetic audit table must begin empty");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      employers.push(await seedEmployer(label, nonce, standaloneMakeSession));
    }
    const [a, b, victim] = employers;
    for (const field of ["org", "entity", "unit", "worker", "owner"]) {
      assert.ok(victim[field].id > a[field].id && victim[field].id > b[field].id,
        "victim " + field + " must be a genuinely higher persisted ID");
    }

    const seeded = [];
    async function seedPayroll(e) {
      const money = fictionalOverpaymentAmounts(e.rank);
      const periodLabel = e.marker + " fictional Released register";
      const [run, draft, duplicate] = await db.insert(payrollRuns).values([
        {
          organizationId: e.org.id, legalEntityId: e.entity.id,
          scopeOrgUnitId: e.unit.id, periodLabel,
          periodStart: PAYROLL_PERIOD.start, periodEnd: PAYROLL_PERIOD.end,
          payDate: PAYROLL_PERIOD.pay, status: "Released",
          grossPay: money.grossPay, netPay: money.netPay, employeeCount: 1,
        },
        {
          organizationId: e.org.id, legalEntityId: e.entity.id,
          scopeOrgUnitId: e.unit.id,
          periodLabel: e.marker + " excluded draft source",
          periodStart: PAYROLL_PERIOD.start, periodEnd: PAYROLL_PERIOD.end,
          payDate: PAYROLL_PERIOD.pay, status: "Draft",
          grossPay: "99999.00", netPay: "99988.00", employeeCount: 1,
        },
        {
          organizationId: e.org.id, legalEntityId: e.entity.id,
          scopeOrgUnitId: e.unit.id,
          periodLabel: e.marker + " ambiguous register",
          // Independent Released period; keep the real overlap exclusion intact.
          periodStart: AMBIGUOUS_PAYROLL_PERIOD.start,
          periodEnd: AMBIGUOUS_PAYROLL_PERIOD.end,
          payDate: AMBIGUOUS_PAYROLL_PERIOD.pay, status: "Released",
          grossPay: money.grossPay, netPay: money.netPay, employeeCount: 1,
        },
      ]).returning();
      assert.ok(run.id > 0 && draft.id > run.id && duplicate.id > draft.id);
      assert.equal(run.periodStart, PAYROLL_PERIOD.start);
      assert.equal(run.periodEnd, PAYROLL_PERIOD.end);
      assert.equal(duplicate.periodStart, AMBIGUOUS_PAYROLL_PERIOD.start);
      assert.equal(duplicate.periodEnd, AMBIGUOUS_PAYROLL_PERIOD.end);
      assert.ok(run.periodEnd < duplicate.periodStart,
        "independent synthetic Released runs must not overlap in one entity/scope");
      for (const row of [run, draft, duplicate]) {
        assert.equal(row.organizationId, e.org.id);
        assert.equal(row.legalEntityId, e.entity.id);
        assert.equal(row.scopeOrgUnitId, e.unit.id);
      }
      const lineItems = [{ code: "FICT-BASIC", amount: money.grossPay,
        marker: e.marker + "-PRIVATE-LINEITEM" }];
      const trace = { marker: e.marker + "-PRIVATE-TRACE", source: "synthetic-PG16" };
      const [entry] = await db.insert(payrollEntries).values({
        payrollRunId: run.id, employeeId: e.worker.id,
        grossPay: money.grossPay, deductions: money.deductions,
        netPay: money.netPay, status: "Ready", lineItems, trace,
      }).returning();
      await db.insert(payrollEntries).values([
        { payrollRunId: duplicate.id, employeeId: e.worker.id,
          grossPay: money.grossPay, deductions: money.deductions,
          netPay: money.netPay, status: "Ready", lineItems, trace },
        { payrollRunId: duplicate.id, employeeId: e.worker.id,
          grossPay: money.grossPay, deductions: money.deductions,
          netPay: money.netPay, status: "Ready", lineItems, trace },
      ]);
      assert.equal(entry.payrollRunId, run.id);
      assert.equal(entry.employeeId, e.worker.id);
      const originalFingerprint = fingerprint(entry);
      assert.match(originalFingerprint, /^[a-f0-9]{64}$/);
      return {
        ...e, runId: run.id, draftRunId: draft.id,
        duplicateRunId: duplicate.id, entryId: entry.id,
        periodLabel, fingerprint: originalFingerprint,
      };
    }
    for (const employer of employers) seeded.push(await seedPayroll(employer));
    const [attackerA, attackerB, target] = seeded;
    for (const field of ["runId", "draftRunId", "duplicateRunId", "entryId"]) {
      assert.ok(target[field] > attackerA[field] && target[field] > attackerB[field],
        "victim " + field + " must be an actual higher ID");
    }

    // A real same-employer peer has no entry in A's original Released run.
    // The worker cannot be paired with A's released entry by forged employeeId.
    const peer = await addWorker(a, "PREVIEW-PEER", { payProfile: false });
    assert.equal(peer.organizationId, a.org.id);
    assert.notEqual(peer.id, a.worker.id);

    // Payroll reviewers may inspect a historical separated worker; the route
    // must not change the worker's legal employment status.
    await db.update(employees).set({ status: "Separated" })
      .where(eq(employees.id, target.worker.id));
    const [separated] = await db.select().from(employees)
      .where(eq(employees.id, target.worker.id));
    assert.equal(separated.status, "Separated");
    target.worker = separated;

    // Another signed-in user of A has employee, not payroll checker, power.
    const [employeeUser] = await db.insert(users).values({
      email: "overpayment-employee-" + nonce + "@example.invalid",
      name: "Synthetic nonchecker " + a.marker,
      role: "employee", employeeId: a.worker.id,
      passwordHash: "disposable-not-a-login", active: true,
      localPasswordEnabled: false,
    }).returning();
    await db.insert(userOrganizations).values({
      organizationId: a.org.id, userId: employeeUser.id,
      role: "employee", workerEmployeeId: a.worker.id, active: true,
    });
    const employeeSession = await standaloneMakeSession(employeeUser.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, employeeSession.id));
    const noMfa = await standaloneMakeSession(a.owner.id);

    async function readSource(e) {
      const scoped = (table) => db.select().from(table)
        .where(eq(table.organizationId, e.org.id)).orderBy(asc(table.id));
      const [staff, profiles, runs, loans, leaves, payouts, rawAudit] =
        await Promise.all([
          scoped(employees), scoped(employeePayProfiles), scoped(payrollRuns),
          scoped(employeeLoans), scoped(leaveRequests), scoped(payoutBatches),
          scoped(auditEvents),
        ]);
      const entries = runs.length
        ? await db.select().from(payrollEntries).where(inArray(
          payrollEntries.payrollRunId, runs.map(run => run.id),
        )).orderBy(asc(payrollEntries.id))
        : [];
      return plain({
        staff, profiles, runs, entries, loans, leaves, payouts,
        audit: invariants.auditBusinessSnapshot(rawAudit),
      });
    }
    const before = new Map();
    for (const employer of employers) {
      before.set(employer.org.id, await readSource(employer));
    }
    const victimBefore = await victimSnapshot(victim.org.id);
    const allMarkers = [a.marker, b.marker, victim.marker, peer.employeeNo];
    const sourcePrivateMarkers = seeded.flatMap(e => [
      e.marker + "-PRIVATE-LINEITEM", e.marker + "-PRIVATE-TRACE",
    ]);
    const forbiddenFor = e => allMarkers.filter(v => v !== e.marker &&
      !e.marker.startsWith(v)).concat(sourcePrivateMarkers);

    let positiveCount = 0, deniedCount = 0;
    const post = async (cookie, body, crossSite = false) => {
      if (!crossSite) {
        return standaloneRequest(ROUTE, { method: "POST", cookie, body });
      }
      const response = await fetch(BASE + ROUTE, {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: {
          cookie: cookie ?? "", "content-type": "application/json",
          origin: "https://hostile.example.invalid", "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      return { status: response.status, headers: response.headers, text, json };
    };
    async function positive(e) {
      const result = await post(e.cookie, ownOverpaymentBody(e));
      proveOwnedOverpaymentPreview(result, e, forbiddenFor(e));
      positiveCount++;
      return result;
    }
    async function denied(cookie, body, status, code, crossSite = false) {
      const response = await post(cookie, body, crossSite);
      proveOverpaymentDenial(response, status, code, allMarkers.concat(sourcePrivateMarkers));
      deniedCount++;
    }

    // A fake 200, empty variance, stale row, or the other employer's real
    // successful HTTP body cannot count as authenticated own data.
    const ownA = await positive(attackerA);
    const ownB = await positive(attackerB);
    await positive(target);
    assert.throws(() => proveOwnedOverpaymentPreview(
      ownA, attackerB, forbiddenFor(attackerB)));
    assert.throws(() => proveOwnedOverpaymentPreview(
      ownB, attackerA, forbiddenFor(attackerA)));

    // Cross-org authorization must precede source lookup. Never grant a
    // financial preview when owner A/B names a real higher-ID victim org.
    for (const e of [attackerA, attackerB]) {
      await denied(e.cookie, ownOverpaymentBody(target), 403);
      await denied(e.cookie, ownOverpaymentBody(e, {
        employeeId: target.worker.id,
      }), 404, "OVERPAYMENT_SOURCE_NOT_FOUND");
      await denied(e.cookie, ownOverpaymentBody(e, {
        payrollRunId: target.runId,
      }), 404, "OVERPAYMENT_SOURCE_NOT_FOUND");
      await denied(e.cookie, ownOverpaymentBody(e, {
        employeeId: target.worker.id, payrollRunId: target.runId,
      }), 404, "OVERPAYMENT_SOURCE_NOT_FOUND");
      // Draft payroll may not be used as a Released register.
      await denied(e.cookie, ownOverpaymentBody(e, {
        payrollRunId: e.draftRunId,
      }), 404, "OVERPAYMENT_SOURCE_NOT_FOUND");
      // Two real entries from the same employee/run must not pick an
      // arbitrary source record or return any preview.
      await denied(e.cookie, ownOverpaymentBody(e, {
        payrollRunId: e.duplicateRunId,
      }), 409, "OVERPAYMENT_SOURCE_ENTRY_COUNT");
    }
    // Even within one employer, arbitrary worker/run pairs cannot be mixed.
    await denied(attackerA.cookie, ownOverpaymentBody(attackerA, {
      employeeId: peer.id,
    }), 409, "OVERPAYMENT_SOURCE_ENTRY_COUNT");
    // Existing employee membership alone cannot grant payroll checker power.
    await denied(employeeSession.cookie, ownOverpaymentBody(attackerA), 403);
    // A privileged role without recently verified MFA cannot access evidence.
    await denied(noMfa.cookie, ownOverpaymentBody(attackerA),
      403, "MFA_REQUIRED");
    await denied(undefined, ownOverpaymentBody(attackerA), 401);
    await denied(attackerA.cookie, ownOverpaymentBody(attackerA),
      403, undefined, true);

    // Both syntax and arithmetic must fail closed without a source preview.
    await denied(attackerA.cookie, ownOverpaymentBody(attackerA, {
      reason: "short",
    }), 400, "OVERPAYMENT_PREVIEW_INVALID_REQUEST");
    await denied(attackerA.cookie, ownOverpaymentBody(attackerA, {
      verifiedGrossPay: "1e4",
    }), 422, "INVALID_AMOUNT");
    await denied(attackerB.cookie, ownOverpaymentBody(attackerB, {
      verifiedGrossPay: "10.00", verifiedNetPay: "20.00",
    }), 422, "INCONSISTENT_VERIFIED_VALUES");

    // The only durable effects permitted by preview are rate-limit counters
    // and session last-used; all business, payroll, money and audit sources
    // for attacker A, attacker B and higher-ID victim must remain identical.
    for (const e of employers) {
      assertOverpaymentSourcesUnchanged(before.get(e.org.id), await readSource(e));
    }
    assertOverpaymentSourcesUnchanged(victimBefore,
      await victimSnapshot(victim.org.id));
    assert.ok(positiveCount === 3 && deniedCount >= 20);
    console.log(JSON.stringify({
      kind: "tenant-overpayment-preview-http",
      method: "POST payroll-overpayment-preview",
      realOwnedPayrollPreviews: positiveCount,
      deniedForeignOrInvalid: deniedCount,
      twoIndependentAuthenticatedAttackers: true,
      genuineHigherIdVictim: true,
      directSourceReleasedFixturesOnly: true,
      exactCentavoSourceAndFingerprint: true,
      unchangedVictimAndAttackerPayroll: true,
      externalPayoutOrDeduction: false,
      realCustomerData: false,
      accepted: false,
      credits: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-overpayment-preview-http.mjs")) {
  verifyOverpaymentPreviewTenantHttp().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
