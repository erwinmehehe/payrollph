/**
 * WRK-02 Batch 3: root workforce-planning POST and PATCH, two fictional
 * owner employers against a higher-ID real victim in disposable PG16.
 *
 * Seven successful POST entity types: family, level, grade, org unit,
 * plan, profile and governed position initiation. Direct assignment is
 * explicitly checked as a denied effective-date bypass; no worker is assigned.
 * PATCH demonstrates vacancy freeze and HCM-governed review requests, not
 * independent human approval or a completed position lifecycle.
 *
 * These two methods remain GAP until independent security review accepts
 * exact-head signed-in own/victim HTTP evidence and remaining action races.
 * No money, real employer, government, bank or provider.
 */
export const fixtureOrder = {};

export function createRows({ addWorker, assert, asc, auditBusinessSnapshot, auditEvents, db, eq, jobProfiles }) {
  let sourceTables;
  const tables = async () => (sourceTables ??= await import("../../../../src/db/schema.ts"));
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const read = (table, organizationId) => db.select().from(table)
    .where(eq(table.organizationId, organizationId)).orderBy(asc(table.id));
  const audit = async (organizationId) => auditBusinessSnapshot(await read(auditEvents, organizationId));
  const snapshot = async (organizationId) => {
    const t = await tables();
    return plain({
      families: await read(t.jobFamilies, organizationId),
      levels: await read(t.jobLevels, organizationId),
      grades: await read(t.jobGrades, organizationId),
      profiles: await read(t.jobProfiles, organizationId),
      units: await read(t.orgUnits, organizationId),
      plans: await read(t.workforcePlans, organizationId),
      positions: await read(t.positions, organizationId),
      workers: await read(t.employees, organizationId),
      events: await read(t.workerEmploymentEvents, organizationId),
      processes: await read(t.hcmBusinessProcessInstances, organizationId),
      processSteps: await read(t.hcmBusinessProcessInstanceSteps, organizationId),
      tasks: await read(t.approvalTasks, organizationId),
      requisitions: await read(t.jobRequisitions, organizationId),
      assignments: await read(t.positionAssignments, organizationId),
      audit: await audit(organizationId),
    });
  };
  const created = (before, after, label, employerId) => {
    const added = after.filter(row => !before.some(existing => existing.id === row.id));
    assert.equal(added.length, 1, label + ": exactly one persisted row must be added");
    assert.equal(added[0].organizationId, employerId, label + ": the row must belong to the attacker employer");
    assert.deepEqual(after.filter(row => row.id !== added[0].id), before,
      label + ": every other persisted row stays unchanged");
    return added[0];
  };
  const auditAdded = (before, after, employer, action) => {
    const appended = after.audit.filter(row => !before.audit.some(old => old.id === row.id));
    assert.ok(appended.length >= 1, action + ": the action must leave a real audit receipt");
    const found = appended.find(row => row.action === action);
    assert.ok(found, action + ": expected audit event not recorded");
    assert.equal(found.organizationId, employer.orgId);
    assert.equal(found.actor, employer.owner.name);
    return found;
  };
  const base = (c, entityType, fields = {}) => ({ organizationId: c.orgId, entityType, ...fields });
  const familyBody = c => base(c, "job_family", {
    code: "FAM-" + c.marker.toUpperCase(), name: c.marker + " family",
  });
  const positionBody = (c, fields = {}) => base(c, "position", {
    code: "POSITION-" + c.marker.toUpperCase(),
    jobProfileId: c.seeded.jobProfileId,
    orgUnitId: c.unitId,
    legalEntityId: c.entityId,
    annualBudget: 120000,
    plannedStartDate: "2026-11-15",
    ...fields,
  });
  const denyAndPreserve = async (c, method, body, status, label, client) => {
    const ownBefore = await snapshot(c.orgId);
    const victimBefore = await snapshot(c.victim.org.id);
    const response = client.expectStatus(await client.request("/api/workforce-planning", {
      method, cookie: client.cookie, body,
    }), status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": victim marker must not be disclosed");
    assert.deepEqual(await snapshot(c.orgId), ownBefore, label + ": own employer unchanged");
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": victim employer unchanged");
    return response;
  };
  return [
    {
      key: "POST workforce-planning", status: 201,
      seed: async e => {
        const t = await tables();
        const [profile] = await db.insert(jobProfiles).values({
          organizationId: e.org.id, title: e.marker + " source job profile",
        }).returning();
        const [family] = await db.insert(t.jobFamilies).values({
          organizationId: e.org.id,
          code: "SEED-" + e.marker, name: e.marker + " seeded source family",
        }).returning();
        const [plan] = await db.insert(t.workforcePlans).values({
          organizationId: e.org.id, name: e.marker + " seeded source plan",
          startDate: "2026-01-01", endDate: "2026-12-31",
        }).returning();
        return { id: profile.id, jobProfileId: profile.id, familyId: family.id, planId: plan.id };
      },
      state: snapshot,
      ownBody: familyBody,
      foreignBody: c => ({ ...familyBody(c), organizationId: c.victim.org.id }),
      forged: {
        status: 404,
        body: c => positionBody(c, { code: "FOREIGN-PROFILE-" + c.marker, jobProfileId: c.victimSeeded.jobProfileId }),
      },
      expect: (before, after, c, response) => {
        const row = created(before.families, after.families, "job family", c.orgId);
        assert.equal(row.name, c.marker + " family");
        assert.equal(response.json?.id, row.id);
        auditAdded(before, after, c, "Job family created");
        for (const key of ["levels","grades","profiles","units","plans","positions","workers","events","processes","processSteps","tasks","requisitions","assignments"]) {
          assert.deepEqual(after[key], before[key], "family creation must not mutate " + key);
        }
      },
      exercise: async (c, client) => {
        const post = async (entityType, body, table, auditAction, label) => {
          const before = await snapshot(c.orgId);
          const victimBefore = await snapshot(c.victim.org.id);
          const response = client.expectStatus(await client.request("/api/workforce-planning", {
            method: "POST", cookie: client.cookie, body: base(c, entityType, body),
          }), 201, label);
          const after = await snapshot(c.orgId);
          const row = created(before[table], after[table], label, c.orgId);
          assert.equal(response.json?.id, row.id, label + ": JSON references the persisted new row");
          auditAdded(before, after, c, auditAction);
          assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": victim must not change");
          assert.ok(!response.text.includes(c.victim.marker), label + ": own response must not leak victim");
          return { row, before, after, response };
        };
        const level = (await post("job_level", { code: "LVL-" + c.marker, name: c.marker + " level", sequence: 2 },
          "levels", "Job level created", "own job level")).row;
        const grade = (await post("job_grade", { code: "GRD-" + c.marker, name: c.marker + " grade", sequence: 3 },
          "grades", "Job grade created", "own job grade")).row;
        const unit = (await post("org_unit", {
          code: "UNIT-" + c.marker, name: c.marker + " own unit", type: "department",
          parentId: c.unitId, legalEntityId: c.entityId, managerEmployeeId: c.workerId,
        }, "units", "Organization unit created", "own organization unit")).row;
        assert.equal(unit.parentId, c.unitId);
        assert.equal(unit.legalEntityId, c.entityId);
        const plan = (await post("plan", {
          name: c.marker + " controlled plan", startDate: "2026-01-01",
          endDate: "2026-12-31", budget: 500000,
        }, "plans", "Workforce plan created", "own workforce plan")).row;
        assert.equal(plan.status, "active");
        const family = (await snapshot(c.orgId)).families.find(r => r.name === c.marker + " family");
        assert.ok(family && family.organizationId === c.orgId);
        const profile = (await post("profile", {
          title: c.marker + " approved profile", familyId: family.id, levelId: level.id, gradeId: grade.id,
        }, "profiles", "Job profile created", "own job profile")).row;
        assert.equal(profile.familyId, family.id);
        assert.equal(profile.levelId, level.id);
        assert.equal(profile.gradeId, grade.id);
        const position = await post("position", {
          ...positionBody(c, { jobProfileId: profile.id, orgUnitId: unit.id, planId: plan.id }),
          code: "NEW-" + c.marker,
        }, "positions", "Position creation submitted to HCM business process", "own governed position");
        assert.equal(position.row.jobProfileId, profile.id);
        assert.equal(position.row.orgUnitId, unit.id);
        assert.equal(position.row.planId, plan.id);
        assert.equal(position.row.status, "planned");
        assert.equal(position.response.json?.approvalRequired, true);
        const instanceId = position.response.json?.businessProcess?.id;
        assert.ok(Number.isSafeInteger(instanceId) && instanceId > 0);
        const approvalProcess = created(position.before.processes, position.after.processes, "position review process", c.orgId);
        assert.equal(approvalProcess.id, instanceId);
        assert.equal(approvalProcess.sourceType, "position_creation");
        assert.equal(approvalProcess.processType, "create_position");
        assert.equal(approvalProcess.status, "in_progress");
        assert.ok(position.after.processSteps.some(r => r.instanceId === instanceId));
        await denyAndPreserve(c, "POST", base(c, "org_unit", {
          code: "X-PARENT-" + c.marker, name: c.marker + " foreign parent", type: "department",
          parentId: c.victim.unit.id,
        }), 404, "foreign org unit parent", client);
        await denyAndPreserve(c, "POST", base(c, "profile", {
          title: c.marker + " foreign family", familyId: c.victimSeeded.familyId,
          levelId: level.id,
        }), 404, "foreign family/profiles must not be accepted", client);
        await denyAndPreserve(c, "POST", positionBody(c, {
          code: "X-PLAN-" + c.marker, jobProfileId: profile.id, planId: c.victimSeeded.planId,
        }), 404, "foreign workforce plan", client);
        await denyAndPreserve(c, "POST", positionBody(c, {
          code: "X-ENTITY-" + c.marker, jobProfileId: profile.id, legalEntityId: c.victim.entity.id,
        }), 404, "foreign legal employer", client);
        await denyAndPreserve(c, "POST", base(c, "assignment", {
          positionId: position.row.id, employeeId: c.workerId,
          effectiveFrom: "2099-01-01",
        }), 409, "direct assignment future-date bypass", client);
        await denyAndPreserve(c, "POST", base(c, "unknown", { marker: c.marker }),
          400, "unknown root entity type", client);

        // Only the dedicated disposable-PG16 workflow runs a true direct-assignment
        // success. Other shared table families may add HCM movement governance,
        // so this case is not silently skipped or counted in their proof.
        let directAssignmentProofs = 0;
        if (process.env.TENANT_TABLE_FAMILY === "workforce-planning-root") {
          const { isGovernedPositionAssignmentWorkspace } =
            await import("../../../../src/lib/hcm-position-assignment-guard.ts");
          assert.equal(await isGovernedPositionAssignmentWorkspace(c.orgId), false,
            "dedicated synthetic employer must genuinely be ungoverned");
          const t = await tables();
          const worker = await addWorker(c, "ROOTASSIGN");
          const [vacancy] = await db.insert(t.positions).values({
            organizationId: c.orgId, code: "ASSIGN-" + c.marker,
            jobProfileId: profile.id, orgUnitId: c.unitId, legalEntityId: c.entityId,
            employmentType: "Regular", status: "open", annualBudget: "100000.00",
            createdByUserId: c.owner.id,
          }).returning();
          const todayPh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
          const before = await snapshot(c.orgId);
          const victimBefore = await snapshot(c.victim.org.id);
          const assigned = client.expectStatus(await client.request("/api/workforce-planning", {
            method: "POST", cookie: client.cookie,
            body: base(c, "assignment", {
              positionId: vacancy.id, employeeId: worker.id, effectiveFrom: todayPh,
              reason: "Fictional ungoverned primary position assignment",
            }),
          }), 201, "ungoverned direct position assignment");
          const after = await snapshot(c.orgId);
          const assignment = created(before.assignments, after.assignments,
            "direct primary position assignment", c.orgId);
          assert.equal(assignment.id, assigned.json?.id);
          assert.equal(assignment.positionId, vacancy.id);
          assert.equal(assignment.employeeId, worker.id);
          assert.equal(assignment.assignmentType, "primary");
          assert.equal(assignment.effectiveFrom, todayPh);
          assert.equal(after.positions.find(row => row.id === vacancy.id)?.status, "filled");
          assert.equal(before.workers.find(row => row.id === worker.id)?.status, "Active");
          assert.equal(after.workers.find(row => row.id === worker.id)?.title, profile.title);
          const event = created(before.events, after.events, "position employment event", c.orgId);
          assert.equal(event.employeeId, worker.id);
          assert.equal(event.positionAssignmentId, assignment.id);
          assert.equal(event.eventType, "position_assigned");
          auditAdded(before, after, c, "Employee assigned to position");
          assert.deepEqual(await snapshot(c.victim.org.id), victimBefore,
            "direct assignment must leave foreign employer unchanged");
          assert.ok(!assigned.text.includes(c.victim.marker), "direct assignment response cannot disclose victim");
          await denyAndPreserve(c, "POST", base(c, "assignment", {
            positionId: vacancy.id, employeeId: worker.id, effectiveFrom: todayPh,
          }), 409, "duplicate position assignment refused", client);
          await denyAndPreserve(c, "POST", base(c, "assignment", {
            positionId: c.victim.seeded["PATCH workforce-planning"].id,
            employeeId: worker.id, effectiveFrom: todayPh,
          }), 404, "foreign root assignment target refused", client);
          directAssignmentProofs = 1;
        }
        return {
          positiveEntityTypes: ["job_family","job_level","job_grade","org_unit","plan","profile","position"],
          forgedReferences: 4, blockedDirectAssignments: 1, directAssignmentProofs,
          certifiedMethod: false,
        };
      },
    },
    {
      key: "PATCH workforce-planning", status: 200, deny: 404,
      seed: async e => {
        const t = await tables();
        const [profile] = await db.insert(t.jobProfiles).values({
          organizationId: e.org.id, title: e.marker + " lifecycle profile",
        }).returning();
        const make = async (suffix, status) => (await db.insert(t.positions).values({
          organizationId: e.org.id,
          code: ("LIFE-" + suffix + "-" + e.marker).slice(0, 48),
          jobProfileId: profile.id, orgUnitId: e.unit.id,
          legalEntityId: e.entity.id, status,
          annualBudget: "100000.00", createdByUserId: e.owner.id,
        }).returning())[0];
        const freeze = await make("FREEZE", "open");
        const approved = await make("APPROVED", "approved");
        const planned = await make("PLANNED", "planned");
        const closing = await make("CLOSING", "open");
        const frozen = await make("FROZEN", "frozen");
        return { id: freeze.id, approvedId: approved.id, plannedId: planned.id, closingId: closing.id, frozenId: frozen.id };
      },
      state: snapshot,
      ownBody: c => ({ id: c.seeded.id, status: "frozen" }),
      foreignBody: c => ({ id: c.victimSeeded.id, status: "frozen" }),
      forged: { status: 404, body: c => ({ id: c.victimSeeded.frozenId + 100000, status: "frozen" }) },
      expect: (before, after, c, response) => {
        const row = after.positions.find(r => r.id === c.seeded.id);
        const prior = before.positions.find(r => r.id === c.seeded.id);
        assert.ok(row && prior);
        assert.equal(prior.status, "open");
        assert.equal(row.status, "frozen");
        assert.equal(row.organizationId, c.orgId);
        assert.equal(response.json?.id, row.id);
        assert.equal(response.json?.status, "frozen");
        assert.deepEqual(after.positions.filter(r => r.id !== row.id), before.positions.filter(r => r.id !== row.id));
        auditAdded(before, after, c, "Position status changed");
        for (const key of ["families","levels","grades","profiles","units","plans","processes","processSteps","tasks","requisitions","assignments"]) {
          assert.deepEqual(after[key], before[key], "freezing a vacancy must not mutate " + key);
        }
      },
      exercise: async (c, client) => {
        const post = async (id, status, expected, label) => client.expectStatus(
          await client.request("/api/workforce-planning", {
            method: "PATCH", cookie: client.cookie, body: { id, status },
          }), expected, label);
        const heldVictim = await snapshot(c.victim.org.id);
        const frozenBefore = await snapshot(c.orgId);
        const repeat = await post(c.seeded.id, "frozen", 200, "idempotent vacancy freeze");
        assert.equal(repeat.json?.id, c.seeded.id);
        assert.deepEqual(await snapshot(c.orgId), frozenBefore, "idempotent PATCH must not write an audit");
        const approvedBefore = await snapshot(c.orgId);
        const approved = await post(c.seeded.approvedId, "frozen", 200, "approved vacancy freeze");
        assert.equal(approved.json?.status, "frozen");
        const approvedAfter = await snapshot(c.orgId);
        assert.equal(approvedAfter.positions.find(r => r.id === c.seeded.approvedId)?.status, "frozen");
        auditAdded(approvedBefore, approvedAfter, c, "Position status changed");
        for (const [id, status, label] of [
          [c.seeded.plannedId, "approved", "governed approval request"],
          [c.seeded.closingId, "closed", "governed closure request"],
        ]) {
          const before = await snapshot(c.orgId);
          const response = await post(id, status, 202, label);
          assert.equal(response.json?.approvalRequired, true);
          const after = await snapshot(c.orgId);
          const process = created(before.processes, after.processes, label, c.orgId);
          assert.equal(response.json?.businessProcess?.id, process.id);
          assert.equal(process.status, "in_progress");
          assert.equal(after.positions.find(r => r.id === id)?.status,
            before.positions.find(r => r.id === id)?.status,
            "governed request must not silently apply the status");
          auditAdded(before, after, c, "Position lifecycle review requested");
        }
        for (const [id, status, label] of [
          [c.seeded.frozenId, "approved", "frozen cannot be directly approved"],
          [c.seeded.closingId, "filled", "open cannot be directly filled"],
          [c.seeded.plannedId, "open", "planned cannot be directly opened"],
        ]) {
          await denyAndPreserve(c, "PATCH", { id, status }, 409, label, client);
        }
        const foreignPosition = await denyAndPreserve(c, "PATCH", {
          id: c.victimSeeded.plannedId, status: "approved",
        }, 404, "foreign governed approval request", client);
        const missingPosition = await denyAndPreserve(c, "PATCH", {
          id: Number.MAX_SAFE_INTEGER, status: "approved",
        }, 404, "unknown position id matches foreign 404", client);
        assert.equal(foreignPosition.text, missingPosition.text,
          "foreign and missing positions must be indistinguishable to a non-member");

        // Parallel same-vacancy freezes may have one idempotent 200 or a stale
        // 409, but must only commit one transition and one audit record.
        const t = await tables();
        const source = (await snapshot(c.orgId)).positions.find(row => row.id === c.seeded.id);
        assert.ok(source && source.status === "frozen");
        const [racePosition] = await db.insert(t.positions).values({
          organizationId: c.orgId, code: "RACE-" + c.marker,
          jobProfileId: source.jobProfileId, orgUnitId: c.unitId,
          legalEntityId: c.entityId, status: "open", annualBudget: "100000.00",
          createdByUserId: c.owner.id,
        }).returning();
        const raceBefore = await snapshot(c.orgId);
        const raceVictim = await snapshot(c.victim.org.id);
        const raced = await Promise.all([1, 2].map(() => client.request("/api/workforce-planning", {
          method: "PATCH", cookie: client.cookie, body: { id: racePosition.id, status: "frozen" },
        })));
        assert.ok(raced.every(row => row.status === 200 || row.status === 409),
          "concurrent freeze may only succeed or report a stale conflict");
        assert.ok(raced.some(row => row.status === 200),
          "at least one concurrent vacancy freeze must commit");
        const raceAfter = await snapshot(c.orgId);
        assert.equal(raceAfter.positions.find(row => row.id === racePosition.id)?.status, "frozen");
        const raceAudit = raceAfter.audit.filter(row => !raceBefore.audit.some(old => old.id === row.id)
          && row.action === "Position status changed" && row.resource === racePosition.code);
        assert.equal(raceAudit.length, 1, "exactly one persisted audit for simultaneous freezes");
        assert.deepEqual(await snapshot(c.victim.org.id), raceVictim, "parallel freezes cannot affect victim");
        assert.deepEqual(await snapshot(c.victim.org.id), heldVictim,
          "all lifecycle attempts leave victim employer intact");
        return {
          directVacancyFreezes: 2, governedApprovalRequests: 2,
          forbiddenTransitions: 3, victimDenials: 1, missingIdParity: true,
          racedSamePositionFreezes: 2, certifiedMethod: false,
        };
      },
    },
  ];
}
