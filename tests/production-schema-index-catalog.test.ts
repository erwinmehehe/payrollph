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
    const read = async () => {
      const result = await client.query<ReleaseIndexMetadata>(
        releaseIndexCatalogSql, [[...requiredReleaseIndexes], schema],
      );
      return result.rows;
    };
    const healthy = await read();
    assert.equal(healthy.length, 1);
    assert.deepEqual(healthy[0].keys, ["provider", "event_id"]);
    assert.ok(healthy[0].isUnique && healthy[0].isValid && healthy[0].isReady);
    assert.ok(validatedReleaseIndexes(healthy).includes("provider_events_provider_event_id_unique"));

    await client.query('DROP INDEX "' + schema + '".provider_events_provider_event_id_unique');
    await client.query('CREATE INDEX provider_events_provider_event_id_unique ON "' + schema + '".provider_events (provider, event_id)');
    const weak = await read();
    assert.ok(!weak[0].isUnique);
    assert.ok(!validatedReleaseIndexes(weak).includes("provider_events_provider_event_id_unique"));

    await client.query('DROP INDEX "' + schema + '".provider_events_provider_event_id_unique');
    await client.query('CREATE UNIQUE INDEX provider_events_provider_event_id_unique ON "' + schema + '".provider_events (provider, id)');
    const wrongKey = await read();
    assert.ok(!validatedReleaseIndexes(wrongKey).includes("provider_events_provider_event_id_unique"));
  } finally {
    if (tx) await client.query("ROLLBACK");
    await client.end();
  }
});
