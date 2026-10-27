// Synthetic HCM employee skills only: no personnel certification, provider,
// payment or production data. Shared PG16 HTTP writer supplies two independent
// owner sessions and a real higher-ID employer/employee/skill victim.
// Standalone action contract: deliberately NOT registered as a second
// row for the existing POST hcm/capabilities method in tenant-table-catalog.

export function createRows({
  assert, db, eq, asc, hcmSkills, employees, employeePayProfiles,
  payrollRuns, hcmJobProfileSkillRequirements, auditEvents,
  auditBusinessSnapshot, pool,
}) {
  const read = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async (organizationId) => ({
    skills: await read(hcmSkills, organizationId),
    // PostgreSQL DATE columns may deserialize differently across adapters.
    // to_jsonb retains every current/future business field while returning
    // canonical YYYY-MM-DD dates for exact immutable before/after checks.
    assignments: (await pool.query(
      "SELECT to_jsonb(s) AS row FROM hcm_employee_skills s " +
      "WHERE s.organization_id=$1 ORDER BY s.id", [organizationId],
    )).rows.map(({ row }) => row),
    workers: await read(employees, organizationId),
    payProfiles: await read(employeePayProfiles, organizationId),
    payroll: await read(payrollRuns, organizationId),
    jobRequirements: await read(hcmJobProfileSkillRequirements, organizationId),
    audit: auditBusinessSnapshot(await read(auditEvents, organizationId)),
  });
  const draft = (c, organizationId, employeeId, skillId) => ({
    organizationId, action: "set_employee_skill", employeeId, skillId,
    proficiency: 2 + c.rank, status: "declared", effectiveFrom: "2026-10-27",
    effectiveUntil: null, notes: c.marker + " private unverified skill evidence",
  });

  return [
    {
      key: "POST hcm/capabilities",
      // Only set_employee_skill is exercised; the manifest method stays GAP.
      seed: async e => {
        const [skill] = await db.insert(hcmSkills).values({
          organizationId: e.org.id,
          code: e.marker.toUpperCase() + "-SKILL",
          name: e.marker + " fictional capability",
          category: "Fictional",
          createdByUserId: e.owner.id,
          createdByName: e.owner.name,
        }).returning();
        const result = await pool.query(
          "INSERT INTO hcm_employee_skills " +
          "(organization_id, employee_id, skill_id, proficiency, status, effective_from, notes) " +
          "VALUES ($1,$2,$3,1,'declared','2026-01-05',$4) RETURNING id",
          [e.org.id, e.worker.id, skill.id, e.marker + " old private skill"],
        );
        const previousId = Number(result.rows[0]?.id);
        assert.ok(Number.isSafeInteger(previousId) && previousId > 0,
          "a real preexisting employee skill must be persisted for each employer");
        return { ...skill, previousId };
      },
      state,
      ownBody: c => draft(c, c.orgId, c.workerId, c.seeded.id),
      foreignBody: c => draft(c, c.victim.org.id, c.victim.worker.id, c.victimSeeded.id),
      forged: {
        status: 404,
        body: c => draft(c, c.orgId, c.victim.worker.id, c.seeded.id),
      },
      expect: (before, after, c, response) => {
        for (const table of ["skills", "workers", "payProfiles", "payroll", "jobRequirements"]) {
          assert.deepEqual(after[table], before[table], table + ": unchanged by an unverified skill declaration");
        }
        const prior = before.assignments.find(row => Number(row.id) === c.seeded.previousId);
        assert.ok(prior, "own employer must have a real existing skill assertion");
        assert.equal(prior.organization_id, c.orgId);
        assert.equal(prior.employee_id, c.workerId);
        assert.equal(prior.skill_id, c.seeded.id);
        assert.equal(prior.status, "declared");
        assert.equal(before.assignments.length, 1, "one seeded own skill and no extra write fixture");
        assert.equal(after.assignments.length, before.assignments.length + 1);
        const added = after.assignments.filter(row => !before.assignments.some(old => old.id === row.id));
        assert.equal(added.length, 1, "exactly one new persisted employee-skill row");
        const row = added[0];
        assert.ok(Number.isSafeInteger(row.id) && row.id > c.seeded.previousId);
        assert.deepEqual(after.assignments.filter(entry => entry.id !== row.id), before.assignments,
          "historical skill assertion must be untouched");
        assert.equal(row.organization_id, c.orgId);
        assert.equal(row.employee_id, c.workerId);
        assert.equal(row.skill_id, c.seeded.id);
        assert.equal(row.proficiency, 2 + c.rank);
        assert.equal(row.status, "declared");
        assert.equal(row.effective_from, "2026-10-27");
        assert.equal(row.effective_until, null);
        assert.equal(row.notes, c.marker + " private unverified skill evidence");
        assert.equal(row.verified_at, null, "no false credential verification");
        assert.equal(row.verified_by_user_id, null);
        assert.equal(row.verified_by_name, null);
        assert.equal(response.json?.employeeSkill?.id, row.id, "HTTP response must identify persisted skill");
        assert.equal(response.json?.employeeSkill?.organizationId, c.orgId);
        assert.equal(response.json?.employeeSkill?.employeeId, c.workerId);
        assert.equal(response.json?.employeeSkill?.skillId, c.seeded.id);
        assert.equal(response.json?.employeeSkill?.status, "declared");

        assert.equal(after.audit.length, before.audit.length + 1, "exactly one actor-bound audit");
        const events = after.audit.filter(event => !before.audit.some(old => old.id === event.id));
        assert.equal(events.length, 1);
        assert.deepEqual(after.audit.filter(event => event.id !== events[0].id), before.audit,
          "existing audit records may not change");
        const event = events[0];
        assert.ok(Number.isSafeInteger(event.id) && event.id > 0);
        assert.equal(event.organizationId, c.orgId);
        assert.equal(event.actor, c.owner.name);
        assert.equal(event.action, "HCM employee skill updated");
        assert.equal(event.resource, c.worker.employeeNo + " · " + c.seeded.name);
        assert.deepEqual(event.metadata, {
          employeeId: c.workerId, skillId: c.seeded.id,
          proficiency: 2 + c.rank, status: "declared",
          effectiveFrom: "2026-10-27", effectiveUntil: null,
        });
      },
    },
  ];
}
