// Scoped legal-employer context switch. Fictional PG16/localhost HTTP only.
// Two authenticated attackers and a real higher-ID victim are supplied by the
// shared write-table runner. Never change tenant permissions or issue credits.
export const fixtureOrder = {};

export function createRows({ assert, pool, db, eq, asc, auditEvents, auditBusinessSnapshot }) {
  const select = async (query, organizationId) =>
    (await pool.query(query, [organizationId])).rows;
  const state = async (organizationId) => {
    const [preferences, grants, entities, events] = await Promise.all([
      select('SELECT id, organization_id AS "organizationId", user_id AS "userId", legal_entity_id AS "legalEntityId", updated_at AS "updatedAt" FROM user_entity_preferences WHERE organization_id = $1 ORDER BY id', organizationId),
      select('SELECT id, organization_id AS "organizationId", user_id AS "userId", legal_entity_id AS "legalEntityId" FROM user_legal_entity_grants WHERE organization_id = $1 ORDER BY id', organizationId),
      select('SELECT id, organization_id AS "organizationId", code, legal_name AS "legalName", primary_entity AS "primaryEntity", active FROM legal_entities WHERE organization_id = $1 ORDER BY id', organizationId),
      db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)).orderBy(asc(auditEvents.id)),
    ]);
    return { preferences, grants, entities, audit: auditBusinessSnapshot(events) };
  };

  return [
    { key: "PATCH multi-entity/context",
      profile: "multi-entity", flags: ["MULTI_ENTITY_ENABLED"],
      seed: async (employer) => {
        await pool.query(
          'INSERT INTO user_legal_entity_grants (organization_id, user_id, legal_entity_id) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id, legal_entity_id) DO NOTHING',
          [employer.org.id, employer.owner.id, employer.entity.id],
        );
        const { rows } = await pool.query(
          'SELECT legal_entity_id AS "id" FROM user_legal_entity_grants WHERE organization_id = $1 AND user_id = $2 AND legal_entity_id = $3',
          [employer.org.id, employer.owner.id, employer.entity.id],
        );
        assert.equal(rows.length, 1, "the actor must hold a genuine own-entity grant");
        assert.equal(rows[0].id, employer.entity.id);
        return { id: rows[0].id };
      },
      state: state,
      ownBody: (c) => ({ organizationId: c.orgId, legalEntityId: c.seeded.id }),
      foreignBody: (c) => ({ organizationId: c.victim.org.id, legalEntityId: c.victimSeeded.id }),
      forged: { status: 403, body: (c) => ({ organizationId: c.orgId, legalEntityId: c.victimSeeded.id }) },
      expect: (before, after, c, response) => {
        assert.deepEqual(after.entities, before.entities, "legal employer master data cannot change");
        assert.deepEqual(after.grants, before.grants, "switching context cannot grant or revoke access");
        assert.equal(before.preferences.some((p) => p.userId === c.owner.id), false,
          "actor must start without a stored preference");
        assert.equal(after.preferences.length, before.preferences.length + 1,
          "exactly one actor-scoped preference must be persisted");
        const added = after.preferences.filter((p) => !before.preferences.some((old) => old.id === p.id));
        assert.equal(added.length, 1, "the change must insert a real preference record");
        const pref = added[0];
        assert.ok(Number.isSafeInteger(pref.id) && pref.id > 0);
        assert.equal(pref.organizationId, c.orgId);
        assert.equal(pref.userId, c.owner.id);
        assert.equal(pref.legalEntityId, c.seeded.id);
        assert.equal(pref.legalEntityId, c.entityId);
        assert.ok(Number.isFinite(Date.parse(pref.updatedAt)), "stored preference has a genuine update time");
        assert.deepEqual(after.preferences.filter((p) => p.id !== pref.id), before.preferences,
          "other users' preferences must be identical");
        assert.deepEqual(response.json, { legalEntityId: c.seeded.id },
          "HTTP success must echo exactly the permitted employer entity");

        assert.equal(after.audit.length, before.audit.length + 1, "exactly one audit event");
        const events = after.audit.filter((event) => !before.audit.some((old) => old.id === event.id));
        assert.equal(events.length, 1);
        const audit = events[0];
        assert.deepEqual(after.audit.filter((event) => event.id !== audit.id), before.audit,
          "existing audit history must be unchanged");
        assert.equal(audit.organizationId, c.orgId);
        assert.equal(audit.actor, c.owner.name);
        assert.equal(audit.action, "Entity context changed");
        assert.equal(audit.resource, "Legal entity");
        assert.deepEqual(audit.metadata, { legalEntityId: c.entityId, actorUserId: c.owner.id });
      },
      exercise: async (c, io) => {
        const before = await state(c.orgId);
        const refused = io.expectStatus(await io.request('/api/multi-entity/context', { method: 'PATCH', cookie: io.cookie,
          body: { organizationId: c.orgId, legalEntityId: 'all' } }), 403, 'scoped owner cannot widen to all entities');
        assert.ok(!refused.text.includes(c.victim.marker)); assert.deepEqual(await state(c.orgId), before);
        return { controls: ['owner-all-entities-denied'] };
      },
    },
  ];
}
