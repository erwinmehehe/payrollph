/**
 * Read-only tenant-aware navigation sweep across all manifest business-ID pages.
 * Existing role + mobile Chromium navigation still runs in the same workflow.
 * No providers, real employer records, payroll writes or new coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  NAV_TENANT_ORIGIN, requireDisposableNavTenantEnv, tenantNavPageUrl,
  requireRealEmployerTrio, inspectNavPage, assertReadOnlySnapshot, verifyNavCoverage,
} from "./nav-sweep-tenant-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const dir = "qa-artifacts/nav-sweep";

async function readOnlyGet(path, cookie) {
  assert.ok(path.startsWith("/") && !path.startsWith("//"),
    "NAV_TENANT_REFUSED: read-only path must stay relative to localhost");
  const response = await fetch(NAV_TENANT_ORIGIN + path, {
    headers: { cookie }, redirect: "manual", cache: "no-store", method: "GET",
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: response.status, text: await response.text(),
    contentType: response.headers.get("content-type") ?? "",
  };
}

export async function sweepTenantNavigation() {
  // This must run BEFORE importing database, seeds or the application.
  requireDisposableNavTenantEnv();
  const [{ db, pool }, s, { and, asc, eq }, http, { auditBusinessSnapshot }] =
    await Promise.all([
      import("../src/db/index.ts"),
      import("../src/db/schema.ts"),
      import("drizzle-orm"),
      import("./qa/tenant-table-http.mjs"),
      import("./qa/tenant-table-invariants.mjs"),
    ]);
  try {
    const manifest = JSON.parse(readFileSync(
      "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
    const navManifest = JSON.parse(readFileSync(dir + "/manifest.json", "utf8"));
    const fixture = JSON.parse(readFileSync("/tmp/build-block-fixture.json", "utf8"));
    assert.equal(manifest.scopedPages.length, 21);
    assert.ok(Number.isSafeInteger(fixture.organizationId) && fixture.organizationId > 0);
    assert.ok(Array.isArray(navManifest.roles) && navManifest.roles.length >= 5,
      "This must supplement, never replace, the real role/viewport browser sweep");
    const oldFixture = await db.select({ id: s.organizations.id }).from(s.organizations)
      .where(eq(s.organizations.id, fixture.organizationId)).limit(1);
    assert.equal(oldFixture.length, 1, "The existing synthetic nav fixture must be present");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const subjects = [];

    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const employer = await http.seedEmployer(label, nonce, http.standaloneMakeSession);
      const privateNo = employer.marker + "-P";
      assert.ok(privateNo.length <= 32, "Real employee_no varchar(32) bound");
      const [privateEmployee] = await db.insert(s.employees).values({
        organizationId: employer.org.id, legalEntityId: employer.entity.id,
        orgUnitId: employer.unit.id, employeeNo: privateNo,
        firstName: "Private", lastName: employer.marker,
        title: "Fictional", avatarInitials: "PV", basicRate: "20000.00",
        startDate: "2026-01-05",
      }).returning({ id: s.employees.id, employeeNo: s.employees.employeeNo });
      await db.insert(s.employeePayProfiles).values({
        organizationId: employer.org.id, employeeId: privateEmployee.id,
        payBasis: "monthly", rateAmount: "20000.00",
        standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
      });
      await db.insert(s.subscriptions).values({
        organizationId: employer.org.id, plan: "Core", status: "active",
      });
      const [payroll] = await db.insert(s.payrollRuns).values({
        organizationId: employer.org.id,
        periodLabel: employer.marker + "-PRIVATE",
        periodStart: "2099-05-01", periodEnd: "2099-05-15",
        payDate: "2099-05-18",
      }).returning({ id: s.payrollRuns.id });
      // A separate employee identity exercises employee-only page entries.
      const [employeeLogin] = await db.insert(s.users).values({
        email: employer.marker.toLowerCase() + "-nav-worker@example.invalid",
        name: employer.marker + " employee",
        role: "employee", employeeId: employer.worker.id,
        passwordHash: "fictional-session-only",
      }).returning({ id: s.users.id });
      await db.insert(s.userOrganizations).values({
        userId: employeeLogin.id, organizationId: employer.org.id,
        role: "employee", active: true, workerEmployeeId: employer.worker.id,
      });
      const employeeSession = await http.standaloneMakeSession(employeeLogin.id);
      subjects.push({
        label, marker: employer.marker, orgName: employer.org.name,
        orgId: employer.org.id, ownerId: employer.owner.id,
        ownerCookie: employer.cookie, employeeId: employeeLogin.id,
        employeeCookie: employeeSession.cookie,
        privateEmployeeNo: privateEmployee.employeeNo,
        privatePayrollPeriod: employer.marker + "-PRIVATE",
        payrollId: payroll.id,
      });
    }
    requireRealEmployerTrio(subjects);
    const [a, b, victim] = subjects;

    // Every positive must be authenticated as the actual persisted owner.
    for (const subject of subjects) {
      const account = await readOnlyGet("/api/account", subject.ownerCookie);
      assert.equal(account.status, 200, subject.marker + " real owner account");
      const profile = JSON.parse(account.text);
      assert.equal(profile.profile?.id, subject.ownerId,
        "Actor must be the actual independent authenticated owner, not an arbitrary fixture cookie");
    }

    // Snapshot the business and audit state of all three employers. Session
    // last-seen metadata is excluded because it may refresh on a legitimate GET.
    const protectedTables = Object.freeze([
      "organizations", "employees", "employeePayProfiles", "payrollRuns",
      "staffingRequirements", "outbox", "userOrganizations", "auditEvents",
    ]);
    async function snapshot(orgId) {
      const result = {};
      for (const name of protectedTables) {
        const table = s[name];
        assert.ok(table?.id, "Required real SQL table missing: " + name);
        const selector = name === "organizations"
          ? eq(table.id, orgId) : eq(table.organizationId, orgId);
        const rows = await db.select().from(table).where(selector).orderBy(asc(table.id));
        result[name] = name === "auditEvents" ? auditBusinessSnapshot(rows) : rows;
      }
      return plain(result);
    }
    const before = new Map(await Promise.all(subjects.map(async p =>
      [p.orgId, await snapshot(p.orgId)])));
    const observations = [];
    for (const actor of [a, b]) {
      for (const page of manifest.scopedPages) {
        const employeeOnly = page.path.startsWith("src/app/self/");
        const cookie = employeeOnly ? actor.employeeCookie : actor.ownerCookie;
        const own = await readOnlyGet(tenantNavPageUrl(page.path, actor.orgId), cookie);
        const foreign = await readOnlyGet(tenantNavPageUrl(page.path, victim.orgId), cookie);
        const observation = inspectNavPage({ file: page.path,
          own, foreign, actor, victim });
        observations.push(observation);
        // Never treat a feature-off 404, or a generic HTML 200 error shell,
        // as proof of a working authorized page/action.
        console.log("NAV_TENANT_PAGE " + JSON.stringify({
          path: page.path, attacker: actor.label,
          ownStatus: observation.ownStatus,
          foreignStatus: observation.foreignStatus,
          existingStatus: page.status, newCredits: 0,
        }));
      }
      for (const subject of subjects) {
        assertReadOnlySnapshot(before.get(subject.orgId),
          await snapshot(subject.orgId),
          actor.label + " owned and real-victim GET navigation");
      }
    }
    const summary = verifyNavCoverage(manifest, observations);

    // After the full sweep, revoke one employer membership without clearing its
    // session token. A copied employer URL must not remain usable.
    const membershipRows = await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.organizationId, a.orgId),
        eq(s.userOrganizations.userId, a.ownerId),
        eq(s.userOrganizations.active, true)))
      .returning({ id: s.userOrganizations.id });
    assert.equal(membershipRows.length, 1,
      "Exactly one real active owner grant must be revoked");
    const revoked = await readOnlyGet(tenantNavPageUrl("src/app/app/page.tsx", a.orgId),
      a.ownerCookie);
    assert.equal(revoked.status, 404,
      "The same valid signed-in session cannot retain revoked employer workspace access");
    assert.ok(!revoked.text.includes(a.orgName) &&
      !revoked.text.includes(a.privateEmployeeNo),
      "Revoked workspace must not disclose prior employer's private data");
    for (const subject of [b, victim]) {
      assertReadOnlySnapshot(before.get(subject.orgId), await snapshot(subject.orgId),
        "Revoking attacker A must not mutate other employer or audit records");
    }
    const afterRevocation = await snapshot(a.orgId);
    for (const key of protectedTables) {
      if (key !== "userOrganizations") {
        assert.deepEqual(afterRevocation[key], before.get(a.orgId)[key],
          "Revocation can modify only the tested membership, not " + key);
      }
    }
    const original = before.get(a.orgId).userOrganizations;
    const revised = afterRevocation.userOrganizations;
    assert.equal(revised.length, original.length);
    assert.deepEqual(revised.filter(row => row.userId !== a.ownerId),
      original.filter(row => row.userId !== a.ownerId));
    assert.ok(revised.some(row => row.userId === a.ownerId && row.active === false),
      "Actual owner grant must be inactive");

    const report = {
      kind: "READ_ONLY_SCOPED_NAV_NOT_TENANT_CERTIFICATION",
      syntheticOnly: true, productionDataUsed: false,
      sourceStatus: "draft-proof", protectedDataChanges: 0,
      ...summary, sameSessionRevokedAccess: 404,
      disjointEmployerSessions: 6, providerActions: 0,
      observations,
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + "/tenant-edges.json", JSON.stringify(report, null, 2));
    writeFileSync(dir + "/tenant-edges.md", [
      "# Cross-employer navigation edge sweep (disposable only)", "",
      "Source: exact checkout, real PostgreSQL 16 and localhost HTTP.",
      "Two separate authenticated owners plus employee sessions; real higher-ID victim.",
      "Status: not accepted. No new API or page/action coverage credit.",
      "Pages in inventory: " + summary.manifestScopedPages,
      "Comparisons: " + summary.realOwnForeignPageComparisons,
      "Outstanding page/action GAPs: " + summary.remainingPageGaps,
      "Same valid session after revoked employer membership: HTTP " + revoked.status,
      "", "| Attacker | Page | Own | Foreign | Current inventory status |",
      "| --- | --- | --- | --- | --- |",
      ...observations.map(row => "| " + row.attacker + " | " + row.file + " | " +
        row.ownStatus + " | " + row.foreignStatus + " | " +
        manifest.scopedPages.find(p => p.path === row.file).status + " |"),
      "",
    ].join("\n"));
    console.log("NAV_TENANT_COMPLETE " + JSON.stringify({
      ...summary, sameSessionRevokedAccess: revoked.status,
      victimPrivateDataAndAllProtectedTablesUnchanged: true,
    }));
    return report;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("nav-sweep-tenant-edges.mjs")) {
  sweepTenantNavigation().catch(error => {
    console.error("NAV_TENANT_FAILED " + (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
