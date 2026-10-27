// Disposable fictional registration requests only. The existing PG16/HTTP
// table runner supplies two independent attacker employers and a real victim.
// The envelope sentinel is deliberately nondecryptable: GET must never return it.
export const fixtureOrder = {};

export function createRows({ assert, pool, grantOwnEntity }) {
  return [
    { key: "GET multi-entity/registration-changes",
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
        const { rows: [maker] } = await pool.query(
          'INSERT INTO users (name,email,password_hash,role,local_password_enabled) VALUES ($1,$2,$3,$4,false) RETURNING id',
          [employer.marker + ' historical maker', (employer.marker + '-history@example.invalid').toLowerCase(), 'synthetic-no-login', 'owner']);
        const { rows: [history] } = await pool.query(
          'INSERT INTO legal_entity_profile_change_requests (organization_id,legal_entity_id,expected_entity_updated_at,effective_date,changed_fields,profile_envelope,reason,status,requested_by_user_id,decided_by_user_id,decided_at) ' +
          'SELECT $1,$2,updated_at,$3,$4::jsonb,$5,$6,$7,$8,$9,now() FROM legal_entities WHERE organization_id=$1 AND id=$2 RETURNING id',
          [employer.org.id, employer.entity.id, '2026-10-26', JSON.stringify(['legalName']), envelope,
            employer.marker + ' fictional historical approval', 'approved', maker.id, employer.owner.id]);
        const { rows: [version] } = await pool.query(
          'INSERT INTO legal_entity_statutory_registrations (organization_id,legal_entity_id,revision,effective_date,profile_envelope,approved_by_user_id,source_change_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [employer.org.id, employer.entity.id, employer.rank ?? 1, '2026-10-26', envelope, employer.owner.id, history.id]);
        return { id, legalEntityId: employer.entity.id, reason, envelope, historyId: history.id, makerId: maker.id,
          versionId: version.id, revision: employer.rank ?? 1, historyReason: employer.marker + ' fictional historical approval' };
      },
      query: context => "legalEntityId=" + context.entityId,
      foreignQuery: context => "legalEntityId=" + context.victim.entity.id,
      prove: (response, context) => {
        const data = response.json;
        assert.ok(data && typeof data === "object" && !Array.isArray(data));
        assert.deepEqual(Object.keys(data).sort(), ["requests", "versions", "today"].sort());
        assert.match(data.today, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(Array.isArray(data.requests));
        assert.equal(data.requests.length, 2, "pending and historical own-employer requests required");
        assert.equal(data.versions.length, 1, "genuine own-employer version required");
        const version = data.versions[0];
        assert.deepEqual(Object.keys(version).sort(), ['id', 'revision', 'effectiveDate', 'approvedByUserId', 'createdAt'].sort());
        assert.equal(version.id, context.seeded.versionId); assert.equal(version.revision, context.seeded.revision);
        assert.equal(version.effectiveDate, '2026-10-26'); assert.equal(version.approvedByUserId, context.owner.id);
        assert.match(version.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        const [historical, record] = data.requests;
        assert.equal(historical.id, context.seeded.historyId); assert.equal(historical.status, 'approved');
        assert.equal(historical.reason, context.seeded.historyReason); assert.equal(historical.requestedByUserId, context.seeded.makerId);
        assert.equal(historical.decidedByUserId, context.owner.id); assert.equal(historical.canReview, false);
        assert.equal(historical.effectiveDate, '2026-10-26'); assert.deepEqual(historical.changedFields, ['legalName']);
        assert.match(historical.createdAt, /^\d{4}-\d{2}-\d{2}T/); assert.match(historical.decidedAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.deepEqual(Object.keys(historical).sort(), Object.keys(record).sort());
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
