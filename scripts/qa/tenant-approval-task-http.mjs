/**
 * Independent GAP candidate: PATCH /api/approvals/[id].
 * Three real fictional employers and authenticated production-mode localhost HTTP
 * against disposable PostgreSQL 16. Only unrelated generic approval tasks are
 * decided; no payroll, leave, HCM or approval-chain source is ever advanced.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  APPROVAL_METHOD, requireDisposableApprovalTask, assertApprovalDenial,
  assertOwnApproval, assertApprovalAudit, assertUnchanged,
} from "./tenant-approval-task-contract.mjs";

export async function verifyApprovalTaskTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposableApprovalTask();
  const [{ db, pool }, schema, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const {
    organizations, approvalTasks, auditEvents, employees, employeePayProfiles,
    payrollRuns, payrollEntries, userOrganizations, users, sessions,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;

  try {
    // Reject a pre-existing database before creating any fictional employer.
    for (const [name, table] of [
      ["organizations", organizations], ["approval_tasks", approvalTasks],
      ["audit_events", auditEvents], ["payroll_runs", payrollRuns],
    ]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "APPROVAL_TASK_PROOF_REFUSED: genuinely empty disposable " + name + " required");
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(victim.owner.id > a.owner.id && victim.owner.id > b.owner.id);
    assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);

    async function createTask(employer, suffix) {
      const [task] = await db.insert(approvalTasks).values({
        organizationId: employer.org.id,
        title: employer.marker + " " + suffix,
        detail: "Fictional administrative task; no payroll or employee workflow",
        approver: "role:owner", dueLabel: "Synthetic fixture only", status: "Pending",
      }).returning();
      assert.equal(task.organizationId, employer.org.id);
      assert.equal(task.payrollRunId, null);
      assert.equal(task.approvalChainInstanceId, null);
      return task;
    }
    const aTask = await createTask(a, "own target");
    const aSecondary = await createTask(a, "denial control");
    const bTask = await createTask(b, "own target");
    const bSecondary = await createTask(b, "denial control");
    const victimTask = await createTask(victim, "foreign pending target");
    const victimControl = await createTask(victim, "victim own positive control");
    assert.ok(victimTask.id > Math.max(aTask.id, bTask.id, aSecondary.id, bSecondary.id),
      "victim path must be a genuine higher-ID persisted approval task");

    async function makeActor(employer, label, name, role, active) {
      const [user] = await db.insert(users).values({
        email: "approval-" + label + "-" + nonce + "@example.invalid",
        name, passwordHash: "fictional-session-only", role,
        totpEnabled: true, active: true,
      }).returning();
      await db.insert(userOrganizations).values({
        userId: user.id, organizationId: employer.org.id, role, active,
      });
      const session = await standaloneMakeSession(user.id);
      await db.update(sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const nonOwner = await makeActor(a, "bookkeeper", "Fictional A bookkeeper", "bookkeeper", true);
    const revoked = await makeActor(b, "revoked", "Fictional B revoked owner", "owner", false);
    const sameNameAttacker = await makeActor(a, "mimic", victim.owner.name, "owner", true);

    async function snapshot(orgId) {
      return {
        organizations: await db.select().from(organizations).where(eq(organizations.id, orgId)),
        employees: await db.select().from(employees).where(eq(employees.organizationId, orgId)).orderBy(asc(employees.id)),
        payProfiles: await db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, orgId)).orderBy(asc(employeePayProfiles.id)),
        members: await db.select().from(userOrganizations).where(eq(userOrganizations.organizationId, orgId)).orderBy(asc(userOrganizations.id)),
        tasks: await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, orgId)).orderBy(asc(approvalTasks.id)),
        payrollRuns: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollRuns.id)),
        payrollEntries: await db.select({ entry: payrollEntries }).from(payrollEntries)
          .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
          .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)),
        audits: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(asc(auditEvents.id)),
      };
    }
    const forbidden = [victim.marker, a.cookie.split("=")[1], b.cookie.split("=")[1], victim.cookie.split("=")[1]];
    const endpoint = task => "/api/approvals/" + task.id;
    const decision = (task, cookie, status, extra = {}) => standaloneRequest(endpoint(task), {
      method: "PATCH", cookie, body: { status, ...extra },
    });
    const denied = async (responsePromise, status, label) => {
      const response = await responsePromise;
      assertApprovalDenial(response, status, forbidden);
      assert.ok(!response.text.includes(victimTask.title), label + ": victim task title leaked");
      return response;
    };

    // Real victim-side HTTP success proves that the later attacked task family
    // is reachable, not merely disabled/anonymous. The attacked task stays pending.
    const victimPositive = await decision(victimControl, victim.cookie, "Approved");
    assertOwnApproval(victimPositive, {
      id: victimControl.id, organizationId: victim.org.id,
      status: "Approved", actor: victim.owner.name,
    });
    assertApprovalAudit((await snapshot(victim.org.id)).audits, {
      organizationId: victim.org.id, id: victimControl.id,
      status: "Approved", actor: victim.owner.name, userId: victim.owner.id,
    });
    const baseline = new Map(await Promise.all([a, b, victim]
      .map(async employer => [employer.org.id, await snapshot(employer.org.id)])));
    assert.equal(baseline.get(victim.org.id).tasks.find(task => task.id === victimTask.id)?.status, "Pending");

    // Every denial must return a non-leaking HTTP error and modify NO tenant's
    // persisted task, payroll, people, membership or audit rows.
    for (const [attacker, peer] of [[a, b], [b, a]]) {
      await denied(decision(victimTask, attacker.cookie, "Approved"), 404, "foreign victim");
      await denied(decision(peer === a ? aSecondary : bSecondary,
        attacker.cookie, "Declined"), 404, "other attacker employer");
      await denied(standaloneRequest("/api/approvals/" + (victimTask.id + 100000), {
        method: "PATCH", cookie: attacker.cookie, body: { status: "Approved" },
      }), 404, "missing approval ID");
    }
    await denied(decision(victimTask, sameNameAttacker.cookie, "Declined"), 404,
      "same name as victim approver but other employer");
    await denied(decision(aSecondary, nonOwner.cookie, "Approved"), 403,
      "active nonowner role cannot use role:owner approver");
    const revokedResponse = await decision(bSecondary, revoked.cookie, "Approved");
    assert.ok([401, 404].includes(revokedResponse.status),
      "revoked employer membership must not decide an owned task");
    assertApprovalDenial(revokedResponse, revokedResponse.status, forbidden);
    await denied(decision(aSecondary, a.cookie, "NotAStatus"), 400,
      "malformed status");
    await denied(decision(victimTask, undefined, "Approved"), 401,
      "anonymous cannot approve a valid victim task");

    const wrongOrigin = await fetch(new URL(endpoint(aSecondary), process.env.SECURITY_SMOKE_URL), {
      method: "PATCH", headers: {
        cookie: a.cookie, origin: "https://attacker.example.test", "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      }, body: JSON.stringify({ status: "Approved" }), redirect: "manual", cache: "no-store",
    });
    const wrongText = await wrongOrigin.text();
    let wrongJson; try { wrongJson = JSON.parse(wrongText); } catch { wrongJson = null; }
    assertApprovalDenial({status: wrongOrigin.status, text: wrongText,
      json: wrongJson, headers: wrongOrigin.headers }, 403, forbidden);

    for (const employer of [a, b, victim]) {
      assertUnchanged(baseline.get(employer.org.id), await snapshot(employer.org.id),
        employer.label + " denied requests");
    }

    // Two *separate* attacker employer owners successfully decide ONLY their
    // own real generic tasks; untrusted body org and task selectors are ignored.
    const ownedA = await decision(aTask, a.cookie, "Declined", {
      organizationId: victim.org.id, taskId: victimTask.id, approver: victim.owner.name,
    });
    assertOwnApproval(ownedA, {
      id: aTask.id, organizationId: a.org.id,
      status: "Declined", actor: a.owner.name,
    });
    assert.ok(!ownedA.text.includes(victim.marker), "forged own result leaked victim marker");
    const ownedB = await decision(bTask, b.cookie, "Approved");
    assertOwnApproval(ownedB, {
      id: bTask.id, organizationId: b.org.id,
      status: "Approved", actor: b.owner.name,
    });
    assert.throws(() => assertOwnApproval(ownedA, {
      id: bTask.id, organizationId: b.org.id, status: "Approved", actor: b.owner.name,
    }), "A's real HTTP result must fail B's own-object proof");

    const afterValid = new Map(await Promise.all([a, b]
      .map(async employer => [employer.org.id, await snapshot(employer.org.id)])));
    for (const [employer, task, state] of [[a, aTask, "Declined"], [b, bTask, "Approved"]]) {
      const after = afterValid.get(employer.org.id);
      const original = baseline.get(employer.org.id);
      const saved = after.tasks.find(item => item.id === task.id);
      assert.equal(saved?.status, state, "own decision is persisted in the SQL source");
      assert.equal(saved?.decidedBy, employer.owner.name);
      assert.equal(after.tasks.find(item => item.id === (employer === a ? aSecondary.id : bSecondary.id))?.status,
        "Pending", "forbidden and unsupported decisions cannot alter secondary task");
      assertApprovalAudit(after.audits, {
        organizationId: employer.org.id, id: task.id,
        status: state, actor: employer.owner.name, userId: employer.owner.id,
      });
      assert.equal(after.audits.length, original.audits.length + 1, "one and only one new own audit");
      for (const key of ["organizations", "employees", "payProfiles", "members", "payrollRuns", "payrollEntries"]) {
        assert.deepEqual(after[key], original[key], key + " must not be changed by generic approval");
      }
    }
    await denied(decision(aTask, a.cookie, "Declined"), 409, "same-choice replay");
    await denied(decision(bTask, b.cookie, "Approved"), 409, "same-choice replay");
    for (const employer of [a, b]) {
      assertUnchanged(afterValid.get(employer.org.id), await snapshot(employer.org.id),
        employer.label + " replay must be idempotent");
    }
    assertUnchanged(baseline.get(victim.org.id), await snapshot(victim.org.id),
      "victim remains byte-identical after every attacker request and positive");

    console.log(JSON.stringify({
      kind: "tenant-approval-task-isolation", method: APPROVAL_METHOD,
      independentAttackers: 2, employers: 3, higherIdVictim: true,
      realOwnedDecisions: ["Declined", "Approved"], victimOwnPositive: true,
      foreignAndPeerPath404: true, revokedAndNonownerDenied: true,
      csrfDenied: true, replay409: true, fullVictimSnapshotUnchanged: true,
      payrollAndPeopleUnchanged: true, productionTested: false,
      coverageCredits: 0, independentlyAccepted: false,
    }));
    return { method: APPROVAL_METHOD, credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("scripts/qa/tenant-approval-task-http.mjs")) {
  verifyApprovalTaskTenantIsolation().catch(error => {
    console.error(error instanceof Error ? error.message : "Approval isolation proof failed");
    process.exitCode = 1;
  });
}
