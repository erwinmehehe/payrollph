import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles, employees, organizations, payrollRuns,
  provisioningTasks, userOrganizations, users,
} from "../src/db/schema";
import { loadPeopleHomeWorklist } from "../src/lib/hcm-people-home-worklist";
import { resolvePeopleEmployeeFocus } from "../src/lib/hcm-people-employee-focus";
import { loadHirePayrollInputReview } from "../src/lib/hcm-hire-payroll-review-server";
import { buildHcmWorkerJourney, type WorkerJourneyInput } from "../src/lib/hcm-worker-journey";

/**
 * End-to-end READ-MODEL reconciliation for synthetic HR work, not a real
 * candidate-to-hire / payroll release transaction or provider acceptance.
 */
test("an HCM onboarding source flows from People Home into worker and pay-input evidence, never release", async () => {
  const suffix = randomUUID().slice(0, 9);
  const saved = {
    enabled: process.env.HCM_PEOPLE_HOME_ENABLED,
    public: process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED,
    orgs: process.env.HCM_PEOPLE_HOME_ORG_IDS,
  };
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Connected Alpha " + suffix, legalName: "Connected Alpha " + suffix },
    { name: "Connected Beta " + suffix, legalName: "Connected Beta " + suffix },
  ]).returning();
  let userId: number | null = null;
  try {
    const [actor] = await db.insert(users).values({
      email: "connected-" + suffix + "@example.test",
      name: "Synthetic HR", passwordHash: "never-valid", role: "hr",
    }).returning();
    userId = actor.id;
    await db.insert(userOrganizations).values({
      userId: actor.id, organizationId: alpha.id, role: "hr", active: true,
    });
    const [a, b] = await db.insert(employees).values([
      { organizationId: alpha.id, employeeNo: "SAME-" + suffix,
        firstName: "AlphaSynthetic", lastName: "Worker", title: "Staff",
        avatarInitials: "AS", basicRate: "22000", startDate: "2026-10-01" },
      { organizationId: beta.id, employeeNo: "SAME-" + suffix,
        firstName: "BetaSynthetic", lastName: "Worker", title: "Staff",
        avatarInitials: "BS", basicRate: "99000", startDate: "2026-10-01" },
    ]).returning();
    await db.insert(employeePayProfiles).values({
      organizationId: alpha.id, employeeId: a.id,
      payBasis: "monthly", rateAmount: "22000",
      standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
    });
    const [task] = await db.insert(provisioningTasks).values({
      organizationId: alpha.id, employeeId: a.id,
      kind: "onboarding", title: "Synthetic HR checklist", done: false,
    }).returning();
    await db.insert(provisioningTasks).values({
      organizationId: beta.id, employeeId: b.id,
      kind: "onboarding", title: "Foreign HR checklist", done: false,
    });

    process.env.HCM_PEOPLE_HOME_ENABLED = "true";
    process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED = "true";
    process.env.HCM_PEOPLE_HOME_ORG_IDS = [alpha.id, beta.id].join(",");
    const context = { id: actor.id, name: actor.name };
    const home = await loadPeopleHomeWorklist(alpha.id, context);
    assert.equal(home.followUps.state, "ready");
    const item = home.followUps.items.find((x) => x.source === "provisioning");
    assert.ok(item);
    assert.equal(item.subjectEmployeeId, a.id);
    assert.equal(item.sourceUrl,
      "/app?organizationId=" + alpha.id + "&workspacePage=People&focusEmployeeId=" + a.id);
    // Follow the exact generated URL through the real Employee 360 focus
    // resolver using the selected-employer snapshot, not a guessed ID.
    const params = new URL(item.sourceUrl, "https://synthetic.example").searchParams;
    const handoff = {
      requestedPage: params.get("workspacePage"),
      requestedOrganizationId: params.get("organizationId"),
      requestedEmployeeId: params.get("focusEmployeeId"),
      selectedOrganizationId: alpha.id,
      access: { role: "hr", companyWide: true },
      authorizedEmployees: [{ id: a.id }],
      serverAuthorized: true,
      demoMode: false,
    };
    assert.equal(resolvePeopleEmployeeFocus(handoff), a.id);
    assert.equal(resolvePeopleEmployeeFocus({
      ...handoff, selectedOrganizationId: beta.id,
      authorizedEmployees: [{ id: b.id }],
    }), null, "Tenant switch invalidates the old source link");
    assert.equal(resolvePeopleEmployeeFocus({
      ...handoff, authorizedEmployees: [{ id: b.id }],
    }), null, "Outdated/foreign roster cannot activate the worker drawer");
    assert.equal(resolvePeopleEmployeeFocus({
      ...handoff, access: { role: "manager", companyWide: false },
    }), null, "Manager-role downgrade cannot reuse an HR link");
    assert.equal(resolvePeopleEmployeeFocus({
      ...handoff, serverAuthorized: false,
    }), null, "A disabled pilot or explicit permission denial must fail closed");
    assert.ok(!JSON.stringify(home).includes("BetaSynthetic"));
    await assert.rejects(loadPeopleHomeWorklist(beta.id, context), /not authorized/i);

    const before = await loadHirePayrollInputReview(alpha.id, a.id);
    assert.ok(before);
    assert.equal(before.sections.find((s) => s.key === "onboarding")?.state, "needs_review");
    assert.equal(before.sections.find((s) => s.key === "pay_profile")?.state, "recorded");
    assert.equal(before.payrollAuthorized, false);
    assert.equal(await loadHirePayrollInputReview(alpha.id, b.id), null);

    const journey: WorkerJourneyInput = {
      employeeStatus: "Active", asOfDate: "2026-10-11",
      recruitment: null, currentPositionId: null,
      currentPositionEffectiveFrom: null, lastPositionAssignmentId: null,
      onboarding: [{ done: false }], offboarding: [],
      latestPerformance: null, compensationVisible: false,
      latestCompensation: null, payrollVisible: false,
      lastReleasedPayroll: null, separation: null, outstandingAssets: 0,
    };
    assert.equal(buildHcmWorkerJourney(journey).stages.find((s) => s.id === "onboarding")?.state, "in_progress");

    await db.update(provisioningTasks).set({ done: true })
      .where(and(eq(provisioningTasks.organizationId, alpha.id),
        eq(provisioningTasks.employeeId, a.id), eq(provisioningTasks.id, task.id)));
    const complete = await loadHirePayrollInputReview(alpha.id, a.id);
    assert.equal(complete?.sections.find((s) => s.key === "onboarding")?.state, "recorded");
    assert.equal(complete?.payrollAuthorized, false);
    assert.equal(buildHcmWorkerJourney({
      ...journey, onboarding: [{ done: true }],
    }).stages.find((s) => s.id === "onboarding")?.state, "recorded");
    const homeAfter = await loadPeopleHomeWorklist(alpha.id, context);
    assert.ok(!homeAfter.followUps.items.some((x) =>
      x.source === "provisioning" && x.subjectEmployeeId === a.id));
    assert.deepEqual(await db.select({ id: payrollRuns.id }).from(payrollRuns)
      .where(eq(payrollRuns.organizationId, alpha.id)), []);
    assert.equal(complete?.sections.find((s) => s.key === "payroll_approval")?.state, "not_assessed");
    assert.equal(complete?.sections.find((s) => s.key === "attendance")?.state, "not_assessed");
  } finally {
    if (saved.enabled === undefined) delete process.env.HCM_PEOPLE_HOME_ENABLED;
    else process.env.HCM_PEOPLE_HOME_ENABLED = saved.enabled;
    if (saved.public === undefined) delete process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED;
    else process.env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED = saved.public;
    if (saved.orgs === undefined) delete process.env.HCM_PEOPLE_HOME_ORG_IDS;
    else process.env.HCM_PEOPLE_HOME_ORG_IDS = saved.orgs;
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
