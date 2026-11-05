/**
 * MWE classification decision PATCH: separate statutory family, isolated fictional PG16.
 * No live payroll runs, provider calls or migrations; no method credit on this proof PR.
 * A subsequent independently reviewed ledger change may credit one exact-source method.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableMweDecision } from "./tenant-mwe-decision-patch-contract.mjs";

const labels = ["ATTA", "ATTB", "FILL0", "FILL1", "FILL2", "FILL3", "FILL4", "FILL5", "VICTIM"];
const plain = value => JSON.parse(JSON.stringify(value));

export function assertAllExceptUnchanged(before, after, permittedIndex = -1) {
  assert.equal(before.length, 9, "all nine fictional employer snapshots required");
  assert.equal(after.length, 9, "all nine fictional employer snapshots required");
  for (let i = 0; i < 9; i++) {
    if (i !== permittedIndex) {
      assert.deepEqual(after[i], before[i],
        labels[i] + " records, audit, people and payroll remain unchanged");
    }
  }
}

export function assertOneOwnedDecision(before, after, rowId, expected, checkerId) {
  assert.deepEqual(after.employees, before.employees, "decision does not change people");
  assert.deepEqual(after.payrollRuns, before.payrollRuns, "no payroll run changes");
  assert.deepEqual(after.payrollEntries, before.payrollEntries, "no payroll entry changes");
  assert.equal(after.classifications.length, before.classifications.length,
    "decision cannot add or remove MWE records");
  let changed = 0;
  for (const old of before.classifications) {
    const current = after.classifications.find(r => r.id === old.id);
    assert.ok(current, "no classification disappeared");
    if (old.id !== rowId) {
      assert.deepEqual(current, old, "another MWE request cannot change");
      continue;
    }
    changed++;
    assert.equal(old.status, "pending", "owned row was pending");
    assert.equal(current.status, expected, "owned PATCH persisted its requested decision");
    assert.equal(current.organizationId, old.organizationId);
    assert.equal(current.employeeId, old.employeeId);
    assert.equal(current.requestedByUserId, old.requestedByUserId);
    assert.equal(current.decidedByUserId, checkerId, "independent checker identity persisted");
    assert.ok(current.decidedAt && current.updatedAt);
    for (const field of Object.keys(old)) {
      if (["status", "decidedByUserId", "decidedByName", "decisionNote",
        "decidedAt", "updatedAt"].includes(field)) continue;
      assert.deepEqual(current[field], old[field], "unrelated classification field: " + field);
    }
  }
  assert.equal(changed, 1);
  assert.equal(after.auditEvents.length, before.auditEvents.length + 1,
    "exactly one own-employer audit receipt");
  assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents);
  const receipt = after.auditEvents.at(-1);
  assert.equal(receipt.action,
    expected === "approved" ? "MWE classification approved" : "MWE classification rejected");
  assert.equal(Number(receipt.metadata?.classificationId), rowId);
  assert.equal(Number(receipt.metadata?.decidedByUserId ?? receipt.metadata?.approvedByUserId), checkerId);
}

export async function verifyMweDecisionHttp() {
  requireDisposableMweDecision(); // Guard MUST precede any app, database or table imports.
  const [{ db, pool }, s, { eq }, http] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { seedEmployer, addWorker, standaloneMakeSession, standaloneRequest,
    standaloneExpectStatus } = http;
  const expect = standaloneExpectStatus;
  const { organizations, employees, employeeMweClassifications, auditEvents,
    payrollRuns, payrollEntries, users, userOrganizations, sessions } = s;

  try {
    for (const [name, table] of [
      ["employers", organizations], ["MWE requests", employeeMweClassifications],
      ["payroll runs", payrollRuns], ["audit events", auditEvents],
    ]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "MWE_PATCH_REFUSED: nonempty " + name + " on disposable PG16");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const people = [];
    for (const label of labels) {
      people.push(await seedEmployer(label, nonce, standaloneMakeSession));
    }
    const [a, b, ...rest] = people;
    const victim = rest.at(-1);
    assert.ok(victim.org.id > 6 && victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(victim.worker.id > 6 && victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
    assert.notEqual(a.cookie, b.cookie, "independent signed-in attackers");

    async function independentChecker(employer) {
      const [checker] = await db.insert(users).values({
        email: employer.marker.toLowerCase() + "-checker@example.invalid",
        name: employer.marker + " independent checker", passwordHash: "fictional-no-login",
        role: "owner", totpEnabled: true,
      }).returning();
      const [membership] = await db.insert(userOrganizations).values({
        userId: checker.id, organizationId: employer.org.id,
        role: "owner", active: true,
      }).returning();
      const session = await standaloneMakeSession(checker.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
      assert.notEqual(checker.id, employer.owner.id, "maker and independent checker distinct");
      return { checker, membership, cookie: session.cookie };
    }

    const checkers = [await independentChecker(a), await independentChecker(b)];
    const path = (employeeId, classificationId) =>
      "/api/employees/" + employeeId + "/mwe-classifications/" + classificationId;
    const makeRequest = (e, employee, suffix) => ({
      isMwe: false, region: "NCR", employeeDailyWage: 800,
      statutoryMinimumWage: 755, wageOrderReference: "SYNTHETIC-MWE-TEST",
      evidenceReference: e.marker + "-evidence-" + suffix,
      effectiveFrom: "2027-02-01",
    });
    async function createPending(e, worker, suffix) {
      const response = expect(await standaloneRequest(
        "/api/employees/" + worker.id + "/mwe-classifications", {
          method: "POST", cookie: e.cookie, body: makeRequest(e, worker, suffix),
        }), 201, "own fictional MWE evidence creation");
      const record = response.json?.classification;
      assert.equal(record?.status, "pending");
      assert.equal(record?.organizationId, e.org.id);
      assert.equal(record?.employeeId, worker.id);
      assert.equal(record?.requestedByUserId, e.owner.id);
      return record;
    }

    for (const e of people) e.pending = await createPending(e, e.worker, "approve");
    for (const e of [a, b]) {
      e.rejectWorker = await addWorker(e, "R", { payProfile: false });
      e.rejectPending = await createPending(e, e.rejectWorker, "reject");
    }
    assert.ok(victim.pending.id > 6 && victim.pending.id > a.pending.id && victim.pending.id > b.pending.id,
      "actual high-ID victim classification must be persisted after both attackers and fillers");
    assert.notEqual(a.pending.id, b.pending.id);

    async function snapshotEmployer(e) {
      const read = table => db.select().from(table)
        .where(eq(table.organizationId, e.org.id)).orderBy(table.id);
      return plain({
        classifications: await read(employeeMweClassifications),
        employees: await read(employees),
        auditEvents: await read(auditEvents),
        payrollRuns: await read(payrollRuns),
        payrollEntries: await db.select({ id: payrollEntries.id })
          .from(payrollEntries).limit(1), // Fresh DB has no payroll entries.
      });
    }
    const snapshots = () => Promise.all(people.map(snapshotEmployer));
    const victimMarker = victim.marker;
    async function deny(e, cookie, workerId, requestId, decision, status, label, body = {}) {
      const before = await snapshots();
      const response = expect(await standaloneRequest(path(workerId, requestId), {
        method: "PATCH", cookie, body: { decision, ...body },
      }), status, label);
      assert.ok(!response.text.includes(victimMarker), label + ": no victim marker disclosure");
      assert.deepEqual(await snapshots(), before,
        label + ": denied or replayed PATCH cannot modify any employer");
      return response;
    }

    // Both attackers must fail to modify a real foreign employer's populated row.
    // Foreign and unknown IDs must yield the SAME private/no-store 404. A different
    // status would leak record existence and conflict with the now-hardened handler.
    for (let i = 0; i < 2; i++) {
      const e = people[i], { checker, cookie, membership } = checkers[i];
      await deny(e, e.cookie, e.worker.id, e.pending.id, "approve", 403,
        "maker self-approval");
      const foreign = await deny(e, cookie, victim.worker.id, victim.pending.id, "approve", 404,
        "foreign employer denial", { organizationId: e.org.id });
      const unknown = await deny(e, cookie, victim.worker.id, victim.pending.id + 1_000_000,
        "approve", 404, "unknown classification denial", { organizationId: e.org.id });
      assert.equal(foreign.text, unknown.text,
        "foreign and unknown classification IDs must not reveal existence");
      const deniedCache = foreign.headers.get("cache-control") ?? "<missing>";
      assert.match(deniedCache, /private.*no-store/,
        "foreign classification denial must be private/no-store; observed Cache-Control=" + JSON.stringify(deniedCache)
        + ", content-type=" + JSON.stringify(foreign.headers.get("content-type"))
        + ", response=" + JSON.stringify(foreign.text.slice(0, 160)));
      assert.equal(foreign.headers.get("cache-control"), unknown.headers.get("cache-control"),
        "foreign and missing classification cache policy must agree");
      await deny(e, cookie, e.worker.id, victim.pending.id, "approve", 404,
        "swapped classification path");
      await deny(e, cookie, victim.worker.id, e.pending.id, "approve", 404,
        "swapped employee path");
      await deny(e, cookie, e.worker.id, e.pending.id, "not-a-decision", 422,
        "invalid decision");
      await deny(e, cookie, "not-a-number", e.pending.id, "approve", 400,
        "invalid employee ID");
      await db.update(userOrganizations).set({ active: false }).where(eq(userOrganizations.id, membership.id));
      const revoked = await deny(e, cookie, e.worker.id, e.pending.id, "approve", 404,
        "revoked checker grant");
      assert.equal(revoked.text, unknown.text,
        "revoked membership must be indistinguishable from missing classification");
      assert.equal(revoked.headers.get("cache-control"), unknown.headers.get("cache-control"),
        "revoked membership must keep private/no-store denial");
      await db.update(userOrganizations).set({ active: true }).where(eq(userOrganizations.id, membership.id));
      assert.notEqual(checker.id, e.owner.id);
    }

    let approvals = 0, rejections = 0;
    for (let i = 0; i < 2; i++) {
      const e = people[i], checker = checkers[i], cases = [
        { worker: e.worker, row: e.pending, decision: "approve", status: "approved" },
        { worker: e.rejectWorker, row: e.rejectPending, decision: "reject", status: "rejected" },
      ];
      for (const item of cases) {
        const before = await snapshots();
        const response = expect(await standaloneRequest(path(item.worker.id, item.row.id), {
          method: "PATCH", cookie: checker.cookie,
          body: {
            decision: item.decision, decisionNote: "fictional reviewer decision",
            organizationId: victim.org.id, employeeId: victim.worker.id,
            classificationId: victim.pending.id,
          },
        }), 200, "own independent checker " + item.decision);
        assert.equal(response.json?.kind, item.status);
        assert.equal(response.json?.classification?.id, item.row.id);
        assert.equal(response.json?.classification?.organizationId, e.org.id);
        assert.equal(response.json?.classification?.employeeId, item.worker.id);
        assert.ok(!response.text.includes(victimMarker), "own response cannot reveal victim");
        const after = await snapshots();
        assertAllExceptUnchanged(before, after, i);
        assertOneOwnedDecision(before[i], after[i], item.row.id, item.status, checker.checker.id);
        if (item.decision === "approve") approvals++;
        else rejections++;
        await deny(e, checker.cookie, item.worker.id, item.row.id,
          item.decision, 409, "already decided replay");
      }
    }
    assert.equal(approvals, 2);
    assert.equal(rejections, 2);
    assert.equal((await db.select().from(payrollRuns)).length, 0, "no payroll run touched");
    console.log(JSON.stringify({
      method: "PATCH /api/employees/[id]/mwe-classifications/[classificationId]",
      fictionalEmployers: 9, independentAttackerEmployers: 2,
      highIdVictim: true, twoMakerCheckerPairs: true,
      ownedApprovals: approvals, ownedRejections: rejections,
      forbiddenSelfDecisions: 2, deniedVictimDecisions: 2,
      swappedPathRefusals: 4, revokedGrantRefusals: 2,
      invalidActionDenials: 2, replayRefusals: 4,
      allEmployerSnapshotsCompared: true, victimImmutable: true,
      payrollOrProviderWrites: false, productionTested: false,
      coverageCreditsAdded: 0, independentReviewPending: true,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-mwe-decision-patch-http.mjs")) {
  verifyMweDecisionHttp().catch(error => {
    console.error(error instanceof Error ? error.message : "MWE PATCH proof failed");
    process.exitCode = 1;
  });
}
