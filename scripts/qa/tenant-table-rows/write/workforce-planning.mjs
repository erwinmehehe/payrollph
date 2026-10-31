/**
 * Workforce planning writes on fictional employers only: position transfer (transfer, promotion, lateral), forecast revision
 * from a published baseline, and scenario submission for approval. POST scenarios is deliberately not here: it accepts another
 * employer's org unit as its scope (see the PR description), so its proof cannot pass until the route validates ownership. The shared write runner adds
 * two attackers, the victim denial, a discrimination check and an unchanged victim. Nothing here touches payroll, schedules,
 * providers or money, and no approval is decided.
 */
import { createHash } from "node:crypto";

export const fixtureOrder = {};

export function createRows(deps) {
  const { addWorker, assert, asc, auditBusinessSnapshot, auditEvents, db, employees, eq, jobProfiles, approvalChainPolicies } = deps;
  // The shared runner's dependency list is bound by reviewed receipts, so tables it does not pass come from the schema.
  let schema;
  const s = async () => (schema ??= await import("../../../../src/db/schema.ts"));
  const hex = (text) => createHash("sha256").update(text).digest("hex");
  const todayPh = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const plan = async (e, purpose) => (await db.insert((await s()).workforcePlans).values({ organizationId: e.org.id, name: e.marker + " " + purpose,
    startDate: "2026-01-01", endDate: "2026-12-31" }).returning())[0];
  const oneAudit = (before, after, c, action) => {
    assert.equal(after.audit.length, before.audit.length + 1, "exactly one audit receipt: " + action);
    assert.deepEqual(after.audit.slice(0, -1), before.audit, "earlier audit rows are unchanged");
    const audit = after.audit.at(-1);
    assert.equal(audit.organizationId, c.orgId); assert.equal(audit.actor, c.owner.name); assert.equal(audit.action, action);
    return audit;
  };
  const added = (before, after, c, label) => {
    const rows = after.filter((row) => !before.some((old) => old.id === row.id));
    assert.equal(rows.length, 1, "exactly one " + label + " is created");
    assert.equal(rows[0].organizationId, c.orgId);
    assert.deepEqual(after.filter((row) => row.id !== rows[0].id), before, "other " + label + " rows are untouched");
    return rows[0];
  };

  // ---- transfer -------------------------------------------------------------------------------------------------------
  const transferState = async (orgId) => { const t = await s(); return plain({ positions: await read(t.positions, orgId), assignments: await read(t.positionAssignments, orgId),
    workers: await read(employees, orgId), events: await read(t.workerEmploymentEvents, orgId), audit: auditBusinessSnapshot(await read(auditEvents, orgId)) }); };
  const seedMover = async (e, tag) => {
    const t = await s();
    const worker = await addWorker(e, tag);
    const [profile] = await db.insert(jobProfiles).values({ organizationId: e.org.id, title: e.marker + " " + tag + " profile" }).returning();
    const make = async (suffix, status) => (await db.insert(t.positions).values({ organizationId: e.org.id, code: (tag + suffix + "-" + e.marker).slice(-46), jobProfileId: profile.id,
      orgUnitId: e.unit.id, legalEntityId: e.entity.id, employmentType: "Regular", status, annualBudget: "0" }).returning())[0];
    const from = await make("F", "filled"), to = await make("T", "open");
    const [assignment] = await db.insert(t.positionAssignments).values({ organizationId: e.org.id, positionId: from.id, employeeId: worker.id,
      assignmentType: "primary", fte: "1.0000", effectiveFrom: "2026-01-05", reason: "fixture" }).returning();
    return { employeeId: worker.id, fromId: from.id, toId: to.id, assignmentId: assignment.id };
  };
  const transferBody = (organizationId, target, movementType) => ({ organizationId, employeeId: target.employeeId, targetPositionId: target.toId,
    effectiveFrom: todayPh(), reason: "Fictional " + movementType + " proof", movementType });
  const verifyTransfer = (before, after, c, target, movementType, response) => {
    assert.equal(after.assignments.length, before.assignments.length + 1, movementType + ": one new assignment");
    const closed = after.assignments.find((a) => a.id === target.assignmentId), opened = after.assignments.find((a) => a.positionId === target.toId);
    assert.ok(closed && opened);
    assert.equal(closed.organizationId, c.orgId); assert.notEqual(closed.effectiveUntil, null, movementType + ": the old assignment is closed");
    assert.equal(opened.organizationId, c.orgId); assert.equal(opened.employeeId, target.employeeId); assert.equal(opened.effectiveUntil, null);
    assert.equal(opened.createdByUserId, c.owner.id);
    assert.equal(after.positions.find((p) => p.id === target.fromId).status, "open", movementType + ": the vacated position reopens");
    assert.equal(after.positions.find((p) => p.id === target.toId).status, "filled", movementType + ": the target position fills");
    assert.equal(after.events.length, before.events.length + 1);
    const event = after.events.at(-1);
    assert.equal(event.organizationId, c.orgId); assert.equal(event.eventType, movementType); assert.equal(event.employeeId, target.employeeId);
    assert.equal(event.fromPositionId, target.fromId); assert.equal(event.toPositionId, target.toId); assert.equal(event.actorUserId, c.owner.id);
    assert.equal(response.json?.assignment?.id, opened.id); assert.equal(response.json?.movementType, movementType);
    const unmoved = (rows) => rows.filter((row) => ![target.fromId, target.toId, target.employeeId].includes(row.id));
    assert.deepEqual(unmoved(after.workers), unmoved(before.workers), movementType + ": no other worker changes");
    oneAudit(before, after, c, "Employee transferred between positions");
  };

  // ---- scenarios ------------------------------------------------------------------------------------------------------
  const scenarioState = async (orgId) => { const t = await s(); return plain({ scenarios: await read(t.workforcePlanningScenarios, orgId), plans: await read(t.workforcePlans, orgId),
    instances: await read(t.approvalChainInstances, orgId), tasks: await read(t.approvalTasks, orgId), steps: await read(t.approvalChainInstanceSteps, orgId),
    audit: auditBusinessSnapshot(await read(auditEvents, orgId)) }); };
  const draftSnapshot = (e) => ({ version: "wfm-staffing-scenario-v3", forecast: { summary: { annualRunRateLaborCost: 600000, annualizedBasePayroll: 0,
    currentPeriodStatutoryEmployerCost: 0, currentPeriodBenefitEmployerCost: 0, currentPeriodRecurringCompensationCost: 0 }, assumptions: { windowDays: 30 } },
  scope: { orgUnitId: null }, assumptions: {}, linkedPlan: null, boundary: "fictional " + e.marker });

  return [
    { key: "POST workforce-planning/transfer", status: 201,
      seed: async (e) => {
        const base = await seedMover(e, "XFER");
        return { ...base, id: base.employeeId, extras: { promotion: await seedMover(e, "PROMO"), lateral: await seedMover(e, "LATRL") } };
      },
      state: transferState,
      ownBody: (c) => transferBody(c.orgId, c.seeded, "transfer"),
      foreignBody: (c) => transferBody(c.victim.org.id, c.victimSeeded, "transfer"),
      forged: { status: 404, body: (c) => ({ ...transferBody(c.orgId, c.seeded, "transfer"), targetPositionId: c.victimSeeded.toId }) },
      expect: (before, after, c, response) => {
        verifyTransfer(before, after, c, c.seeded, "transfer", response);
        for (const key of ["promotion", "lateral"]) assert.deepEqual(after.positions.find((p) => p.id === c.seeded.extras[key].toId),
          before.positions.find((p) => p.id === c.seeded.extras[key].toId), key + " fixtures are untouched by the transfer");
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce-planning/transfer";
        const victimBefore = await transferState(c.victim.org.id);
        const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
        const refused = async (body, status, label) => {
          const own = await transferState(c.orgId); const response = await post(body, status, label);
          assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
          assert.deepEqual(await transferState(c.orgId), own, label + ": writes nothing in the own employer");
          assert.deepEqual(await transferState(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
        };
        for (const kind of ["promotion", "lateral"]) {
          const target = c.seeded.extras[kind], victimTarget = c.victimSeeded.extras[kind];
          await refused({ ...transferBody(c.orgId, target, kind), employeeId: victimTarget.employeeId }, 404, "forged victim worker " + kind);
          await refused({ ...transferBody(c.orgId, target, kind), targetPositionId: victimTarget.toId }, 404, "forged victim target position " + kind);
          await refused(transferBody(c.victim.org.id, victimTarget, kind), 403, "victim employer " + kind);
          const before = await transferState(c.orgId);
          const response = await post(transferBody(c.orgId, target, kind), 201, "own " + kind);
          verifyTransfer(before, await transferState(c.orgId), c, target, kind, response);
        }
        await refused({ ...transferBody(c.orgId, c.seeded.extras.promotion, "transfer"), effectiveFrom: "2099-01-01" }, 409, "future-dated transfer");
        return { actions: ["transfer", "promotion", "lateral"], forgedReferences: 4, victimEmployerDenials: 2 };
      } },

    { key: "POST workforce-planning/forecast-plan", status: 201,
      seed: async (e) => {
        const t = await s();
        const p = await plan(e, "forecast plan");
        const { summarizeHeadcountPlan } = await import("../../../../src/lib/workforce-plan-baseline.ts");
        const headcount = summarizeHeadcountPlan({ planId: p.id, asOf: "2026-01-01", scopeOrgUnitId: null, positions: [], assignments: [] });
        const [scenario] = await db.insert(t.workforcePlanningScenarios).values({ organizationId: e.org.id, planId: p.id, name: e.marker + " published scenario",
          startDate: "2026-01-01", endDate: "2026-12-31", snapshotHash: hex(e.marker + "scenario"), createdByUserId: e.owner.id }).returning();
        const [baseline] = await db.insert(t.workforcePlanBaselines).values({ organizationId: e.org.id, planId: p.id, scenarioId: scenario.id,
          snapshot: { headcount, scenario: { demandGrowthPercent: 0, vacancyFillPercent: 100 } }, snapshotHash: hex(e.marker + "baseline"),
          publishedByUserId: e.owner.id, publishedBy: e.owner.name }).returning();
        return { id: p.id, baselineId: baseline.id };
      },
      state: async (orgId) => { const t = await s(); return plain({ scenarios: await read(t.workforcePlanningScenarios, orgId), baselines: await read(t.workforcePlanBaselines, orgId),
        plans: await read(t.workforcePlans, orgId), audit: auditBusinessSnapshot(await read(auditEvents, orgId)) }); },
      ownBody: (c) => ({ organizationId: c.orgId, planId: c.seeded.id, startDate: "2026-01-01", endDate: "2026-03-31", name: c.marker + " forecast revision" }),
      foreignBody: (c) => ({ organizationId: c.victim.org.id, planId: c.victimSeeded.id, startDate: "2026-01-01", endDate: "2026-03-31", name: c.marker + " forecast revision" }),
      forged: { status: 404, body: (c) => ({ organizationId: c.orgId, planId: c.victimSeeded.id, startDate: "2026-01-01", endDate: "2026-03-31", name: c.marker + " forecast revision" }) },
      expect: (before, after, c, response) => {
        const row = added(before.scenarios, after.scenarios, c, "forecast revision");
        assert.equal(row.planId, c.seeded.id); assert.equal(row.name, c.marker + " forecast revision"); assert.equal(row.version, 1);
        assert.equal(row.status, "draft"); assert.equal(row.createdByUserId, c.owner.id); assert.equal(row.scopeOrgUnitId, null);
        assert.equal(row.snapshot.planningSeed.baselineId, c.seeded.baselineId, "the revision is seeded from the own published baseline");
        assert.equal(row.snapshot.linkedPlan.id, c.seeded.id); assert.match(row.snapshotHash, /^[a-f0-9]{64}$/);
        assert.deepEqual(after.baselines, before.baselines, "the baseline is only read"); assert.deepEqual(after.plans, before.plans);
        assert.equal(response.json?.scenario?.id, row.id); assert.equal(response.json?.seed?.baselineId, c.seeded.baselineId);
        assert.equal(oneAudit(before, after, c, "Workforce forecast revision created").resource, row.name + " v1");
      } },

    { key: "PATCH workforce-planning/scenarios",
      seed: async (e) => {
        const t = await s();
        const p = await plan(e, "submission plan");
        await db.insert(approvalChainPolicies).values({ organizationId: e.org.id, code: ("wfp-" + e.marker).toLowerCase().slice(0, 48), name: e.marker + " plan approval", purpose: "workforce_plan",
          active: true, version: 1, steps: [{ label: "Fictional plan review", approver: e.owner.name }] });
        const make = async (name, planId) => (await db.insert(t.workforcePlanningScenarios).values({ organizationId: e.org.id, planId, name: e.marker + " " + name, status: "draft",
          startDate: "2026-01-01", endDate: "2026-12-31", snapshot: draftSnapshot(e), snapshotHash: hex(e.marker + name), createdByUserId: e.owner.id }).returning())[0];
        const main = await make("submit", p.id), unlinked = await make("unlinked", null);
        return { id: main.id, planId: p.id, unlinkedId: unlinked.id };
      },
      state: scenarioState,
      ownBody: (c) => ({ scenarioId: c.seeded.id, action: "submit" }),
      foreignBody: (c) => ({ scenarioId: c.victimSeeded.id, action: "submit" }),
      expect: (before, after, c, response) => {
        const row = after.scenarios.find((s2) => s2.id === c.seeded.id), old = before.scenarios.find((s2) => s2.id === c.seeded.id);
        assert.equal(old.status, "draft"); assert.equal(row.status, "submitted"); assert.equal(row.organizationId, c.orgId); assert.equal(row.submittedByUserId, c.owner.id);
        assert.deepEqual(after.scenarios.filter((s2) => s2.id !== row.id), before.scenarios.filter((s2) => s2.id !== row.id), "only the submitted scenario changes");
        const instance = added(before.instances, after.instances, c, "approval instance");
        assert.equal(instance.sourceType, "workforce_plan_scenario"); assert.equal(instance.sourceKey, String(row.id)); assert.equal(instance.status, "pending");
        const task = added(before.tasks, after.tasks, c, "approval task"); assert.equal(task.approvalChainInstanceId, instance.id);
        const step = added(before.steps, after.steps, c, "approval step"); assert.equal(step.instanceId, instance.id); assert.equal(step.approvalTaskId, task.id);
        assert.equal(after.plans.find((p) => p.id === c.seeded.planId).status, "submitted", "the whole-plan scenario moves the plan to submitted");
        assert.equal(response.json?.scenario?.id, row.id); assert.equal(response.json?.approvalProcess?.instanceId, instance.id);
        assert.equal(oneAudit(before, after, c, "Workforce staffing scenario submitted").metadata.approvalChainInstanceId, instance.id);
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce-planning/scenarios";
        const victimBefore = await scenarioState(c.victim.org.id);
        const refused = async (body, status, label) => {
          const own = await scenarioState(c.orgId);
          const response = expectStatus(await request(url, { method: "PATCH", cookie, body }), status, label);
          assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
          assert.deepEqual(await scenarioState(c.orgId), own, label + ": writes nothing in the own employer");
          assert.deepEqual(await scenarioState(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
        };
        await refused({ scenarioId: c.seeded.id, action: "submit" }, 409, "a second submit of an already submitted scenario");
        await refused({ scenarioId: c.seeded.unlinkedId, action: "submit" }, 409, "a scenario with no linked plan");
        await refused({ scenarioId: c.seeded.unlinkedId, action: "approve" }, 400, "an unsupported action");
        await refused({ scenarioId: c.victimSeeded.unlinkedId, action: "submit" }, 403, "the victim's other scenario");
        return { actions: ["submit"], controls: 3, victimScenarioDenials: 1 };
      } },

    { key: "POST workforce-planning/scenarios", status: 201,
      seed: async (e) => plan(e, "scenario plan"),
      state: scenarioState,
      ownBody: (c) => scenarioBody(c.orgId, c.seeded.id, c.marker + " staffing scenario"),
      foreignBody: (c) => scenarioBody(c.victim.org.id, c.victimSeeded.id, c.marker + " staffing scenario"),
      forged: { status: 404, body: (c) => scenarioBody(c.orgId, c.victimSeeded.id, c.marker + " staffing scenario") },
      expect: (before, after, c, response) => {
        const row = added(before.scenarios, after.scenarios, c, "scenario");
        assert.equal(row.planId, c.seeded.id); assert.equal(row.name, c.marker + " staffing scenario"); assert.equal(row.version, 1);
        assert.equal(row.status, "draft"); assert.equal(row.createdByUserId, c.owner.id);
        assert.equal(Number(row.demandGrowthPercent), 5); assert.equal(Number(row.vacancyFillPercent), 90); assert.equal(Number(row.annualAttritionPercent), 10);
        assert.equal(row.snapshot.linkedPlan.id, c.seeded.id); assert.match(row.snapshotHash, /^[a-f0-9]{64}$/);
        assert.deepEqual(after.plans, before.plans); assert.deepEqual(after.instances, before.instances);
        assert.equal(response.json?.scenario?.id, row.id);
        assert.equal(oneAudit(before, after, c, "Workforce staffing scenario saved").resource, row.name + " v1");
      },
      exercise: async (c, { request, expectStatus, cookie }) => {
        const url = "/api/workforce-planning/scenarios";
        const victimBefore = await scenarioState(c.victim.org.id);
        const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
        // A victim's org unit and a nonexistent one must get the identical refusal (no existence oracle), and write nothing.
        const refusals = [];
        for (const [label, scopeOrgUnitId] of [["victim org unit", c.victim.unit.id], ["missing org unit", 2147483000]]) {
          const own = await scenarioState(c.orgId);
          const response = await expectStatus(await request(url, { method: "POST", cookie, body: scenarioBody(c.orgId, c.seeded.id, c.marker + " scoped", { scopeOrgUnitId }) }), 404, label);
          assert.ok(!response.text.includes(c.victim.marker) && !/select |insert |from "/i.test(response.text), "a refusal leaks no victim data or SQL");
          assert.deepEqual(await scenarioState(c.orgId), own, label + " writes nothing"); assert.deepEqual(await scenarioState(c.victim.org.id), victimBefore);
          refusals.push(response.text);
        }
        assert.equal(refusals[0], refusals[1], "a victim unit and a missing unit are indistinguishable");
        // The caller's own org unit is accepted as the scope.
        {
          const own = await scenarioState(c.orgId);
          await post(scenarioBody(c.orgId, c.seeded.id, c.marker + " own scope", { scopeOrgUnitId: c.unit?.id ?? c.seeded.orgUnitId }), 201, "own org unit scope");
          const row = added(own.scenarios, (await scenarioState(c.orgId)).scenarios, c, "own-scope scenario");
          assert.equal(row.name, c.marker + " own scope");
        }
        // Saving the same name again is a new immutable version, never an overwrite.
        const before = await scenarioState(c.orgId);
        await post(scenarioBody(c.orgId, c.seeded.id, c.marker + " staffing scenario", { demandGrowthPercent: 8 }), 201, "second version");
        const after = await scenarioState(c.orgId);
        const second = added(before.scenarios, after.scenarios, c, "scenario version");
        assert.equal(second.version, 2); assert.equal(Number(second.demandGrowthPercent), 8);
        assert.deepEqual(after.scenarios.filter((row) => row.id !== second.id), before.scenarios, "the first version is untouched");
        assert.deepEqual(await scenarioState(c.victim.org.id), victimBefore, "creating scenarios leaves the victim unchanged");
        return { actions: ["create", "own org unit scope", "second version"], forgedReferences: 2,
          SQLFaultInjection: "NOT_RUN", methodCoverageCredit: false };
      } },
  ];
}

// Keep credited historical family-row line numbers unchanged; this pure helper
// serves only the newly added fictional scoped-scenario POST evidence.
const scenarioBody = (organizationId, planId, name, extra) => ({ organizationId, planId, name, startDate: "2026-01-01", endDate: "2026-03-31",
    demandGrowthPercent: 5, vacancyFillPercent: 90, employerLoadPercent: 0, annualAttritionPercent: 10, attritionBackfillPercent: 80, ...extra });
