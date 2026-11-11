import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { employeePayProfiles, employees, legalEntities, organizations, provisioningTasks } from "../src/db/schema";
import { loadHirePayrollInputReview } from "../src/lib/hcm-hire-payroll-review-server";

// Synthetic employer records only. The protected page's custom-deny/role gate
// is tested separately; this test verifies underlying SQL tenant isolation.
test("hire-to-payroll source review excludes foreign worker and private values", async () => {
  const suffix = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Review Alpha " + suffix, legalName: "Review Alpha " + suffix },
    { name: "Review Beta " + suffix, legalName: "Review Beta " + suffix },
  ]).returning();
  try {
    const [a, b] = await db.insert(employees).values([
      {
        organizationId: alpha.id, employeeNo: "SAME-" + suffix,
        firstName: "AlphaSynthetic", lastName: "Worker", title: "Staff",
        avatarInitials: "AW", basicRate: "23000", startDate: "2026-10-01",
        bankAccount: "fake-secret-A", bankCode: "BDO",
        tin: "fake-TIN-A", tinBranchCode: "001", sssNo: "fake-SSS-A",
        philHealthNo: "fake-PH-A", pagIbigNo: "fake-PAG-A", restDay: "Sunday",
      },
      {
        organizationId: beta.id, employeeNo: "SAME-" + suffix,
        firstName: "BetaSynthetic", lastName: "Worker", title: "Staff",
        avatarInitials: "BW", basicRate: "94000", startDate: "2026-10-01",
      },
    ]).returning();
    await db.insert(employeePayProfiles).values({
      organizationId: alpha.id, employeeId: a.id, payBasis: "monthly",
      rateAmount: "23000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
    });
    await db.insert(provisioningTasks).values([
      { organizationId: alpha.id, employeeId: a.id, kind: "onboarding",
        title: "Alpha synthetic checklist", done: true },
      { organizationId: beta.id, employeeId: b.id, kind: "onboarding",
        title: "Beta synthetic checklist", done: false },
    ]);
    // Two actual legal employers inside the SAME parent organization.
    // A selected grant for legal employer A must not read B's worker, even
    // though both workers share organizationId=alpha.id.
    const [legalA, legalB] = await db.insert(legalEntities).values([
      { organizationId: alpha.id, code: "A-" + suffix,
        legalName: "Alpha Legal A " + suffix, displayName: "Legal A" },
      { organizationId: alpha.id, code: "B-" + suffix,
        legalName: "Alpha Legal B " + suffix, displayName: "Legal B" },
    ]).returning();
    await db.update(employees).set({ legalEntityId: legalA.id })
      .where(and(eq(employees.organizationId, alpha.id), eq(employees.id, a.id)));
    const [sameParentPeer] = await db.insert(employees).values({
      organizationId: alpha.id, legalEntityId: legalB.id,
      employeeNo: "PEER-" + suffix, firstName: "PeerSynthetic",
      lastName: "Worker", title: "Staff", avatarInitials: "PW",
      basicRate: "23000", startDate: "2026-10-01",
    }).returning();
    const scopedA = await loadHirePayrollInputReview(alpha.id, a.id, legalA.id);
    assert.ok(scopedA, "Current granted worker A must remain readable");
    assert.equal(await loadHirePayrollInputReview(alpha.id, a.id, legalB.id), null,
      "Wrong legal-employer scope must hide otherwise valid worker A");
    assert.equal(await loadHirePayrollInputReview(alpha.id, sameParentPeer.id, legalA.id), null,
      "Another real legal employer under the SAME organization must not be readable");
    assert.ok(await loadHirePayrollInputReview(alpha.id, sameParentPeer.id, legalB.id),
      "Legitimately selected legal employer B must see its own peer worker");
    assert.equal(await loadHirePayrollInputReview(alpha.id, b.id, legalA.id), null,
      "Cross-parent foreign worker must still fail");

    const first = await loadHirePayrollInputReview(alpha.id, a.id);
    assert.ok(first);
    assert.equal(first.sections.find((s) => s.key === "onboarding")?.state, "recorded");
    assert.equal(first.sections.find((s) => s.key === "pay_profile")?.state, "recorded");
    assert.equal(first.sections.find((s) => s.key === "government_ids")?.state, "recorded");
    assert.equal(first.sections.find((s) => s.key === "payout")?.state, "recorded");
    assert.equal(first.payrollAuthorized, false);
    for (const value of ["AlphaSynthetic", "BetaSynthetic", "fake-secret-A",
      "fake-TIN-A", "23000", "94000", "Alpha synthetic checklist"]) {
      assert.ok(!JSON.stringify(first).includes(value), "Raw source values are not response data");
    }
    assert.equal(await loadHirePayrollInputReview(alpha.id, b.id), null);
    assert.equal(await loadHirePayrollInputReview(beta.id, a.id), null);
    assert.equal(await loadHirePayrollInputReview(0, a.id), null);
    const other = await loadHirePayrollInputReview(beta.id, b.id);
    assert.ok(other);
    assert.equal(other.sections.find((s) => s.key === "onboarding")?.state, "needs_review");
    assert.equal(other.sections.find((s) => s.key === "pay_profile")?.state, "needs_review");
    assert.equal(other.sections.find((s) => s.key === "payout")?.state, "needs_review");
    assert.equal(other.payrollAuthorized, false);

    await db.insert(provisioningTasks).values(Array.from({ length: 27 }, (_, i) => ({
      organizationId: alpha.id, employeeId: a.id, kind: "onboarding",
      title: "Overflow-" + i, done: true,
    })));
    const overflow = await loadHirePayrollInputReview(alpha.id, a.id);
    assert.equal(overflow?.onboardingPreviewHasMore, true);
    assert.equal(overflow?.sections.find((s) => s.key === "onboarding")?.state, "partial");
    await db.update(employees).set({ status: "Separating", bankCode: null })
      .where(and(eq(employees.organizationId, alpha.id), eq(employees.id, a.id)));
    const changed = await loadHirePayrollInputReview(alpha.id, a.id);
    assert.equal(changed?.sections.find((s) => s.key === "employment")?.state, "needs_review");
    assert.equal(changed?.sections.find((s) => s.key === "payout")?.state, "needs_review");
    assert.equal(changed?.payrollAuthorized, false);
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [alpha.id, beta.id]));
  }
});
