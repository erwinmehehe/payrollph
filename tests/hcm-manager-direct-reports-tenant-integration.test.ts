import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, jobProfiles, orgUnits, organizations, permissionSets,
  positionAssignments, positions, userOrganizations, userPermissionAssignments, users,
} from "../src/db/schema";
import {
  managerDirectReportsBusinessDate,
} from "../src/lib/hcm-manager-direct-reports";
import {
  loadManagerDirectReports, ManagerDirectReportsAccessError,
} from "../src/lib/hcm-manager-direct-reports-server";

/**
 * Real SQL against disposable fictional PostgreSQL. There are NO payroll
 * calculations, real accounts, employee imports, feature activation or writes
 * outside this synthetic test fixture.
 */
test("a bound manager sees only unambiguous current primary direct reports in their exact employer/unit", async () => {
  const code = randomUUID().slice(0, 10);
  const oldFlags = {
    enabled: process.env.HCM_MANAGER_TEAM_ENABLED,
    orgs: process.env.HCM_MANAGER_TEAM_ORG_IDS,
  };
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Direct Alpha " + code, legalName: "Direct Alpha " + code, plan: "Core" },
    { name: "Direct Beta " + code, legalName: "Direct Beta " + code, plan: "Core" },
  ]).returning();
  let createdUserIds: number[] = [];

  try {
    const [alphaUnit, alphaOther, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "DRA-" + code, name: "Alpha Verified Unit", type: "department" },
      { organizationId: alpha.id, code: "DRO-" + code, name: "Alpha Different Unit", type: "department" },
      { organizationId: beta.id, code: "DRB-" + code, name: "Private Beta Unit", type: "department" },
    ]).returning();
    const [alphaProfile, betaProfile] = await db.insert(jobProfiles).values([
      { organizationId: alpha.id, title: "Synthetic Alpha Position" },
      { organizationId: beta.id, title: "Private Beta Position" },
    ]).returning();
    const [managerA, managerPeer, managerB] = await db.insert(employees).values([
      {
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "MGR-A-" + code, firstName: "AlphaManager", lastName: "Fictional",
        title: "Manager", avatarInitials: "AM", basicRate: "10000.00",
        startDate: "2020-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "MGR-P-" + code, firstName: "OtherManager", lastName: "Fictional",
        title: "Manager", avatarInitials: "OM", basicRate: "10000.00",
        startDate: "2020-01-01",
      },
      {
        organizationId: beta.id, orgUnitId: betaUnit.id,
        employeeNo: "MGR-B-" + code, firstName: "PrivateBetaManager", lastName: "Fictional",
        title: "Manager", avatarInitials: "BM", basicRate: "10000.00",
        startDate: "2020-01-01",
      },
    ]).returning();

    const people = await db.insert(employees).values([
      ...Array.from({ length: 22 }, (_, index) => ({
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "SAME-DIRECT-" + code + "-" + index,
        firstName: "AlphaDirect" + index, lastName: "Fictional",
        title: "Current team member",
        status: index === 0 ? "On leave" : "Active",
        avatarInitials: "AD", basicRate: "15000.00",
        startDate: "2024-01-01",
      })),
      {
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "PEER-" + code, firstName: "PeerOnly", lastName: "Fictional",
        title: "Colleague", avatarInitials: "PO", basicRate: "15000.00",
        startDate: "2024-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaOther.id,
        employeeNo: "OTHER-" + code, firstName: "OutsideUnit", lastName: "Fictional",
        title: "Different unit", avatarInitials: "OU", basicRate: "15000.00",
        startDate: "2024-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "AMB-" + code, firstName: "AmbiguousWorker", lastName: "Fictional",
        title: "Unverified assignment", avatarInitials: "AW", basicRate: "15000.00",
        startDate: "2024-01-01",
      },
      {
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "FUT-" + code, firstName: "FutureOnly", lastName: "Fictional",
        title: "Not yet assigned", avatarInitials: "FO", basicRate: "15000.00",
        startDate: "2024-01-01",
      },
      {
        organizationId: beta.id, orgUnitId: betaUnit.id,
        employeeNo: "SAME-DIRECT-" + code + "-0",
        firstName: "PrivateBetaOnly", lastName: "Fictional",
        title: "Private Beta title", avatarInitials: "PB", basicRate: "99000.00",
        startDate: "2024-01-01",
      },
      // A stale still-current assignment is NOT an employed direct report.
      ...[
        { key: "FORMER", firstName: "FormerDirect", status: "Separated", startDate: "2024-01-01" },
        { key: "FUTURE", firstName: "FutureStartDirect", status: "Active", startDate: "9999-01-01" },
        { key: "EXIT", firstName: "SeparatingDirect", status: "Separating", startDate: "2024-01-01" },
      ].map((worker) => ({
        organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "STALE-" + worker.key + "-" + code,
        firstName: worker.firstName, lastName: "Fictional",
        title: "Stale current-position evidence", status: worker.status,
        avatarInitials: "SD", basicRate: "15000.00",
        startDate: worker.startDate,
      })),
    ]).returning();
    const directs = people.slice(0, 22);
    const peer = people[22];
    const other = people[23];
    const ambiguous = people[24];
    const future = people[25];
    const betaWorker = people[26];

    const pos = await db.insert(positions).values([
      ...directs.map((_, index) => ({
        organizationId: alpha.id, code: "DP-" + code + "-" + index,
        jobProfileId: alphaProfile.id,
        orgUnitId: alphaUnit.id, supervisoryOrgUnitId: alphaUnit.id,
        managerEmployeeId: managerA.id, status: "filled",
      })),
      {
        organizationId: alpha.id, code: "PEER-" + code,
        jobProfileId: alphaProfile.id, orgUnitId: alphaUnit.id,
        supervisoryOrgUnitId: alphaUnit.id, managerEmployeeId: managerPeer.id, status: "filled",
      },
      {
        organizationId: alpha.id, code: "OUTSIDE-" + code,
        jobProfileId: alphaProfile.id, orgUnitId: alphaOther.id,
        supervisoryOrgUnitId: alphaOther.id, managerEmployeeId: managerA.id, status: "filled",
      },
      {
        organizationId: alpha.id, code: "AMB1-" + code,
        jobProfileId: alphaProfile.id, orgUnitId: alphaUnit.id,
        supervisoryOrgUnitId: alphaUnit.id, managerEmployeeId: managerA.id, status: "filled",
      },
      {
        organizationId: alpha.id, code: "AMB2-" + code,
        jobProfileId: alphaProfile.id, orgUnitId: alphaUnit.id,
        supervisoryOrgUnitId: alphaUnit.id, managerEmployeeId: managerPeer.id, status: "filled",
      },
      {
        organizationId: alpha.id, code: "FUT-" + code,
        jobProfileId: alphaProfile.id, orgUnitId: alphaUnit.id,
        supervisoryOrgUnitId: alphaUnit.id, managerEmployeeId: managerA.id, status: "planned",
      },
      {
        organizationId: beta.id, code: "BETA-" + code,
        jobProfileId: betaProfile.id, orgUnitId: betaUnit.id,
        supervisoryOrgUnitId: betaUnit.id, managerEmployeeId: managerB.id, status: "filled",
      },
      ...["FORMER", "FUTURE", "EXIT"].map((kind) => ({
        organizationId: alpha.id, code: "STALE-" + kind + "-" + code,
        jobProfileId: alphaProfile.id,
        orgUnitId: alphaUnit.id, supervisoryOrgUnitId: alphaUnit.id,
        managerEmployeeId: managerA.id, status: "filled",
      })),
    ]).returning();
    await db.insert(positionAssignments).values([
      ...directs.map((employee, index) => ({
        organizationId: alpha.id, employeeId: employee.id,
        positionId: pos[index].id, assignmentType: "primary",
        effectiveFrom: "2024-01-01",
      })),
      {
        organizationId: alpha.id, employeeId: peer.id,
        positionId: pos[22].id, effectiveFrom: "2024-01-01",
      },
      {
        organizationId: alpha.id, employeeId: other.id,
        positionId: pos[23].id, effectiveFrom: "2024-01-01",
      },
      // Two finite, overlapping primary assignments: never pick one manager.
      {
        organizationId: alpha.id, employeeId: ambiguous.id,
        positionId: pos[24].id, effectiveFrom: "2024-01-01",
        effectiveUntil: "9999-12-31",
      },
      {
        organizationId: alpha.id, employeeId: ambiguous.id,
        positionId: pos[25].id, effectiveFrom: "2025-01-01",
        effectiveUntil: "9999-12-31",
      },
      {
        organizationId: alpha.id, employeeId: future.id,
        positionId: pos[26].id, effectiveFrom: "9999-01-01",
      },
      {
        organizationId: beta.id, employeeId: betaWorker.id,
        positionId: pos[27].id, effectiveFrom: "2024-01-01",
      },
      // All three assignments look current, but the underlying employee
      // state is not current. The manager must see none of these identities.
      ...people.slice(27, 30).map((employee, index) => ({
        organizationId: alpha.id, employeeId: employee.id,
        positionId: pos[28 + index].id, assignmentType: "primary",
        effectiveFrom: "2024-01-01",
      })),
    ]);

    const createdUsers = await db.insert(users).values([
      { email: "dr-alpha-" + code + "@example.test", name: "Synthetic alpha manager", role: "manager", passwordHash: "not-a-password" },
      { email: "dr-beta-" + code + "@example.test", name: "Synthetic beta manager", role: "manager", passwordHash: "not-a-password" },
      { email: "dr-unlinked-" + code + "@example.test", name: "Unlinked manager", role: "manager", passwordHash: "not-a-password" },
      { email: "dr-foreign-" + code + "@example.test", name: "Foreign worker link", role: "manager", passwordHash: "not-a-password" },
      { email: "dr-hr-" + code + "@example.test", name: "HR cannot open manager-only", role: "hr", passwordHash: "not-a-password" },
    ]).returning();
    createdUserIds = createdUsers.map((user) => user.id);

    const [alphaMembership] = await db.insert(userOrganizations).values([
      { userId: createdUsers[0].id, organizationId: alpha.id,
        orgUnitId: alphaUnit.id, role: "manager", workerEmployeeId: managerA.id, active: true },
      { userId: createdUsers[1].id, organizationId: beta.id,
        orgUnitId: betaUnit.id, role: "manager", workerEmployeeId: managerB.id, active: true },
      { userId: createdUsers[2].id, organizationId: alpha.id,
        orgUnitId: alphaUnit.id, role: "manager", workerEmployeeId: null, active: true },
      // An existing FK is NOT sufficient if the linked worker belongs to Beta.
      { userId: createdUsers[3].id, organizationId: alpha.id,
        orgUnitId: alphaUnit.id, role: "manager", workerEmployeeId: managerB.id, active: true },
      { userId: createdUsers[4].id, organizationId: alpha.id,
        orgUnitId: alphaUnit.id, role: "hr", active: true },
    ]).returning();

    process.env.HCM_MANAGER_TEAM_ENABLED = "true";
    process.env.HCM_MANAGER_TEAM_ORG_IDS = [alpha.id, beta.id].join(",");
    const read = (userId: number, organizationId = alpha.id, cursor = 0) =>
      loadManagerDirectReports({ userId, organizationId, cursor });

    const first = await read(createdUsers[0].id);
    assert.equal(first.organizationId, alpha.id);
    assert.equal(first.asOfDate, managerDirectReportsBusinessDate());
    assert.deepEqual(first.scope, { kind: "verified_direct_reports", orgUnitId: alphaUnit.id });
    assert.equal(first.items.length, 20);
    assert.equal(first.page.size, 20);
    assert.equal(first.page.hasMore, true);
    assert.ok(first.page.nextCursor);
    assert.ok(first.items.every((item) =>
      item.reportingUnitId === alphaUnit.id &&
      item.reportingUnitName === "Alpha Verified Unit" &&
      item.positionCode.startsWith("DP-" + code)));
    assert.equal(first.items[0].status, "On leave");

    const second = await read(createdUsers[0].id, alpha.id, first.page.nextCursor!);
    assert.equal(second.items.length, 2);
    assert.equal(second.page.hasMore, false);
    assert.equal(second.page.nextCursor, null);
    const combined = [...first.items, ...second.items];
    assert.equal(new Set(combined.map((item) => item.assignmentId)).size, 22);
    const serialized = JSON.stringify([first, second]);
    for (const forbidden of [
      "PrivateBetaOnly", "99000.00", "PeerOnly", "OutsideUnit",
      "AmbiguousWorker", "FutureOnly", "FormerDirect", "FutureStartDirect",
      "SeparatingDirect", "not-a-password", "basicRate",
      "bankAccount", "approvalNote", "performanceRating",
    ]) assert.ok(!serialized.includes(forbidden), "Unexpected scope or private field: " + forbidden);
    assert.equal(Object.hasOwn(first, "totalHeadcount"), false);

    // An active account/membership is not proof that its employee of record
    // is still employed. Deny the entire manager view before selecting reports.
    for (const status of ["Separating", "Separated", "Inactive", "Suspended"]) {
      await db.update(employees).set({ status }).where(eq(employees.id, managerA.id));
      await assert.rejects(read(createdUsers[0].id), ManagerDirectReportsAccessError,
        "Worker status " + status + " must not retain manager visibility");
    }
    // Leave is still an employed state; scope and permissions continue to
    // control the view without silently converting it to an unlinked account.
    await db.update(employees).set({ status: "On leave" }).where(eq(employees.id, managerA.id));
    assert.equal((await read(createdUsers[0].id)).items.length, 20);

    // A future-start employee cannot act as a current manager even when a
    // stale/early membership has already been assigned to the account.
    await db.update(employees).set({
      status: "Active", startDate: "9999-01-01",
    }).where(eq(employees.id, managerA.id));
    await assert.rejects(read(createdUsers[0].id), ManagerDirectReportsAccessError);
    await db.update(employees).set({ startDate: "2020-01-01" })
      .where(eq(employees.id, managerA.id));
    assert.equal((await read(createdUsers[0].id)).items.length, 20);

    const betaView = await read(createdUsers[1].id, beta.id);
    assert.deepEqual(betaView.items.map((row) => row.employeeNo), [betaWorker.employeeNo]);
    assert.ok(!JSON.stringify(betaView).includes("AlphaDirect"));
    await assert.rejects(read(createdUsers[0].id, beta.id), ManagerDirectReportsAccessError);
    await assert.rejects(read(createdUsers[2].id), ManagerDirectReportsAccessError);
    await assert.rejects(read(createdUsers[3].id), ManagerDirectReportsAccessError);
    await assert.rejects(read(createdUsers[4].id), ManagerDirectReportsAccessError);

    // The custom permission-set overlay must remain DENY-ONLY even with a
    // valid manager membership and worker-of-record linkage.
    const [restricted] = await db.insert(permissionSets).values({
      organizationId: alpha.id, name: "No workforce manage " + code,
      permissions: ["people.admin"], active: true,
    }).returning();
    const [restriction] = await db.insert(userPermissionAssignments).values({
      organizationId: alpha.id, userOrganizationId: alphaMembership.id,
      permissionSetId: restricted.id,
    }).returning();
    await assert.rejects(read(createdUsers[0].id), ManagerDirectReportsAccessError);
    await db.delete(userPermissionAssignments).where(eq(userPermissionAssignments.id, restriction.id));

    // Feature OFF means even the previously valid synthetic actor is denied.
    process.env.HCM_MANAGER_TEAM_ENABLED = "false";
    await assert.rejects(read(createdUsers[0].id), ManagerDirectReportsAccessError);
  } finally {
    if (oldFlags.enabled === undefined) delete process.env.HCM_MANAGER_TEAM_ENABLED;
    else process.env.HCM_MANAGER_TEAM_ENABLED = oldFlags.enabled;
    if (oldFlags.orgs === undefined) delete process.env.HCM_MANAGER_TEAM_ORG_IDS;
    else process.env.HCM_MANAGER_TEAM_ORG_IDS = oldFlags.orgs;
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
