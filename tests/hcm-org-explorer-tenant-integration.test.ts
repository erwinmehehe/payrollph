import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, jobProfiles, orgUnits, organizations, positionAssignments, positions,
} from "../src/db/schema";
import {
  loadHcmOrgExplorer, loadHcmPositionHistory, OrgExplorerPreviewLimitError,
} from "../src/lib/hcm-org-explorer-server";

/** Synthetic PostgreSQL-only; intentionally exercises actual tenant-bound SQL. */
test("organization map and position history isolate employers, cap data and redact inactive units", async () => {
  const token = randomUUID().slice(0, 9);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "OrgMap Alpha " + token, legalName: "OrgMap Alpha " + token, plan: "Core" },
    { name: "OrgMap Beta " + token, legalName: "OrgMap Beta " + token, plan: "Core" },
  ]).returning();

  try {
    const [alphaUnit, betaUnit] = await db.insert(orgUnits).values([
      { organizationId: alpha.id, code: "OA-" + token, name: "Alpha Org Operations", type: "department" },
      { organizationId: beta.id, code: "OB-" + token, name: "Private Beta Org", type: "department" },
    ]).returning();
    const [alphaProfile, betaProfile] = await db.insert(jobProfiles).values([
      { organizationId: alpha.id, title: "Alpha Current Role" },
      { organizationId: beta.id, title: "Private Beta Role" },
    ]).returning();
    const [alphaPosition, betaPosition] = await db.insert(positions).values([
      { organizationId: alpha.id, code: "PA-" + token, jobProfileId: alphaProfile.id,
        orgUnitId: alphaUnit.id, supervisoryOrgUnitId: alphaUnit.id, status: "open" },
      { organizationId: beta.id, code: "PB-" + token, jobProfileId: betaProfile.id,
        orgUnitId: betaUnit.id, supervisoryOrgUnitId: betaUnit.id, status: "filled" },
    ]).returning();
    const [alphaWorker, betaWorker] = await db.insert(employees).values([
      { organizationId: alpha.id, orgUnitId: alphaUnit.id,
        employeeNo: "MAP-A-" + token, firstName: "Fictional", lastName: "Alpha",
        title: "Staff", avatarInitials: "FA", basicRate: "20000.00", startDate: "2025-01-01" },
      { organizationId: beta.id, orgUnitId: betaUnit.id,
        employeeNo: "MAP-B-" + token, firstName: "Private", lastName: "Beta",
        title: "Staff", avatarInitials: "PB", basicRate: "20000.00", startDate: "2025-01-01" },
    ]).returning();
    const [alphaAssignment, betaAssignment] = await db.insert(positionAssignments).values([
      { organizationId: alpha.id, positionId: alphaPosition.id, employeeId: alphaWorker.id,
        effectiveFrom: "2025-08-01" },
      { organizationId: beta.id, positionId: betaPosition.id, employeeId: betaWorker.id,
        effectiveFrom: "2025-08-01" },
    ]).returning();

    const alphaMap = await loadHcmOrgExplorer(alpha.id);
    assert.equal(alphaMap.tenantId, alpha.id);
    assert.equal(alphaMap.units.length, 1);
    assert.equal(alphaMap.positions.length, 1);
    assert.equal(alphaMap.positions[0].reportingUnitId, alphaUnit.id);
    assert.equal(alphaMap.positions[0].jobTitle, "Alpha Current Role");
    assert.ok(!JSON.stringify(alphaMap).includes("Private Beta"));

    const alphaHistory = await loadHcmPositionHistory(alpha.id, alphaPosition.id);
    assert.ok(alphaHistory);
    assert.equal(alphaHistory.history.preview.items.length, 1);
    assert.equal(alphaHistory.history.preview.items[0].employeeId, alphaWorker.id);
    assert.equal(alphaHistory.history.preview.items[0].id, alphaAssignment.id);
    assert.equal(await loadHcmPositionHistory(alpha.id, betaPosition.id), null,
      "Cannot request Beta position under Alpha employer");
    assert.equal(await loadHcmPositionHistory(beta.id, alphaPosition.id), null);
    const betaHistory = await loadHcmPositionHistory(beta.id, betaPosition.id);
    assert.ok(betaHistory);
    assert.equal(betaHistory.history.preview.items[0].id, betaAssignment.id);
    assert.ok(!JSON.stringify(betaHistory).includes("Alpha Org"));

    const [futureUnit] = await db.insert(orgUnits).values({
      organizationId: alpha.id, code: "FUT-" + token, name: "Future Not Active",
      type: "department", effectiveFrom: "2030-01-01",
    }).returning();
    await db.insert(positions).values({
      organizationId: alpha.id, code: "PF-" + token, jobProfileId: alphaProfile.id,
      orgUnitId: futureUnit.id, supervisoryOrgUnitId: futureUnit.id, status: "planned",
    });
    const withFuture = await loadHcmOrgExplorer(alpha.id);
    assert.ok(!withFuture.units.some((unit) => unit.name === "Future Not Active"));
    const unknownUnit = withFuture.positions.find((position) => position.code === "PF-" + token);
    assert.ok(unknownUnit);
    assert.equal(unknownUnit.relationship, "unit_not_in_snapshot");
    assert.equal(unknownUnit.reportingUnitId, null);
    assert.equal(unknownUnit.orgUnitId, null);

    // 52 assignments: only the first 50 source rows may be returned, with
    // overflow evidence; assignment history must never fake completeness.
    await db.insert(positionAssignments).values(
      Array.from({ length: 51 }, (_, index) => {
        const stamp = String(2010 + Math.floor(index / 12)) + "-" +
          String((index % 12) + 1).padStart(2, "0") + "-01";
        return { organizationId: alpha.id, positionId: alphaPosition.id,
          employeeId: alphaWorker.id, effectiveFrom: stamp, effectiveUntil: stamp };
      }),
    );
    const page = await loadHcmPositionHistory(alpha.id, alphaPosition.id);
    assert.ok(page);
    assert.equal(page.history.preview.items.length, 50);
    assert.equal(page.history.preview.hasMore, true);
    assert.equal(page.history.preview.partial, true);
    assert.ok(page.history.preview.items.every((item) => item.employeeId === alphaWorker.id));
    assert.ok(!JSON.stringify(page).includes("Private Beta"));

    // One active Alpha root already exists. Adding 250 active roots breaches
    // the 250-unit full-graph limit and must fail rather than invent totals.
    await db.insert(orgUnits).values(Array.from({ length: 250 }, (_, index) => ({
      organizationId: alpha.id, code: "CAP-" + token + "-" + index,
      name: "Additional Unit " + index, type: "department",
    })));
    await assert.rejects(loadHcmOrgExplorer(alpha.id), OrgExplorerPreviewLimitError);
    const betaMap = await loadHcmOrgExplorer(beta.id);
    assert.equal(betaMap.units.length, 1);
    assert.equal(betaMap.positions.length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
