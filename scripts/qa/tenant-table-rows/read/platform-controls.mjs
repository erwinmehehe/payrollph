export const fixtureOrder = {};
export function createRows({ assert, db, permissionSets }) {
  return [
    { key: "GET enterprise",
      seed: async e => (await db.insert(permissionSets).values({ organizationId: e.org.id, name: e.marker, permissions: [], active: false, createdByUserId: e.owner.id }).returning())[0],
      prove: (response, c) => {
        const sets = response.json?.permissionSets; assert.ok(Array.isArray(sets) && sets.length > 0);
        assert.ok(sets.every(row => row.organizationId === c.orgId));
        const row = sets.find(item => item.id === c.seeded.id); assert.ok(row); assert.equal(row.name, c.marker); assert.equal(row.active, false); assert.deepEqual(row.permissions, []);
      } },
  ];
}
