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

        // These three positive cases are real authenticated HTTP mutations, not
        // fixture inserts. Every response is reconciled to committed HMO rows,
        // the exact signed-in actor, one event and one audit receipt.
        const snapshot = async (orgId) => JSON.parse(JSON.stringify(await state(orgId)));
        const victimBaseline = await snapshot(c.victim.org.id);
        const workerName = c.worker.firstName + " " + c.worker.lastName;
        const checkReceipt = (before, after, eventType, status, eventMetadata, action, auditMetadata, enrollmentId) => {
          assert.equal(after.events.length, before.events.length + 1,
            "each own HMO action must append exactly one durable enrollment event");
          assert.deepEqual(after.events.slice(0, -1), before.events);
          const event = after.events.at(-1);
          assert.ok(Number.isSafeInteger(event.id) && event.id > 0);
          assert.equal(event.organizationId, c.orgId);
          assert.equal(event.enrollmentId, enrollmentId);
          assert.equal(event.employeeId, c.workerId);
          assert.equal(event.eventType, eventType);
          assert.equal(event.status, status);
          assert.equal(event.actor, c.owner.name);
          assert.deepEqual(event.metadata, eventMetadata);
          assert.equal(after.audit.length, before.audit.length + 1,
            "each own HMO action must append exactly one own audit receipt");
          assert.deepEqual(after.audit.slice(0, -1), before.audit);
          const audit = after.audit.at(-1);
          assert.equal(audit.organizationId, c.orgId);
          assert.equal(audit.actor, c.owner.name);
          assert.equal(audit.action, action);
          assert.equal(audit.resource, workerName);
          assert.deepEqual(audit.metadata, auditMetadata);
        };
        const verifyVictim = async () => assert.deepEqual(
          await snapshot(c.victim.org.id), victimBaseline,
          "legitimate HMO actions must never mutate the higher-ID victim");

        const addBefore = await snapshot(c.orgId);
        const seedPlan = addBefore.plans.find(plan => plan.id === c.seeded.id);
        assert.ok(seedPlan && seedPlan.category === "hmo");
        assert.equal(seedPlan.employerPaidDependents, 0,
          "additional dependent pricing is based on the real seeded own plan");
        const dependentName = c.marker + " additional fictional child";
        const addedReply = expectStatus(await request(url, {
          method: "POST", cookie, body: {
            action: "add_dependent", organizationId: c.orgId,
            enrollmentId: c.seeded.enrollmentId,
            name: dependentName, relationship: "child", birthDate: "2018-04-16",
          },
        }), 201, "own HMO dependent creation must persist");
        const addAfter = await snapshot(c.orgId);
        assert.deepEqual(addAfter.plans, addBefore.plans);
        assert.deepEqual(addAfter.enrollments, addBefore.enrollments);
        assert.equal(addAfter.dependents.length, addBefore.dependents.length + 1,
          "successful own add_dependent must commit exactly one real dependent row");
        assert.deepEqual(addAfter.dependents.slice(0, -1), addBefore.dependents);
        const added = addAfter.dependents.at(-1);
        assert.ok(Number.isSafeInteger(added.id) && added.id > c.seeded.dependentId);
        assert.equal(added.organizationId, c.orgId);
        assert.equal(added.employeeId, c.workerId);
        assert.equal(added.enrollmentId, c.seeded.enrollmentId);
        assert.equal(added.name, dependentName);
        assert.equal(added.relationship, "child");
        assert.equal(added.birthDate, "2018-04-16");
        assert.equal(added.status, "pending");
        assert.equal(added.monthlyContribution, seedPlan.dependentShare);
        assert.deepEqual(addedReply.json, added,
          "dependent response must equal the actual PostgreSQL INSERT row");
        assert.ok(!addedReply.text.includes(c.victim.marker));
        checkReceipt(addBefore, addAfter, "dependent_added", "pending",
          { dependentId: added.id, relationship: "child",
            monthlyContribution: Number(seedPlan.dependentShare) },
          "HMO dependent added",
          { enrollmentId: c.seeded.enrollmentId, dependentId: added.id, relationship: "child" },
          c.seeded.enrollmentId);
        await verifyVictim();

        const updateDependentBefore = await snapshot(c.orgId);
        const memberId = ("FICTIONAL-" + c.marker).slice(0, 80);
        const updatedDependentReply = expectStatus(await request(url, {
          method: "POST", cookie, body: {
            action: "update_dependent", organizationId: c.orgId,
            dependentId: added.id, status: "active", providerMemberId: memberId,
          },
        }), 200, "own HMO dependent status update must persist");
        const updateDependentAfter = await snapshot(c.orgId);
        assert.deepEqual(updateDependentAfter.plans, updateDependentBefore.plans);
        assert.deepEqual(updateDependentAfter.enrollments, updateDependentBefore.enrollments);
        assert.equal(updateDependentAfter.dependents.length, updateDependentBefore.dependents.length);
        const changedDependent = updateDependentAfter.dependents.find(row => row.id === added.id);
        const originalDependent = updateDependentBefore.dependents.find(row => row.id === added.id);
        assert.ok(changedDependent && originalDependent);
        assert.deepEqual(updateDependentAfter.dependents.filter(row => row.id !== added.id),
          updateDependentBefore.dependents.filter(row => row.id !== added.id));
        assert.equal(changedDependent.status, "active");
        assert.equal(changedDependent.providerMemberId, memberId);
        assert.ok(Number.isFinite(Date.parse(changedDependent.updatedAt)),
          "dependent update must have a committed timestamp");
        assert.deepEqual({ ...changedDependent, status: originalDependent.status,
          providerMemberId: originalDependent.providerMemberId, updatedAt: originalDependent.updatedAt },
        originalDependent, "other dependent fields cannot change");
        assert.deepEqual(updatedDependentReply.json, changedDependent);
        assert.ok(!updatedDependentReply.text.includes(c.victim.marker));
        checkReceipt(updateDependentBefore, updateDependentAfter, "dependent_updated", "active",
          { dependentId: added.id, relationship: "child" },
          "HMO dependent updated",
          { dependentId: added.id, enrollmentId: c.seeded.enrollmentId, status: "active" },
          c.seeded.enrollmentId);
        await verifyVictim();

        // Updating the provider's locally recorded state tests the legitimate
        // branch without claiming actual provider confirmation or triggering
        // coverage activation or automated side effects.
        const updateEnrollmentBefore = await snapshot(c.orgId);
        const enrollmentMemberId = ("FICTIONAL-ENROLL-" + c.marker).slice(0, 80);
        const updatedEnrollmentReply = expectStatus(await request(url, {
          method: "POST", cookie, body: {
            action: "update_enrollment", organizationId: c.orgId,
            enrollmentId: c.seeded.enrollmentId, status: "active",
            providerStatus: "pending_provider",
            providerMemberId: enrollmentMemberId, effectiveOn: "2026-06-01",
          },
        }), 200, "own HMO enrollment provider-state update must persist");
        const updateEnrollmentAfter = await snapshot(c.orgId);
        assert.deepEqual(updateEnrollmentAfter.plans, updateEnrollmentBefore.plans);
        assert.deepEqual(updateEnrollmentAfter.dependents, updateEnrollmentBefore.dependents);
        assert.equal(updateEnrollmentAfter.enrollments.length, updateEnrollmentBefore.enrollments.length);
        const changedEnrollment = updateEnrollmentAfter.enrollments.find(
          row => row.id === c.seeded.enrollmentId);
        const originalEnrollment = updateEnrollmentBefore.enrollments.find(
          row => row.id === c.seeded.enrollmentId);
        assert.ok(changedEnrollment && originalEnrollment);
        assert.deepEqual(updateEnrollmentAfter.enrollments.filter(row => row.id !== c.seeded.enrollmentId),
          updateEnrollmentBefore.enrollments.filter(row => row.id !== c.seeded.enrollmentId));
        assert.equal(changedEnrollment.organizationId, c.orgId);
        assert.equal(changedEnrollment.employeeId, c.workerId);
        assert.equal(changedEnrollment.planId, c.seeded.id);
        assert.equal(changedEnrollment.status, "active");
        assert.equal(changedEnrollment.providerStatus, "pending_provider");
        assert.equal(changedEnrollment.providerMemberId, enrollmentMemberId);
        assert.equal(changedEnrollment.effectiveOn, "2026-06-01");
        assert.deepEqual({ ...changedEnrollment,
          providerStatus: originalEnrollment.providerStatus,
          providerMemberId: originalEnrollment.providerMemberId,
          effectiveOn: originalEnrollment.effectiveOn },
        originalEnrollment, "other enrollment fields cannot change");
        assert.deepEqual(updatedEnrollmentReply.json, changedEnrollment);
        assert.ok(!updatedEnrollmentReply.text.includes(c.victim.marker));
        checkReceipt(updateEnrollmentBefore, updateEnrollmentAfter,
          "enrollment_updated", "active",
          { providerStatus: "pending_provider", providerMemberId: enrollmentMemberId,
            effectiveOn: "2026-06-01" },
          "HMO enrollment updated",
          { enrollmentId: c.seeded.enrollmentId, status: "active",
            providerStatus: "pending_provider", eventType: "enrollment_updated" },
          c.seeded.enrollmentId);
        await verifyVictim();

        // The final GET must reflect the exact committed own records, not a
        // successful write response that never became visible to the owner.
        const finalBefore = await snapshot(c.orgId);
        const finalGet = expectStatus(await request(
          url + "?organizationId=" + c.orgId, { method: "GET", cookie },
        ), 200, "HMO dashboard readback after all three own mutations");
        assert.ok(finalGet.json?.enrollments?.some(enrollment =>
          enrollment.id === c.seeded.enrollmentId
          && enrollment.providerStatus === "pending_provider"
          && enrollment.providerMemberId === enrollmentMemberId
          && enrollment.dependents?.some(dependent =>
            dependent.id === added.id && dependent.status === "active"
            && dependent.providerMemberId === memberId)));
        assert.ok(!finalGet.text.includes(c.victim.marker));
        assert.deepEqual(await snapshot(c.orgId), finalBefore,
          "post-action HMO GET must not change company source state");
        await verifyVictim();

        return { forgedAdditionalIdsDenied: attempts.length,
          ownHmoReadback: true, legitimateHmoActions: [
            "add_dependent", "update_dependent", "update_enrollment",
          ], victimHmoUntouched: true, providerOrMoneyMovement: false };
      },
    },
  ];
}
