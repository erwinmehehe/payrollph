import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { QueryResultRow } from "pg";
import {
  PII_ROTATION_STORES, scanAllPiiRotationStores, scanPiiRotationStore,
  type PiiRotationDatabase,
} from "../scripts/lib/pii-rotation-backfill";
import { decryptGovernmentId, encryptGovernmentId } from "../src/lib/government-id-crypto";
import { decryptProfilePhoto } from "../src/lib/ess-photo-crypto";

/**
 * Executed PostgreSQL behavior, not a source-grep assertion. These temporary
 * tenant tables shadow public tables only in this one rollback-only session.
 * Test is restricted to the repository's disposable loopback CI database.
 */
const dbAvailable = process.env.CI === "true" && Boolean(process.env.DATABASE_URL);

function legacyEnvelope(prefix: string, key: Buffer, plain: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return prefix + [iv, cipher.getAuthTag(), encrypted].map(x => x.toString("base64url")).join(":");
}

test("S-2: tenant-scoped five-store PostgreSQL rewrap and current-key-only verification", {
  skip: !dbAvailable, timeout: 30_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const parent = Buffer.from("11".repeat(32), "hex");
  const legacyGov = createHmac("sha256", parent).update("linaw:government-identifiers:v1").digest();
  const legacyPhoto = createHmac("sha256", parent).update("linaw:employee-profile-photo:v1").digest();
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PII_ENCRYPTION_KEY: "33".repeat(32),
    PII_LEGACY_GOVERNMENT_ID_KEY: legacyGov.toString("hex"),
    PII_LEGACY_PHOTO_KEY: legacyPhoto.toString("hex"),
    PII_LEGACY_READ_ENABLED: "true",
    BANK_DATA_ENCRYPTION_KEY: "11".repeat(32),
    TOTP_ENCRYPTION_KEY: "22".repeat(32),
  };
  const currentEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PII_ENCRYPTION_KEY: env.PII_ENCRYPTION_KEY };
  const oldGov = legacyEnvelope("enc:govid:v1:", legacyGov, Buffer.from("synthetic-000001"));
  const currentGov = encryptGovernmentId("synthetic-current", { required: true, env: currentEnv })!;
  const bytes = Buffer.from("synthetic employee photo bytes");
  const oldPhoto = legacyEnvelope("enc:essphoto:v1:", legacyPhoto, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE employees (id integer PRIMARY KEY, organization_id integer NOT NULL, tin text, tin_branch_code text, sss_no text, philhealth_no text, pagibig_no text) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE contractors (id integer PRIMARY KEY, organization_id integer NOT NULL, tin text) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE ess_identifier_requests (id integer PRIMARY KEY, organization_id integer NOT NULL, proposed_encrypted text) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE ess_other_identifiers (id integer PRIMARY KEY, organization_id integer NOT NULL, encrypted_value text) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE ess_employee_photos (employee_id integer PRIMARY KEY, organization_id integer NOT NULL, sealed_photo text, byte_size integer, content_sha256 text) ON COMMIT DROP");
    await client.query("INSERT INTO employees(id,organization_id,tin,sss_no) VALUES (1,1001,$1,$2),(2,2002,$1,$2)", [oldGov, currentGov]);
    await client.query("INSERT INTO contractors(id,organization_id,tin) VALUES (3,1001,$1),(4,2002,$1)", [oldGov]);
    await client.query("INSERT INTO ess_identifier_requests(id,organization_id,proposed_encrypted) VALUES (5,1001,$1),(6,2002,$1)", [oldGov]);
    await client.query("INSERT INTO ess_other_identifiers(id,organization_id,encrypted_value) VALUES (7,1001,$1),(8,2002,$1)", [oldGov]);
    await client.query("INSERT INTO ess_employee_photos(employee_id,organization_id,sealed_photo,byte_size,content_sha256) VALUES (9,1001,$1,$2,$3),(10,2002,$1,$2,$3)", [oldPhoto, bytes.length, sha]);

    // Historical records remain readable only with explicit derived-key access.
    assert.equal(decryptGovernmentId(
      (await client.query("SELECT tin FROM employees WHERE id=1")).rows[0].tin, env,
    ), "synthetic-000001");
    assert.deepEqual(decryptProfilePhoto(
      (await client.query("SELECT sealed_photo FROM ess_employee_photos WHERE employee_id=9")).rows[0].sealed_photo, env,
    ), bytes);

    // Default-off legacy reads must NOT silently fall back on bank/TOTP keys.
    await assert.rejects(() => scanAllPiiRotationStores(client, 1001, {
      ...env, PII_LEGACY_READ_ENABLED: "false",
    }, false));
    assert.equal((await client.query("SELECT tin FROM employees WHERE id=1")).rows[0].tin, oldGov);

    const emptyTenant = await scanAllPiiRotationStores(client, 9999, env, true);
    assert.equal(emptyTenant.reduce((n, x) => n + x.scanned, 0), 0);

    const preflight = await scanAllPiiRotationStores(client, 1001, env, false);
    assert.equal(preflight.length, 5);
    assert.equal(preflight.reduce((n, x) => n + x.rewrapped, 0), 5);
    assert.equal(preflight[0].alreadyCurrent, 1);
    assert.equal((await client.query("SELECT tin FROM employees WHERE id=1")).rows[0].tin, oldGov);

    const applied = await scanAllPiiRotationStores(client, 1001, env, true);
    assert.equal(applied.reduce((n, x) => n + x.rewrapped, 0), 5);
    for (const [table, field, id] of [
      ["employees", "tin", 1], ["contractors", "tin", 3],
      ["ess_identifier_requests", "proposed_encrypted", 5],
      ["ess_other_identifiers", "encrypted_value", 7],
    ] as const) {
      const stored = (await client.query(`SELECT "${field}" AS ciphertext FROM "${table}" WHERE id=$1`, [id])).rows[0].ciphertext;
      assert.equal(decryptGovernmentId(stored, currentEnv), "synthetic-000001");
    }
    const storedPhoto = (await client.query("SELECT sealed_photo FROM ess_employee_photos WHERE employee_id=9")).rows[0].sealed_photo;
    assert.deepEqual(decryptProfilePhoto(storedPhoto, currentEnv), bytes);
    const verified = await scanAllPiiRotationStores(client, 1001, currentEnv, false);
    assert.equal(verified.reduce((n, x) => n + x.rewrapped, 0), 0);

    // Every other tenant's ciphertext is unchanged, even though IDs interleave.
    for (const [table, field, id] of [
      ["employees", "tin", 2], ["contractors", "tin", 4],
      ["ess_identifier_requests", "proposed_encrypted", 6],
      ["ess_other_identifiers", "encrypted_value", 8],
    ] as const) {
      const stored = (await client.query(`SELECT "${field}" AS ciphertext FROM "${table}" WHERE id=$1`, [id])).rows[0].ciphertext;
      assert.equal(stored, oldGov);
    }
    assert.equal((await client.query("SELECT sealed_photo FROM ess_employee_photos WHERE employee_id=10")).rows[0].sealed_photo, oldPhoto);

    // Ciphertext changed after a government ID scan must never be overwritten.
    await client.query("UPDATE employees SET tin=$1 WHERE id=1", [oldGov]);
    let identifierRaced = false;
    const identifierRace: PiiRotationDatabase = {
      async query<T extends QueryResultRow = QueryResultRow>(statement: string, params?: unknown[]) {
        if (!identifierRaced && statement.includes('UPDATE "employees"')) {
          identifierRaced = true;
          await client.query("UPDATE employees SET tin=$1 WHERE id=1", [currentGov]);
        }
        return client.query<T>(statement, params);
      },
    };
    await assert.rejects(() => scanPiiRotationStore(identifierRace, PII_ROTATION_STORES[0], 1001, env, true),
      /changed during rewrap/);
    assert.equal(identifierRaced, true);
    assert.equal((await client.query("SELECT tin FROM employees WHERE id=1")).rows[0].tin, currentGov);

    // Concurrent modification to photo metadata makes the compare-and-swap fail.
    await client.query("UPDATE ess_employee_photos SET sealed_photo=$1,content_sha256=$2 WHERE employee_id=9",
      [oldPhoto, sha]);
    let raced = false;
    const wrapper: PiiRotationDatabase = {
      async query<T extends QueryResultRow = QueryResultRow>(statement: string, params?: unknown[]) {
        if (!raced && statement.includes('UPDATE "ess_employee_photos"')) {
          raced = true;
          await client.query("UPDATE ess_employee_photos SET byte_size=byte_size+1 WHERE employee_id=9");
        }
        return client.query<T>(statement, params);
      },
    };
    const photoStore = PII_ROTATION_STORES[4];
    await assert.rejects(() => scanPiiRotationStore(wrapper, photoStore, 1001, env, true),
      /changed during rewrap/);
    assert.equal(raced, true);
    assert.equal((await client.query("SELECT sealed_photo FROM ess_employee_photos WHERE employee_id=9")).rows[0].sealed_photo, oldPhoto);
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
});
