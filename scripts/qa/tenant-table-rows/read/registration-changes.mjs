// Disposable fictional registration requests only. The existing PG16/HTTP
// table runner supplies two independent attacker employers and a real victim.
// The envelope sentinel is deliberately nondecryptable: GET must never return it.
export const fixtureOrder = {};

export function createRows({ assert, pool, grantOwnEntity }) {
  return [
    {
      key: "GET multi-entity/registration-changes",
      profile: "multi-entity",
      flags: ["MULTI_ENTITY_ENABLED", "MULTI_ENTITY_REGISTRATIONS_ENABLED"],
      seed: async employer => {
        await grantOwnEntity(employer);
        const envelope = "NONDECRYPTABLE_PRIVATE_FIXTURE_" + employer.marker;
        const reason = employer.marker + " fictional statutory registration request";
        const { rows } = await pool.query(
          "INSERT INTO legal_entity_profile_change_requests " +
          "(organization_id, legal_entity_id, expected_entity_updated_at, " +
          "effective_date, changed_fields, profile_envelope, reason, " +
          "status, requested_by_user_id) " +
          "VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id",
          [employer.org.id, employer.entity.id, employer.entity.updatedAt,
            "2026-10-27", JSON.stringify(["displayName"]), envelope,
            reason, "pending_approval", employer.owner.id],
        );
        const id = Number(rows[0]?.id);
        assert.ok(Number.isSafeInteger(id) && id > 0, "request must be a persisted row");
        return { id, legalEntityId: employer.entity.id, reason, envelope };
      },
      query: context => "legalEntityId=" + context.entityId,
      foreignQuery: context => "legalEntityId=" + context.victim.entity.id,
      prove: (response, context) => {
        const data = response.json;
        assert.ok(data && typeof data === "object" && !Array.isArray(data));
        assert.deepEqual(Object.keys(data).sort(), ["requests", "versions", "today"].sort());
        assert.match(data.today, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(Array.isArray(data.requests));
        assert.equal(data.requests.length, 1, "one persisted own-employer request required");
        assert.deepEqual(data.versions, [], "no historical version was seeded");
        const record = data.requests[0];
        assert.deepEqual(Object.keys(record).sort(), [
          "id", "effectiveDate", "changedFields", "status", "reason",
          "requestedByUserId", "decidedByUserId", "createdAt", "decidedAt",
          "canReview",
        ].sort(), "private registration values must never be returned");
        assert.equal(record.id, context.seeded.id);
        assert.equal(record.effectiveDate, "2026-10-27");
        assert.deepEqual(record.changedFields, ["displayName"]);
        assert.equal(record.status, "pending_approval");
        assert.equal(record.reason, context.seeded.reason);
        assert.equal(record.requestedByUserId, context.owner.id);
        assert.equal(record.decidedByUserId, null);
        assert.equal(record.decidedAt, null);
        assert.equal(record.canReview, false, "maker cannot independently review");
        assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.ok(!response.text.includes(context.seeded.envelope),
          "synthetic sealed-value sentinel must not appear in HTTP output");
        assert.ok(!response.text.includes(context.victim.marker),
          "victim-employer marker must not appear in own HTTP output");
      },
    },
  ];
}
