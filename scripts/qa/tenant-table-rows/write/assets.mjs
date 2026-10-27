// Asset custody: three real write methods, with no payment or payroll actions.
// Shared PG16/HTTP runners seed two signed-in attackers and a higher-ID victim,
// require actual own mutations, reject foreign writes and snapshot victim rows.
export function createRows({ assert, pool }) {
  const state = async (organizationId) => (await pool.query(
    'SELECT id, organization_id AS "organizationId", employee_id AS "employeeId", type, name, serial_number AS "serialNumber", status, assigned_on AS "assignedOn", returned_on AS "returnedOn", created_at AS "createdAt" FROM assets WHERE organization_id = $1 ORDER BY id',
    [organizationId],
  )).rows;
  const seed = async (employer, suffix) => {
    const { rows } = await pool.query(
      'INSERT INTO assets (organization_id, employee_id, type, name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [employer.org.id, employer.worker.id, "laptop", employer.marker + " " + suffix, "assigned"],
    );
    return rows[0];
  };
  return [
    { key: "POST assets", status: 201,
      seed: (employer) => seed(employer, "post seed"), state,
      ownBody: (context) => ({ organizationId: context.orgId, employeeId: context.workerId,
        type: "laptop", name: context.marker + " created", serialNumber: context.marker + "-SERIAL" }),
      foreignBody: (context) => ({ organizationId: context.victim.org.id, employeeId: context.victim.worker.id,
        type: "laptop", name: context.marker + " created" }),
      forged: { status: 404, body: (context) => ({ organizationId: context.orgId,
        employeeId: context.victim.worker.id, type: "laptop", name: context.marker + " forged" }) },
      expect: (before, after, context, response) => {
        assert.equal(after.length, before.length + 1, "POST inserts exactly one own asset");
        const added = after.filter((asset) => !before.some((prior) => prior.id === asset.id));
        assert.equal(added.length, 1);
        const asset = added[0];
        assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0);
        assert.equal(asset.organizationId, context.orgId);
        assert.equal(asset.employeeId, context.workerId);
        assert.equal(asset.name, context.marker + " created");
        assert.equal(asset.type, "laptop");
        assert.equal(asset.serialNumber, context.marker + "-SERIAL");
        assert.equal(asset.status, "assigned");
        assert.deepEqual(after.filter((row) => row.id !== asset.id), before, "existing assets stay unchanged");
        assert.equal(response.json?.id, asset.id);
        assert.equal(response.json?.organizationId, context.orgId);
        assert.equal(response.json?.employeeId, context.workerId);
      } },
    { key: "PATCH assets",
      seed: (employer) => seed(employer, "patch seed"), state,
      ownBody: (context) => ({ id: context.seeded.id, name: context.marker + " patched" }),
      foreignBody: (context) => ({ id: context.victimSeeded.id, name: context.marker + " patched" }),
      forged: { status: 404, body: (context) => ({ id: context.seeded.id,
        employeeId: context.victim.worker.id, name: context.marker + " forged patch" }) },
      expect: (before, after, context, response) => {
        assert.equal(after.length, before.length, "PATCH must not add or remove assets");
        const prior = before.find((asset) => asset.id === context.seeded.id);
        const asset = after.find((row) => row.id === context.seeded.id);
        assert.ok(prior && asset, "PATCH targets the real own asset");
        assert.equal(prior.organizationId, context.orgId);
        assert.equal(asset.organizationId, context.orgId);
        assert.equal(asset.employeeId, context.workerId);
        assert.equal(asset.name, context.marker + " patched");
        assert.deepEqual({ ...asset, name: prior.name }, prior, "only the asset name changes");
        assert.deepEqual(after.filter((row) => row.id !== asset.id),
          before.filter((row) => row.id !== asset.id), "every other asset stays unchanged");
        assert.equal(response.json?.id, asset.id);
        assert.equal(response.json?.name, asset.name);
      } },
    { key: "DELETE assets",
      seed: (employer) => seed(employer, "delete seed"), state,
      query: (context, target) => "id=" + (target === "own" ? context.seeded.id : context.victimSeeded.id),
      expect: (before, after, context, response) => {
        const own = before.find((asset) => asset.id === context.seeded.id);
        assert.ok(own && own.organizationId === context.orgId && own.employeeId === context.workerId,
          "DELETE targets a genuine own assigned asset");
        assert.equal(after.length, before.length - 1, "DELETE removes exactly one own asset");
        assert.deepEqual(after, before.filter((asset) => asset.id !== context.seeded.id),
          "no unrelated asset may be removed or edited");
        assert.equal(response.json?.success, true);
      } },
  ];
}
