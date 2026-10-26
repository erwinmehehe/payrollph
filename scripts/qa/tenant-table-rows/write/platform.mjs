// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "PATCH delegations": 1,
  "PATCH tenant-modules": 2
};

export function createRows({ approvalDelegations, asc, assert, db, eq, organizationModuleSettings, users, userOrganizations, itApplications, itAccessGrants, worksites, dataRequests, approvalChainPolicies, integrationConnectors }) {
  const updated = (before, after, c, response, payload = response.json, employerEcho = true) => {
    assert.equal(after.length, before.length);
    const old = before.find(r => r.id === c.seeded.id), row = after.find(r => r.id === c.seeded.id);
    assert.ok(old && row); assert.equal(old.organizationId, c.orgId); assert.equal(row.organizationId, c.orgId);
    assert.notDeepEqual(row, old); assert.equal(payload?.id, row.id); if (employerEcho) assert.equal(payload?.organizationId, c.orgId);
    return row;
  };
  const created = (before, after, c, response, payload = response.json) => {
    assert.equal(after.length, before.length + 1);
    const added = after.filter(r => !before.some(old => old.id === r.id)); assert.equal(added.length, 1);
    const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
    assert.equal(row.organizationId, c.orgId); assert.equal(payload?.id, row.id); assert.equal(payload?.organizationId, c.orgId);
    return row;
  };
  return [
  { key: "PATCH delegations",
    seed: async (e) => (await db.insert(approvalDelegations).values({ organizationId: e.org.id, fromApprover: e.marker, toApprover: e.marker + "-TO",
      startsOn: "2026-01-01", endsOn: "2026-12-31" }).returning())[0],
    state: (orgId) => db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, orgId)).orderBy(asc(approvalDelegations.id)),
    ownBody: (c) => ({ id: c.seeded.id, active: false }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, active: false }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own delegation is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.fromApprover, c.marker);
      assert.equal(row.active, false, "the own delegation is revoked");
    } },
  { key: "PATCH tenant-modules", flags: ["CORE_MODULE_NAVIGATION_ENABLED"],
    // A distinct module list per employer; the write must add exactly "spend" to the own list.
    seed: async (e) => {
      const modules = { ATTA: ["workforce"], ATTB: ["workforce", "planning"], VICTIM: ["it", "automation"] }[e.label];
      await db.update(organizationModuleSettings).set({ enabledModules: modules }).where(eq(organizationModuleSettings.id, e.org.id));
      return modules;
    },
    state: (orgId) => db.select({ id: organizationModuleSettings.id, enabledModules: organizationModuleSettings.enabledModules })
      .from(organizationModuleSettings).where(eq(organizationModuleSettings.id, orgId)),
    ownBody: (c) => ({ organizationId: c.orgId, moduleId: "spend", enabled: true }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, moduleId: "spend", enabled: true }),
    expect: (before, after, c) => {
      assert.deepEqual([...after[0].enabledModules].sort(), [...c.seeded, "spend"].sort(), "the own module list gains exactly spend");
    } },
  { key: "POST delegations", status: 201,
    seed: async (e) => { const [member] = await db.insert(users).values({ name: e.marker + " delegate", email: e.marker.toLowerCase() + "-delegate@example.invalid", passwordHash: "fictional-no-password-login", role: "owner", totpEnabled: true }).returning(); await db.insert(userOrganizations).values({ userId: member.id, organizationId: e.org.id, role: "owner", active: true }); return member; },
    state: (orgId) => db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, orgId)).orderBy(asc(approvalDelegations.id)),
    ownBody: (c) => ({ organizationId: c.orgId, fromApprover: c.owner.name, toApprover: c.seeded.name, startsOn: "2026-01-01", endsOn: "2026-12-31", reason: c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, fromApprover: c.victim.owner.name, toApprover: c.victimSeeded.name, startsOn: "2026-01-01", endsOn: "2026-12-31", reason: c.marker }),
    forged: { status: 422, body: (c) => ({ organizationId: c.orgId, fromApprover: c.owner.name, toApprover: c.victimSeeded.name, startsOn: "2026-01-01", endsOn: "2026-12-31" }) },
    expect: (before, after, c, response) => {
      const row = created(before, after, c, response);
      assert.equal(row.fromApprover, c.owner.name); assert.equal(row.toApprover, c.seeded.name); assert.equal(row.reason, c.marker);
      assert.equal(row.startsOn, "2026-01-01"); assert.equal(row.endsOn, "2026-12-31"); assert.equal(row.active, true);
    } },
  { key: "POST it-operations", status: 201,
    seed: async (e) => (await db.insert(itApplications).values({ organizationId: e.org.id, name: e.marker }).returning())[0],
    state: (orgId) => db.select().from(itAccessGrants).where(eq(itAccessGrants.organizationId, orgId)).orderBy(asc(itAccessGrants.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "grant", employeeId: c.workerId, applicationId: c.seeded.id }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "grant", employeeId: c.victim.worker.id, applicationId: c.victimSeeded.id }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, action: "grant", employeeId: c.workerId, applicationId: c.victimSeeded.id }) },
    expect: (before, after, c, response) => {
      const row = created(before, after, c, response);
      assert.equal(row.employeeId, c.workerId); assert.equal(row.applicationId, c.seeded.id);
      assert.equal(row.state, "grant_requested"); assert.equal(row.requestedByUserId, c.owner.id); assert.equal(row.confirmedByUserId, null);
    } },
  { key: "PATCH it-operations",
    seed: async (e) => { const [app] = await db.insert(itApplications).values({ organizationId: e.org.id, name: e.marker + " revoke" }).returning(); return (await db.insert(itAccessGrants).values({ organizationId: e.org.id, employeeId: e.worker.id, applicationId: app.id, state: "revoke_requested", requestedByUserId: e.owner.id }).returning())[0]; },
    state: (orgId) => db.select().from(itAccessGrants).where(eq(itAccessGrants.organizationId, orgId)).orderBy(asc(itAccessGrants.id)),
    ownBody: (c) => ({ id: c.seeded.id, action: "access", state: "revoked" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, action: "access", state: "revoked" }),
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response);
      assert.equal(row.employeeId, c.workerId); assert.equal(row.applicationId, c.seeded.applicationId);
      assert.equal(row.state, "revoked"); assert.equal(row.confirmedByUserId, c.owner.id);
    } },
  { key: "POST workforce/worksites", status: 201,
    state: (orgId) => db.select().from(worksites).where(eq(worksites.organizationId, orgId)).orderBy(asc(worksites.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "create_worksite", code: c.marker.toUpperCase(), name: c.marker, orgUnitId: c.unitId, siteType: "office", timezone: "Asia/Manila" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "create_worksite", code: c.marker.toUpperCase(), name: c.marker, siteType: "office", timezone: "Asia/Manila" }),
    forged: { status: 422, body: (c) => ({ organizationId: c.orgId, action: "create_worksite", code: c.marker.toUpperCase(), name: c.marker, orgUnitId: c.victim.unit.id, siteType: "office", timezone: "Asia/Manila" }) },
    expect: (before, after, c, response) => {
      const row = created(before, after, c, response, response.json?.worksite);
      assert.equal(row.name, c.marker); assert.equal(row.code, c.marker.toUpperCase()); assert.equal(row.orgUnitId, c.unitId);
      assert.equal(row.siteType, "office"); assert.equal(row.timezone, "Asia/Manila"); assert.equal(row.active, true);
    } },
  { key: "PATCH compliance/data-requests",
    seed: async (e) => (await db.insert(dataRequests).values({ organizationId: e.org.id, subjectEmail: e.marker.toLowerCase() + "@example.invalid", requestType: "access", status: "received", dueAt: new Date("2026-12-31T00:00:00Z") }).returning())[0],
    state: (orgId) => db.select().from(dataRequests).where(eq(dataRequests.organizationId, orgId)).orderBy(asc(dataRequests.id)),
    ownBody: (c) => ({ id: c.seeded.id, status: "in_progress", notes: c.marker + " triage" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, status: "in_progress", notes: c.marker + " triage" }),
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response);
      assert.equal(row.subjectEmail, c.marker.toLowerCase() + "@example.invalid"); assert.equal(row.requestType, "access");
      assert.equal(row.status, "in_progress"); assert.equal(row.notes, c.marker + " triage"); assert.equal(row.handledBy, c.owner.name); assert.equal(row.completedAt, null);
    } },
  { key: "POST approval-chains",
    seed: async (e) => (await db.insert(approvalChainPolicies).values({ organizationId: e.org.id, code: e.marker.toLowerCase(), name: e.marker, purpose: "automation", active: false, version: 1, steps: [{ label: "Fictional original", approver: e.owner.name }] }).returning())[0],
    state: (orgId) => db.select().from(approvalChainPolicies).where(eq(approvalChainPolicies.organizationId, orgId)).orderBy(asc(approvalChainPolicies.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "save-policy", id: c.seeded.id, code: c.seeded.code, name: c.marker + " revised", purpose: "automation", steps: [{ label: "Fictional review", approver: c.owner.name }] }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "save-policy", id: c.victimSeeded.id, code: c.victimSeeded.code, name: c.marker + " revised", purpose: "automation", steps: [{ label: "Fictional review", approver: c.victim.owner.name }] }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, action: "save-policy", id: c.victimSeeded.id, code: c.victimSeeded.code, name: c.marker + " revised", purpose: "automation", steps: [{ label: "Fictional review", approver: c.owner.name }] }) },
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response);
      assert.equal(row.name, c.marker + " revised"); assert.equal(row.code, c.seeded.code); assert.equal(row.version, c.seeded.version + 1);
      assert.equal(row.active, false); assert.equal(row.steps.length, 1); assert.equal(row.steps[0].approver, c.owner.name);
    } },
  { key: "POST integration-connectors",
    seed: async (e) => (await db.insert(integrationConnectors).values({ organizationId: e.org.id, provider: "slack", name: e.marker, credentialCiphertext: e.marker + "-not-a-credential", active: true, config: { defaultChannelId: "C00000001", allowedChannelIds: ["C00000001"] } }).returning())[0],
    state: (orgId) => db.select().from(integrationConnectors).where(eq(integrationConnectors.organizationId, orgId)).orderBy(asc(integrationConnectors.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "set-active", id: c.seeded.id, active: false }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "set-active", id: c.victimSeeded.id, active: false }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, action: "set-active", id: c.victimSeeded.id, active: false }) },
    expect: (before, after, c, response) => {
      const row = updated(before, after, c, response, response.json, false);
      assert.equal(row.name, c.marker); assert.equal(row.provider, "slack"); assert.equal(row.active, false);
      assert.equal(row.credentialCiphertext, c.seeded.credentialCiphertext); assert.ok(!JSON.stringify(response.json).includes(c.seeded.credentialCiphertext));
    } },
  ];
}
