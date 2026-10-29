/**
 * POST hcm/capabilities: the actions that the single-action table row does not prove (create_skill,
 * set_employee_skill, link_credential). set_job_skill is the row's own primary action. Fictional
 * employers only; every refusal must leave the own employer and the victim byte-identical.
 * Lives outside write/ so the family loader does not treat it as a row file.
 */
let schema;
const tables = async () => (schema ??= await import("../../../../src/db/schema.ts"));

export async function capabilitiesActions({ assert, asc, auditBusinessSnapshot, db, eq }, c, { request, expectStatus, cookie }) {
  const s = await tables();
  const url = "/api/hcm/capabilities";
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async (orgId) => JSON.parse(JSON.stringify({
    skills: await read(s.hcmSkills, orgId),
    jobSkills: await read(s.hcmJobProfileSkillRequirements, orgId),
    employeeSkills: await read(s.hcmEmployeeSkills, orgId),
    credentials: await read(s.hcmJobProfileCredentialRequirements, orgId),
    requirements: await read(s.hcmDocumentRequirements, orgId),
    audit: auditBusinessSnapshot(await read(s.auditEvents, orgId)),
  }));
  const post = async (body, status, label) => expectStatus(await request(url, { method: "POST", cookie, body }), status, label);
  const only = (before, after, key) => {
    for (const name of Object.keys(before).filter((n) => n !== key && n !== "audit")) {
      assert.deepEqual(after[name], before[name], "only " + key + " may change: " + name);
    }
  };
  const oneAudit = (before, after, action) => {
    assert.equal(after.audit.length, before.audit.length + 1, "exactly one audit receipt: " + action);
    assert.deepEqual(after.audit.slice(0, -1), before.audit, "earlier audit rows are unchanged");
    const audit = after.audit.at(-1);
    assert.equal(audit.organizationId, c.orgId);
    assert.equal(audit.actor, c.owner.name);
    assert.equal(audit.action, action);
    return audit;
  };
  const victimBefore = await snapshot(c.victim.org.id);
  const refused = async (body, status, label) => {
    const own = await snapshot(c.orgId);
    const response = await post(body, status, label);
    assert.ok(!response.text.includes(c.victim.marker), label + ": a refusal leaks no victim data");
    assert.deepEqual(await snapshot(c.orgId), own, label + ": writes nothing in the own employer");
    assert.deepEqual(await snapshot(c.victim.org.id), victimBefore, label + ": leaves the victim unchanged");
  };

  // create_skill
  let before = await snapshot(c.orgId);
  const skillBody = (organizationId) => ({ organizationId, action: "create_skill", code: c.marker + "-newskill", name: c.marker + " new skill", category: "Fictional" });
  const created = await post(skillBody(c.orgId), 201, "own create_skill");
  let after = await snapshot(c.orgId);
  only(before, after, "skills");
  assert.equal(after.skills.length, before.skills.length + 1, "exactly one skill is created");
  const skill = after.skills.at(-1);
  assert.equal(skill.organizationId, c.orgId);
  assert.equal(skill.code, (c.marker + "-newskill").toUpperCase(), "the code is stored uppercased");
  assert.equal(skill.createdByUserId, c.owner.id);
  assert.equal(created.json?.skill?.id, skill.id, "the response names the committed skill");
  assert.equal(oneAudit(before, after, "HCM skill created").metadata.skillId, skill.id);
  await refused(skillBody(c.victim.org.id), 403, "victim employer create_skill");

  // set_employee_skill: the own worker gets the new own skill; a victim worker or skill is refused.
  before = after;
  const employeeBody = (organizationId, employeeId, skillId) => ({ organizationId, action: "set_employee_skill", employeeId, skillId, proficiency: 4, status: "verified", effectiveFrom: "2026-01-01", notes: c.marker });
  const employeeSkill = await post(employeeBody(c.orgId, c.workerId, skill.id), 200, "own set_employee_skill");
  after = await snapshot(c.orgId);
  only(before, after, "employeeSkills");
  assert.equal(after.employeeSkills.length, before.employeeSkills.length + 1, "exactly one employee skill is written");
  const rating = after.employeeSkills.at(-1);
  assert.equal(rating.organizationId, c.orgId);
  assert.equal(rating.employeeId, c.workerId);
  assert.equal(rating.skillId, skill.id);
  assert.equal(rating.status, "verified");
  assert.equal(rating.verifiedByUserId, c.owner.id);
  assert.equal(employeeSkill.json?.employeeSkill?.id, rating.id);
  assert.equal(oneAudit(before, after, "HCM employee skill verified").metadata.skillId, skill.id);
  await refused(employeeBody(c.orgId, c.victim.worker.id, skill.id), 404, "forged victim worker set_employee_skill");
  await refused(employeeBody(c.orgId, c.workerId, c.victimSeeded.skillId), 404, "forged victim skill set_employee_skill");
  await refused(employeeBody(c.victim.org.id, c.victim.worker.id, c.victimSeeded.skillId), 403, "victim employer set_employee_skill");

  // link_credential: the own job profile gets the own document requirement.
  before = after;
  const credentialBody = (organizationId, jobProfileId, documentRequirementId) => ({ organizationId, action: "link_credential", jobProfileId, documentRequirementId, mandatory: true, blocksWorkforceEligibility: false });
  const linked = await post(credentialBody(c.orgId, c.seeded.id, c.seeded.docId), 200, "own link_credential");
  after = await snapshot(c.orgId);
  only(before, after, "credentials");
  assert.equal(after.credentials.length, before.credentials.length + 1, "exactly one credential requirement is written");
  const link = after.credentials.at(-1);
  assert.equal(link.organizationId, c.orgId);
  assert.equal(link.jobProfileId, c.seeded.id);
  assert.equal(link.documentRequirementId, c.seeded.docId);
  assert.equal(link.createdByUserId, c.owner.id);
  assert.equal(linked.json?.credentialRequirement?.id, link.id);
  assert.equal(oneAudit(before, after, "HCM job credential requirement set").metadata.documentRequirementId, c.seeded.docId);
  await refused(credentialBody(c.orgId, c.seeded.id, c.victimSeeded.docId), 404, "forged victim requirement link_credential");
  await refused(credentialBody(c.orgId, c.victimSeeded.id, c.seeded.docId), 404, "forged victim job profile link_credential");
  await refused(credentialBody(c.victim.org.id, c.victimSeeded.id, c.victimSeeded.docId), 403, "victim employer link_credential");
  return { actions: ["create_skill", "set_employee_skill", "link_credential"], forgedReferences: 5, victimEmployerDenials: 3 };
}
