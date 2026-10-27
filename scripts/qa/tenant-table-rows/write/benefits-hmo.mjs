/**
 * One NEW uncredited write-row for the independent HMO benefits family.
 * Shared tenant-write runner enforces two authenticated attacker owners and
 * a genuinely persisted higher-ID victim in disposable PG16/localhost HTTP.
 * No provider activation, live employee coverage, payouts or payroll writes.
 */
export function createRows({
  asc, assert, auditBusinessSnapshot, auditEvents,
  benefitDependents, benefitEnrollmentEvents, benefitEnrollments,
  benefitPlans, db, eq,
}) {
  // The shared write helper is source-pinned by the independent multi-entity
  // acceptance receipt. Load HMO-only schema tables here instead of changing
  // that protected helper or manufacturing new receipt evidence.
  const sourceTables = async () => {
    if (benefitDependents && benefitEnrollmentEvents)
      return { dependents: benefitDependents, events: benefitEnrollmentEvents };
    // Executed only by the real PG16 proof (node --import tsx). The pure unit
    // harness injects its own fictional tables and never imports app schema.
    const schema = await import("../../../../src/db/schema.ts");
    assert.ok(schema.benefitDependents?.id && schema.benefitEnrollmentEvents?.id,
      "HMO source tables must exist in the actual application schema");
    return { dependents: schema.benefitDependents, events: schema.benefitEnrollmentEvents };
  };
  // State includes every HMO table and the audit, not just the target plan.
  // The shared runner snapshots it for the genuine higher-ID victim.
  const state = async (orgId) => {
    const { dependents: dependentTable, events: eventTable } = await sourceTables();
    const read = (table) => db.select().from(table)
      .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
    const [plans, enrollments, dependents, events, audit] = await Promise.all([
      read(benefitPlans), read(benefitEnrollments), read(dependentTable),
      read(eventTable), read(auditEvents),
    ]);
    return { plans, enrollments, dependents, events,
      audit: auditBusinessSnapshot(audit) };
  };
  const planBody = (c, organizationId) => ({
    action: "create_plan", organizationId,
    name: c.marker + " separate HMO create-plan proof",
    provider: "Fictional " + c.marker + " HMO",
    planCode: ("TTHMO-" + c.marker).slice(0, 48),
    contractNumber: ("FICTIONAL-" + c.marker).slice(0, 80),
    employeeShare: 100 + c.rank,
    employerShare: 200 + c.rank,
    dependentShare: 30 + c.rank,
    employerPaidDependents: 1, waitingPeriodDays: 14,
    annualBenefitLimit: 10000 + c.rank,
    coverageDetails: { source: "disposable-tenant-table", ownerMarker: c.marker },
  });

  return [
    {
      key: "POST benefits/hmo",
      status: 201,
      seed: async (e) => {
        const { dependents } = await sourceTables();
        const [plan] = await db.insert(benefitPlans).values({
          organizationId: e.org.id, category: "hmo",
          name: e.marker + " existing private HMO plan",
          provider: "Fictional plan provider",
          employeeShare: "45.00", employerShare: "70.00",
          dependentShare: "25.00", employerPaidDependents: 0,
        }).returning();
        const [enrollment] = await db.insert(benefitEnrollments).values({
          organizationId: e.org.id,
          employeeId: e.worker.id, planId: plan.id,
          monthlyContribution: "45.00", status: "active",
          providerStatus: "not_sent", startedOn: "2026-01-05",
        }).returning();
        const [dependent] = await db.insert(dependents).values({
          organizationId: e.org.id, enrollmentId: enrollment.id,
          employeeId: e.worker.id, name: e.marker + " fictional child",
          relationship: "child", birthDate: "2017-06-01",
          status: "pending", monthlyContribution: "25.00",
        }).returning();
        for (const row of [plan, enrollment, dependent]) {
          assert.ok(Number.isSafeInteger(row.id) && row.id > 0,
            "HMO fixture IDs must come from actual INSERT RETURNING");
          assert.equal(row.organizationId, e.org.id);
        }
        assert.equal(enrollment.employeeId, e.worker.id);
        assert.equal(enrollment.planId, plan.id);
        assert.equal(dependent.employeeId, e.worker.id);
        assert.equal(dependent.enrollmentId, enrollment.id);
        return { id: plan.id, enrollmentId: enrollment.id,
          dependentId: dependent.id, workerId: e.worker.id };
      },
      state,
      ownBody: (c) => planBody(c, c.orgId),
      foreignBody: (c) => planBody(c, c.victim.org.id),
      forged: {
        status: 404,
        body: (c) => ({
          action: "add_dependent", organizationId: c.orgId,
          // The victim's existing enrollment is a real higher-ID database row.
          enrollmentId: c.victimSeeded.enrollmentId,
          name: c.marker + " forbidden foreign dependent",
          relationship: "child", birthDate: "2017-06-01",
        }),
      },
      expect: (before, after, c, response) => {
        for (const field of ["enrollments", "dependents", "events"]) {
          assert.deepEqual(after[field], before[field],
            "creating an HMO plan cannot change existing " + field);
        }
        assert.equal(after.plans.length, before.plans.length + 1);
        assert.deepEqual(after.plans.slice(0, -1), before.plans,
          "old employer benefit plans must remain unchanged");
        const plan = after.plans.at(-1);
        const requested = planBody(c, c.orgId);
        assert.ok(plan.id > c.seeded.id && Number.isSafeInteger(plan.id),
          "new HMO plan must have a real later ID");
        assert.equal(plan.organizationId, c.orgId);
        assert.equal(plan.category, "hmo");
        assert.equal(plan.name, requested.name);
        assert.equal(plan.provider, requested.provider);
        assert.equal(plan.planCode, requested.planCode);
        assert.equal(plan.contractNumber, requested.contractNumber);
        assert.equal(plan.employeeShare, Number(requested.employeeShare).toFixed(2));
        assert.equal(plan.employerShare, Number(requested.employerShare).toFixed(2));
        assert.equal(plan.dependentShare, Number(requested.dependentShare).toFixed(2));
        assert.equal(plan.employerPaidDependents, 1);
        assert.equal(plan.waitingPeriodDays, 14);
        assert.equal(plan.annualBenefitLimit, Number(requested.annualBenefitLimit).toFixed(2));
        assert.deepEqual(plan.coverageDetails, requested.coverageDetails);
        assert.equal(after.audit.length, before.audit.length + 1,
          "one authenticated own-company creation must create exactly one audit");
        assert.deepEqual(after.audit.slice(0, -1), before.audit);
        const audit = after.audit.at(-1);
        assert.equal(audit.organizationId, c.orgId);
        assert.equal(audit.actor, c.owner.name);
        assert.equal(audit.action, "HMO plan created");
        assert.equal(audit.resource, plan.name);
        assert.deepEqual(audit.metadata, { planId: plan.id, provider: plan.provider });
        const body = response.json;
        assert.ok(body && typeof body === "object");
        assert.equal(body.id, plan.id, "HTTP response must match actual committed plan");
        assert.equal(body.organizationId, c.orgId);
        assert.equal(body.name, plan.name);
        assert.equal(body.provider, plan.provider);
        assert.equal(body.category, "hmo");
        assert.ok(!response.text.includes(c.victim.marker),
          "response cannot contain the victim's existing plan/dependent");
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/benefits/hmo";
        const ownBefore = await state(c.orgId);
        const victimBefore = await state(c.victim.org.id);
        const attempts = [
          { action: "update_dependent",
            organizationId: c.orgId, dependentId: c.victimSeeded.dependentId,
            status: "active", providerMemberId: "FORGED-FOREIGN" },
          { action: "update_enrollment",
            organizationId: c.orgId, enrollmentId: c.victimSeeded.enrollmentId,
            status: "ended", providerStatus: "confirmed" },
        ];
        for (const body of attempts) {
          const rejected = expectStatus(await request(url, {
            method: "POST", cookie, body,
          }), 404, "own employer + real victim HMO row ID must be denied");
          assert.ok(!rejected.text.includes(c.victim.marker),
            "foreign enrollment and dependent details must remain private");
          assert.deepEqual(await state(c.orgId), ownBefore,
            "forged HMO actions must not mutate the attacker's plans or audit");
          assert.deepEqual(await state(c.victim.org.id), victimBefore,
            "forged HMO actions must not mutate the real victim");
        }

        // Independent real HTTP GET readback (already covered separately):
        // it must show both actual own-company plan IDs and the seeded
        // enrollment/dependent, but neither victim nor other company data.
        const ownGet = expectStatus(await request(
          url + "?organizationId=" + c.orgId, { method: "GET", cookie },
        ), 200, "signed-in owner HMO readback");
        const payload = ownGet.json;
        assert.ok(payload && typeof payload === "object");
        const plans = payload.plans ?? [];
        assert.ok(Array.isArray(plans) && plans.length === ownBefore.plans.filter(p => p.category === "hmo").length,
          "the HMO readback must filter unrelated benefit-plan categories");
        assert.ok(plans.some((p) => p.id === c.seeded.id));
        assert.ok(plans.some((p) => p.name === planBody(c, c.orgId).name));
        assert.ok(Array.isArray(payload.enrollments));
        assert.ok(payload.enrollments.some((row) =>
          row.id === c.seeded.enrollmentId && row.employeeId === c.workerId &&
          row.dependents.some((d) => d.id === c.seeded.dependentId)));
        assert.ok(!ownGet.text.includes(c.victim.marker),
          "own GET cannot include the victim's HMO identity");
        assert.deepEqual(await state(c.orgId), ownBefore,
          "authorized HMO GET readback must not change HMO source rows");
        assert.deepEqual(await state(c.victim.org.id), victimBefore,
          "authorized HMO GET readback must leave victim unchanged");
        return { forgedAdditionalIdsDenied: attempts.length,
          ownHmoReadback: true, victimHmoUntouched: true,
          providerOrMoneyMovement: false };
      },
    },
  ];
}
