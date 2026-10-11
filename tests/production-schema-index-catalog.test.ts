import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import {
  releaseIndexCatalogSql,
  requiredReleaseIndexes,
  validatedReleaseIndexes,
  type ReleaseIndexMetadata,
} from "../src/lib/production-schema-inventory";

const databaseUrl = process.env.DATABASE_URL;
const localCi = process.env.CI === "true"
  && Boolean(databaseUrl)
  && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl!).hostname);

// Never create fixture objects on production, staging, or a remote test DB.
test("PostgreSQL 16 catalog reports real unique-index keys and invalid shape changes", {
  skip: !localCi,
}, async () => {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 4000 });
  const schema = "preflight_ci_" + randomUUID().replace(/-/g, "").slice(0, 14);
  await client.connect();
  let tx = false;
  try {
    await client.query("BEGIN");
    tx = true;
    // Generated identifier is strictly ASCII [a-z0-9_]; no user-provided SQL.
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('CREATE TABLE "' + schema + '".provider_events (id integer, provider varchar(32), event_id varchar(180))');
    await client.query('CREATE UNIQUE INDEX provider_events_provider_event_id_unique ON "' + schema + '".provider_events (provider, event_id)');
    await client.query(`CREATE TABLE "${schema}".saas_billing_checkouts (organization_id integer, status varchar(24))`);
    await client.query(`CREATE UNIQUE INDEX saas_billing_one_open_checkout ON "${schema}".saas_billing_checkouts (organization_id) WHERE status IN ('creating','awaiting_payment','review_required')`);
    await client.query(`CREATE TABLE "${schema}".audit_events (organization_id integer, chain_seq bigint)`);
    await client.query(`CREATE UNIQUE INDEX audit_events_chain_seq_unique ON "${schema}".audit_events ((coalesce(organization_id, 0)), chain_seq) WHERE chain_seq IS NOT NULL`);
    await client.query(`CREATE TABLE "${schema}".compensation_automation_intents (organization_id integer, "trigger" varchar(64), event_key varchar(240))`);
    await client.query(`CREATE UNIQUE INDEX comp_automation_intent_key_unique ON "${schema}".compensation_automation_intents (organization_id, "trigger", event_key)`);
    const read = async () => {
      const result = await client.query<ReleaseIndexMetadata>(
        releaseIndexCatalogSql, [[...requiredReleaseIndexes], schema],
      );
      return result.rows;
    };
    const healthy = await read();
    assert.equal(healthy.length, requiredReleaseIndexes.length);
    const provider = healthy.find((row) => row.name === "provider_events_provider_event_id_unique");
    assert.deepEqual(provider?.keys, ["provider", "event_id"]);
    assert.ok(provider?.isUnique && provider.isValid && provider.isReady);
    assert.deepEqual(validatedReleaseIndexes(healthy), [...requiredReleaseIndexes],
      "Every 0100/0106/0109/0110 unique-index signature must pass against real pg_catalog output");

    await client.query('DROP INDEX "' + schema + '".provider_events_provider_event_id_unique');
    await client.query('CREATE INDEX provider_events_provider_event_id_unique ON "' + schema + '".provider_events (provider, event_id)');
    const weak = await read();
    assert.equal(weak.find((row) => row.name === "provider_events_provider_event_id_unique")?.isUnique, false);
    assert.ok(!validatedReleaseIndexes(weak).includes("provider_events_provider_event_id_unique"));

    await client.query('DROP INDEX "' + schema + '".provider_events_provider_event_id_unique');
    await client.query('CREATE UNIQUE INDEX provider_events_provider_event_id_unique ON "' + schema + '".provider_events (provider, id)');
    const wrongKey = await read();
    assert.ok(!validatedReleaseIndexes(wrongKey).includes("provider_events_provider_event_id_unique"));

    await client.query('DROP INDEX "' + schema + '".saas_billing_one_open_checkout');
    await client.query(`CREATE UNIQUE INDEX saas_billing_one_open_checkout ON "${schema}".saas_billing_checkouts (organization_id) WHERE status IN ('creating')`);
    const narrowed = await read();
    assert.ok(!validatedReleaseIndexes(narrowed).includes("saas_billing_one_open_checkout"),
      "An incomplete billing status predicate must not pass the release canary");
  } finally {
    if (tx) await client.query("ROLLBACK");
    await client.end();
  }
});
