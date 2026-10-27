// Fictional assets only; the shared HTTP/PG16 runner enforces two distinct
// signed-in attackers, a higher-ID persisted victim, and real response isolation.
export function createRows({ assert, pool }) {
  return [
    { key: "GET assets",
      seed: async (employer) => {
        const { rows } = await pool.query(
          'INSERT INTO assets (organization_id, employee_id, type, name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [employer.org.id, employer.worker.id, "laptop", employer.marker + " read asset", "assigned"],
        );
        return rows[0];
      },
      prove: (response, context) => {
        const rows = response.json;
        assert.ok(Array.isArray(rows) && rows.length > 0, "authorized asset list must be populated");
        const own = rows.find((asset) => asset.id === context.seeded.id);
        assert.ok(own, "GET must return the genuine, persisted own-employer asset");
        assert.equal(own.organizationId, context.orgId);
        assert.equal(own.employeeId, context.workerId);
        assert.equal(own.name, context.marker + " read asset");
        assert.ok(rows.every((asset) => asset.organizationId === context.orgId), "asset list must contain only own-employer rows");
        assert.ok(rows.every((asset) => !String(asset.name).includes(context.victim.marker)), "victim asset must never appear in own list");
      } },
  ];
}
