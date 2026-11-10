/**
 * Exact-source HCM Process Monitor SSR tenant check, fictional PostgreSQL 16 only.
 * Two independent own employers, a later-ID real victim, employer-qualified
 * source rows/steps, forged filters, role denial, revocation and immutable SQL.
 * GET-only; no workflow decision, approval, payroll, filing or provider calls.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, PAGE, requireDisposableMonitorEnv, verifyMonitorSource,
  normalizeSsrText, noForeignProcess, assertOwnMonitorPage, assertDeniedMonitorPage,
} from "./tenant-hcm-process-monitor-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
function pagePath(orgId, processId = null, extra = "") {
  return PAGE + "?organizationId=" + orgId +
    (processId === null ? "" : "&processId=" + processId) + extra;
}
async function requestLocal(path, cookie) {
  assert.ok(path === "/api/account" || path === PAGE || path.startsWith(PAGE + "?"),
    "TENANT_MONITOR_REFUSED: unreviewed path");
  const response = await fetch(ORIGIN + path, {
    method: "GET", headers: cookie ? { cookie } : {},
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  if (path === "/api/account") { try { json = JSON.parse(text); } catch {} }
  return { status: response.status, text, headers: response.headers, json };
}

export async function proveMonitorPageTenantBoundary() {
  requireDisposableMonitorEnv();
  verifyMonitorSource();
  // This import happens ONLY after strict localhost+PG16+source-pin refusal.
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);

  const protectedTables = [
    "organizations", "employees", "hcmBusinessProcessInstances",
    "hcmBusinessProcessInstanceSteps", "payrollRuns", "auditEvents",
  ];
  async function snapshot(orgId) {
    const result = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id, "Missing protected SQL table " + name);
      result[name] = plain(await db.select().from(table)
        .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
        .orderBy(asc(table.id)));
    }
    return result;
  }

  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Real disposable PostgreSQL 16 required");
    assert.deepEqual(await db.select().from(s.organizations).limit(1), [],
      "Refuse nonempty employer database");
    assert.deepEqual(await db.select().from(s.users).limit(1), [],
      "Refuse preexisting account data");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = { ...(await fixture.seedEmployer("ATTA", nonce, fixture.standaloneMakeSession)), label: "A" };
    const b = { ...(await fixture.seedEmployer("ATTB", nonce, fixture.standaloneMakeSession)), label: "B" };
    const victim = { ...(await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession)), label: "victim" };
    const subjects = [a, b, victim];
    assert.deepEqual(subjects.map(subject => subject.org.id), [1, 2, 3],
      "Fail closed unless exact build-time employer allowlist equals fictional employers");
    assert.equal(new Set(subjects.map(subject => subject.cookie)).size, 3,
      "Three independent signed-in cookie sessions");

    async function seedProcess(subject, suffix, status = "in_progress") {
      const [process] = await db.insert(s.hcmBusinessProcessInstances).values({
        organizationId: subject.org.id,
        definitionCode: "QA-MONITOR",
        definitionVersion: 1,
        processType: "transfer", sourceType: "fictional-monitor-qa",
        sourceKey: subject.marker + "-" + suffix,
        employeeId: subject.worker.id,
        supervisoryOrgUnitId: subject.unit.id,
        definitionSnapshot: { fictionalOnly: true, privateMarker: subject.marker },
        status, currentStepIndex: 0,
        initiatedByUserId: subject.owner.id,
        initiatedByName: subject.marker + " private maker",
      }).returning();
      await db.insert(s.hcmBusinessProcessInstanceSteps).values({
        organizationId: subject.org.id, instanceId: process.id,
        stepIndex: 0, stepType: "approval",
        label: "Private " + subject.marker + " step",
        assignee: "private-" + subject.marker + "@example.invalid",
        status: status === "in_progress" ? "pending" : "completed",
        dueAt: new Date("2026-10-01T00:00:00Z"),
      });
      return process;
    }
    for (const subject of subjects) {
      subject.process = await seedProcess(subject, "own");
      subject.secondProcess = await seedProcess(subject, "history", "approved");
    }
    // Actual process IDs differ for each employer and the victim is higher.
    for (const actor of [a, b]) for (const kind of ["org", "entity", "unit", "owner", "worker", "process"]) {
      assert.ok(victim[kind].id > actor[kind].id, "Higher-ID real victim " + kind + " required");
    }

    async function extraMember(role, unitId = null) {
      const [user] = await db.insert(s.users).values({
        email: "monitor-" + role + "-" + (unitId ?? "all") + "-" + nonce + "@example.invalid",
        name: "Fictional " + role + " " + nonce,
        passwordHash: "fictional-session-only", role: role === "group_hr" ? "owner" : role,
        totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: user.id, organizationId: a.org.id, role, orgUnitId: unitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const unitHr = await extraMember("hr", a.unit.id);
    const companyBookkeeper = await extraMember("bookkeeper");
    const groupHr = await extraMember("group_hr");

    const before = new Map(await Promise.all(subjects.map(async subject =>
      [subject.org.id, await snapshot(subject.org.id)])));
    async function unchanged(label) {
      for (const subject of subjects) {
        assert.deepEqual(await snapshot(subject.org.id), before.get(subject.org.id),
          label + ": employer/workflow/payroll/audit SQL mutated by GET");
      }
    }
    let ownPages = 0, foreignDenials = 0, invalidDenials = 0;
    async function deny(path, cookie, label) {
      const response = await requestLocal(path, cookie);
      assertDeniedMonitorPage(response, subjects, label);
      await unchanged(label);
      return response;
    }
    for (const actor of [a, b]) {
      const account = await requestLocal("/api/account", actor.cookie);
      assert.equal(account.status, 200, "Real signed-in HTTP account required");
      assert.equal(account.json?.profile?.id, actor.owner.id);

      const own = await requestLocal(pagePath(actor.org.id, actor.process.id), actor.cookie);
      assertOwnMonitorPage(own, actor, subjects);
      ownPages++;
      await unchanged("authorized selected process");

      const list = await requestLocal(pagePath(actor.org.id), actor.cookie);
      assertOwnMonitorPage(list, actor, subjects, { selected: false });
      ownPages++;
      await unchanged("authorized process list");

      const statusFiltered = await requestLocal(pagePath(actor.org.id, null, "&status=approved"), actor.cookie);
      assert.equal(statusFiltered.status, 200);
      assert.ok(normalizeSsrText(statusFiltered.text).includes("Approved · source application not verified"),
        "Real stored approved workflow must appear in filtered SSR list");
      assert.ok(normalizeSsrText(statusFiltered.text).includes("processId=" + actor.secondProcess.id),
        "Filtered list must reflect seeded own approved workflow");
      noForeignProcess(statusFiltered.text, subjects.filter(s => s.org.id !== actor.org.id), "filtered page");
      await unchanged("status filter");

      // An arbitrary cursor that points beyond a victim's ID cannot change
      // the employer predicate or expose the victim's records.
      const cursor = await requestLocal(pagePath(actor.org.id, null,
        "&cursor=" + victim.process.id), actor.cookie);
      assertOwnMonitorPage(cursor, actor, subjects, { selected: false });
      await unchanged("foreign-derived cursor");

      for (const other of subjects.filter(s => s.org.id !== actor.org.id)) {
        await deny(pagePath(other.org.id, other.process.id), actor.cookie,
          "foreign employer and process");
        await deny(pagePath(actor.org.id, other.process.id), actor.cookie,
          "real foreign process under own employer");
        foreignDenials += 2;
      }
      await deny(pagePath(actor.org.id, 999999999), actor.cookie,
        "nonexistent process ID");
      for (const suffix of [
        "&processId=0", "&processId=01", "&processId=-1", "&processId=1e0",
        "&processId=9007199254740992", "&processId=%201",
        "&processId=" + actor.process.id + "&processId=" + victim.process.id,
        "&organizationId=" + victim.org.id,
        "&status=approved&status=in_progress",
        "&cursor=1&cursor=2",
        "&status=private",
      ]) {
        await deny(pagePath(actor.org.id, null, suffix), actor.cookie,
          "forged or duplicated selector " + suffix);
        invalidDenials++;
      }
    }
    assert.equal(ownPages, 4);
    assert.equal(foreignDenials, 8);
    assert.ok(invalidDenials >= 20);

    for (const [label, caller] of [
      ["unit-scoped HR", unitHr],
      ["company-wide bookkeeper", companyBookkeeper],
      ["group HR", groupHr],
    ]) {
      await deny(pagePath(a.org.id, a.process.id), caller.cookie,
        label + " has no full company-wide People monitor permission");
    }
    const anonymous = await requestLocal(pagePath(victim.org.id, victim.process.id));
    assert.ok([302, 303, 307, 308].includes(anonymous.status),
      "Anonymous monitor must redirect to login");
    assert.ok(anonymous.headers.get("location")?.includes("/login"),
      "Anonymous monitor redirect must target login");
    // A login redirect may echo the caller-supplied ID in router metadata, not private SQL.
    noForeignProcess(anonymous.text, subjects, "anonymous", { allowRequestIdReflection: true });
    await unchanged("anonymous");

    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true)))
      .returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1, "Real active membership revoked");
    const accountAfterRevocation = await requestLocal("/api/account", a.cookie);
    assert.equal(accountAfterRevocation.status, 200, "Session must stay valid after membership revoked");
    assert.equal(accountAfterRevocation.json?.profile?.id, a.owner.id);
    await deny(pagePath(a.org.id, a.process.id), a.cookie,
      "revoked member still signed in");
    await unchanged("all denied/read cases");

    // Deliberate disposable schema fault. A selected-process SQL failure must
    // never mount the private page; an unselected list must report source
    // unavailability, never a verified healthy zero.
    await pool.query("ALTER TABLE hcm_business_process_instances RENAME TO qa_monitor_unavailable");
    const fault = await requestLocal(pagePath(b.org.id, b.process.id), b.cookie);
    assert.ok([500, 503].includes(fault.status),
      "Missing selected-process source must fail closed");
    assert.ok(!fault.text.includes("Recorded workflows"),
      "SQL error cannot render private process list");
    // The error shell can similarly serialize the request URL; private markers remain forbidden.
    noForeignProcess(fault.text, subjects, "selected source outage", { allowRequestIdReflection: true });

    const unavailable = await requestLocal(pagePath(b.org.id), b.cookie);
    assert.equal(unavailable.status, 200, "Authorized outage shows explicit failure");
    assert.ok(unavailable.text.includes("Workflow source unavailable"),
      "Outage must not be represented as a healthy empty list");
    assert.ok(!unavailable.text.includes("No workflow records in this filtered page"),
      "Outage cannot pass as a zero-workflow result");

    const result = {
      kind: "HCM_MONITOR_SSR_FICTIONAL_PG16_CANDIDATE",
      employers: 3, independentAttackerOwners: 2,
      ownPages, foreignDenials, invalidDenials,
      groupRoleDenied: true, unitRoleDenied: true,
      revokedMemberStillAuthenticatedDenied: true,
      sourceOutageFailsClosed: true, immutableDatabaseReads: true,
      apiMethodCredits: 0, pageActionCredits: 0,
      independentlyAccepted: false, productionCertified: false,
    };
    console.log("TENANT_HCM_MONITOR_PG16_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("tenant-hcm-process-monitor-http.mjs")) {
  proveMonitorPageTenantBoundary().catch(error => {
    console.error("TENANT_HCM_MONITOR_PG16_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
