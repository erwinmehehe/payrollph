// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "PATCH performance/development-plans": 12
};

export function createRows({ asc, assert, db, eq, hcmSkills, performanceSkillDevelopmentPlans, performanceOneOnOnes, performanceOneOnOneActionItems, performanceOneOnOneActionItemEvents }) {
  const meeting = async (e) => (await db.insert(performanceOneOnOnes).values({ organizationId: e.org.id, employeeId: e.worker.id,
    managerUserId: e.owner.id, scheduledFor: new Date("2026-03-01T09:00:00Z"), agenda: e.marker,
    status: "scheduled", createdByUserId: e.owner.id, createdByName: e.marker }).returning())[0];
  const state = async (orgId) => ({
    meetings: await db.select().from(performanceOneOnOnes).where(eq(performanceOneOnOnes.organizationId, orgId)).orderBy(asc(performanceOneOnOnes.id)),
    items: await db.select().from(performanceOneOnOneActionItems).where(eq(performanceOneOnOneActionItems.organizationId, orgId)).orderBy(asc(performanceOneOnOneActionItems.id)),
    events: await db.select().from(performanceOneOnOneActionItemEvents).where(eq(performanceOneOnOneActionItemEvents.organizationId, orgId)).orderBy(asc(performanceOneOnOneActionItemEvents.id)),
  });
  return [
  { key: "PATCH performance/development-plans",
    seed: async (e) => {
      const [skill] = await db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-DP", name: e.marker }).returning();
      return (await db.insert(performanceSkillDevelopmentPlans).values({ organizationId: e.org.id, employeeId: e.worker.id, skillId: skill.id,
        title: e.marker, objective: "Fictional objective " + e.marker, targetProficiency: "4.00", targetDate: "2026-12-31", createdByName: e.marker }).returning())[0];
    },
    state: (orgId) => db.select().from(performanceSkillDevelopmentPlans).where(eq(performanceSkillDevelopmentPlans.organizationId, orgId)).orderBy(asc(performanceSkillDevelopmentPlans.id)),
    ownBody: (c) => ({ organizationId: c.orgId, entityType: "plan", id: c.seeded.id, status: "in_progress" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, entityType: "plan", id: c.victimSeeded.id, status: "in_progress" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, entityType: "plan", id: c.victimSeeded.id, status: "in_progress" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.title === c.marker, "the own plan is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "in_progress");
    } },
  { key: "PATCH performance/action-items",
    seed: async (e) => {
      const parent = await meeting(e);
      return (await db.insert(performanceOneOnOneActionItems).values({ organizationId: e.org.id, oneOnOneId: parent.id,
        employeeId: e.worker.id, ownerKind: "employee", ownerEmployeeId: e.worker.id, ownerName: e.marker,
        title: e.marker + " seeded action", dueDate: "2026-03-10", visibility: "employee_shared", status: "open",
        createdByUserId: e.owner.id, createdByName: e.marker }).returning())[0];
    },
    state: state,
    ownBody: (c) => ({ organizationId: c.orgId, id: c.seeded.id, action: "status", status: "in_progress" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, id: c.victimSeeded.id, action: "status", status: "in_progress" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, id: c.victimSeeded.id, action: "status", status: "in_progress" }) },
    expect: (before, after, c, response) => {
      assert.equal(after.items.length, before.items.length);
      assert.deepEqual(after.meetings, before.meetings);
      const old = before.items.find(r => r.id === c.seeded.id), row = after.items.find(r => r.id === c.seeded.id);
      assert.ok(old && row); assert.equal(old.status, "open"); assert.equal(row.status, "in_progress");
      assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId);
      assert.equal(row.title, c.marker + " seeded action"); assert.equal(row.oneOnOneId, c.seeded.oneOnOneId);
      assert.equal(response.json.id, row.id); assert.equal(response.json.organizationId, c.orgId);
      assert.equal(after.events.length, before.events.length + 1);
      const event = after.events.find(e => !before.events.some(old => old.id === e.id));
      assert.ok(event); assert.equal(event.organizationId, c.orgId); assert.equal(event.actorUserId, c.owner.id);
      assert.equal(event.actionItemId, row.id); assert.equal(event.eventType, "status_changed");
      assert.equal(event.beforeSnapshot.status, "open"); assert.equal(event.afterSnapshot.status, "in_progress");
    } },
  { key: "PATCH performance/continuous",
    seed: meeting,
    state: state,
    ownBody: (c) => ({ organizationId: c.orgId, oneOnOneId: c.seeded.id, action: "reschedule", scheduledFor: "2026-03-02T09:00:00Z", agenda: c.marker + " rescheduled" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, oneOnOneId: c.victimSeeded.id, action: "reschedule", scheduledFor: "2026-03-02T09:00:00Z", agenda: c.marker + " rescheduled" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, oneOnOneId: c.victimSeeded.id, action: "reschedule", scheduledFor: "2026-03-02T09:00:00Z" }) },
    expect: (before, after, c, response) => {
      assert.equal(after.meetings.length, before.meetings.length);
      assert.deepEqual(after.items, before.items); assert.deepEqual(after.events, before.events);
      const row = after.meetings.find(r => r.id === c.seeded.id), old = before.meetings.find(r => r.id === c.seeded.id);
      assert.ok(row && old); assert.notEqual(row.scheduledFor, old.scheduledFor);
      assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId); assert.equal(row.managerUserId, c.owner.id);
      assert.equal(row.agenda, c.marker + " rescheduled"); assert.equal(row.scheduledFor, "2026-03-02T09:00:00.000Z");
      assert.equal(row.status, "scheduled"); assert.equal(response.json.id, row.id); assert.equal(response.json.organizationId, c.orgId);
    } },
  { key: "POST performance/action-items", status: 201,
    seed: meeting,
    state: state,
    ownBody: (c) => ({ organizationId: c.orgId, oneOnOneId: c.seeded.id, title: c.marker + " new action", dueDate: "2026-03-10", ownerKind: "employee", visibility: "employee_shared" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, oneOnOneId: c.victimSeeded.id, title: c.marker + " new action", dueDate: "2026-03-10", ownerKind: "employee", visibility: "employee_shared" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, oneOnOneId: c.victimSeeded.id, title: c.marker + " new action", dueDate: "2026-03-10", ownerKind: "employee", visibility: "employee_shared" }) },
    expect: (before, after, c, response) => {
      assert.deepEqual(after.meetings, before.meetings); assert.equal(after.items.length, before.items.length + 1);
      const row = after.items.find(r => r.title === c.marker + " new action");
      assert.ok(row && !before.items.some(r => r.id === row.id));
      assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId); assert.equal(row.oneOnOneId, c.seeded.id);
      assert.equal(row.ownerKind, "employee"); assert.equal(row.ownerEmployeeId, c.workerId); assert.equal(row.visibility, "employee_shared");
      assert.equal(row.createdByUserId, c.owner.id); assert.equal(row.status, "open"); assert.equal(row.dueDate, "2026-03-10");
      assert.equal(response.json.id, row.id); assert.equal(response.json.organizationId, c.orgId);
      assert.equal(after.events.length, before.events.length + 1);
      const event = after.events.find(e => !before.events.some(old => old.id === e.id));
      assert.ok(event); assert.equal(event.organizationId, c.orgId); assert.equal(event.actionItemId, row.id);
      assert.equal(event.employeeId, c.workerId); assert.equal(event.actorUserId, c.owner.id); assert.equal(event.eventType, "created");
      assert.equal(event.beforeSnapshot, null); assert.equal(event.afterSnapshot.id, row.id);
    } },
  ];
}
