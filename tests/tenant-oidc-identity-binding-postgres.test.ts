/** Real PG16 transaction fixture, not a full HTTP/IdP authentication receipt. */
import assert from "node:assert/strict";
import test from "node:test";
import { requireDisposableOidcIdentityEnv } from "../scripts/qa/tenant-oidc-identity-binding-contract.mjs";

test("OIDC identity writes bind employer, provider, account and locked active membership in real PG16", {
  skip: process.env.OIDC_IDENTITY_BINDING_PROOF !== "fictional-pg16-only",
}, async t => {
  requireDisposableOidcIdentityEnv(); // Before any DB/application import.
  const [{ pool }, { persistVerifiedOidcIdentity: persist }] = await Promise.all([
    import("../src/db"), import("../src/lib/oidc-identity-binding"),
  ]);
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "Actual PG16 is required");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n, 0,
      "Refuse any existing data/schema; this fixture owns only a fresh database");
    // Minimal real schema for the exact columns/constraints exercised by the
    // production helper; no migration, baseline replay or existing DB reset.
    await pool.query(`
      CREATE TABLE organizations (id serial PRIMARY KEY, name text NOT NULL);
      CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true);
      CREATE TABLE identity_providers (id serial PRIMARY KEY, organization_id int NOT NULL REFERENCES organizations,
        protocol text NOT NULL, enabled boolean NOT NULL);
      CREATE TABLE user_organizations (id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users,
        organization_id int NOT NULL REFERENCES organizations, active boolean NOT NULL, UNIQUE(user_id,organization_id));
      CREATE TABLE external_identities (id serial PRIMARY KEY, organization_id int NOT NULL REFERENCES organizations,
        provider_id int NOT NULL REFERENCES identity_providers, user_id int NOT NULL REFERENCES users,
        subject text NOT NULL, email text NOT NULL, last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(provider_id,subject), UNIQUE(provider_id,user_id));
    `);
    async function seed(label: string) {
      const org = (await pool.query("INSERT INTO organizations(name) VALUES($1) RETURNING id", [label])).rows[0].id as number;
      const user = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [label + "@example.invalid"])).rows[0].id as number;
      const provider = (await pool.query("INSERT INTO identity_providers(organization_id,protocol,enabled) VALUES($1,'oidc',true) RETURNING id", [org])).rows[0].id as number;
      await pool.query("INSERT INTO user_organizations(user_id,organization_id,active) VALUES($1,$2,true)", [user, org]);
      const subject = "subject-" + label, email = label + "@example.invalid";
      const id = (await pool.query("INSERT INTO external_identities(organization_id,provider_id,user_id,subject,email,last_login_at) VALUES($1,$2,$3,$4,$5,'2000-01-01') RETURNING id", [org, provider, user, subject, email])).rows[0].id as number;
      return { organizationId: org, providerId: provider, userId: user, subject, email, existingIdentityId: id };
    }
    for (let i = 0; i < 7; i++) await seed("filler" + i);
    const a = await seed("attacker-a"), b = await seed("attacker-b"), victim = await seed("victim");
    assert.ok(victim.organizationId > Math.max(a.organizationId, b.organizationId, 6));
    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const table of ["organizations", "users", "identity_providers", "user_organizations", "external_identities"])
        out[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows;
      return out;
    };
    const originalVictim = (await pool.query("SELECT * FROM external_identities WHERE organization_id=$1", [victim.organizationId])).rows;
    let denials = 0, positives = 0;
    for (const own of [a, b]) {
      assert.equal(await persist(own), true); positives++;
      assert.ok(new Date((await pool.query("SELECT last_login_at FROM external_identities WHERE id=$1", [own.existingIdentityId])).rows[0].last_login_at).getFullYear() > 2000);
      assert.deepEqual((await pool.query("SELECT * FROM external_identities WHERE organization_id=$1", [victim.organizationId])).rows, originalVictim);
      for (const forged of [
        { ...own, existingIdentityId: victim.existingIdentityId },
        { ...own, providerId: victim.providerId },
        { ...own, organizationId: victim.organizationId },
        { ...own, userId: victim.userId, email: victim.email },
        { ...own, subject: victim.subject },
      ]) {
        const before = await snapshot();
        assert.equal(await persist(forged), false);
        assert.deepEqual(await snapshot(), before); denials++;
      }
      const user = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", ["new-" + own.email])).rows[0].id as number;
      await pool.query("INSERT INTO user_organizations(user_id,organization_id,active) VALUES($1,$2,true)", [user, own.organizationId]);
      assert.equal(await persist({ ...own, userId: user, email: "new-" + own.email, subject: "new-" + own.subject, existingIdentityId: null }), true); positives++;
      const inserted = (await pool.query("SELECT organization_id,subject,email,last_login_at FROM external_identities WHERE provider_id=$1 AND user_id=$2", [own.providerId, user])).rows;
      assert.equal(inserted.length, 1, "New link must actually persist for the intended account");
      assert.equal(inserted[0].organization_id, own.organizationId);
      assert.equal(inserted[0].subject, "new-" + own.subject);
      assert.equal(inserted[0].email, "new-" + own.email);
      assert.ok(inserted[0].last_login_at);
    }
    for (const [table, predicate, params] of [
      ["user_organizations", "user_id=$1 AND organization_id=$2", [a.userId, a.organizationId]],
      ["users", "id=$1", [a.userId]],
      ["identity_providers", "id=$1", [a.providerId]],
    ] as const) {
      const flag = table === "identity_providers" ? "enabled" : "active";
      await pool.query(`UPDATE ${table} SET ${flag}=false WHERE ${predicate}`, [...params]);
      const before = await snapshot();
      assert.equal(await persist(a), false); denials++;
      assert.deepEqual(await snapshot(), before);
      await pool.query(`UPDATE ${table} SET ${flag}=true WHERE ${predicate}`, [...params]);
    }
    const corruptEmail = "corrupt-own@example.invalid";
    const corruptUser = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [corruptEmail])).rows[0].id as number;
    await pool.query("INSERT INTO user_organizations(user_id,organization_id,active) VALUES($1,$2,true)", [corruptUser, a.organizationId]);
    const inconsistent = (await pool.query("INSERT INTO external_identities(organization_id,provider_id,user_id,subject,email) VALUES($1,$2,$3,'inconsistent',$4) RETURNING id",
      [victim.organizationId, a.providerId, corruptUser, corruptEmail])).rows[0].id as number;
    const beforeInconsistent = await snapshot();
    assert.equal(await persist({ ...a, userId: corruptUser, email: corruptEmail, existingIdentityId: inconsistent, subject: "inconsistent" }), false);
    assert.deepEqual(await snapshot(), beforeInconsistent); denials++;
    const beforeDuplicate = await snapshot();
    await assert.rejects(persist({ ...a, existingIdentityId: null }));
    assert.deepEqual(await snapshot(), beforeDuplicate);

    await t.test("a concurrent membership revocation wins before the identity update", async () => {
      const revoker = await pool.connect();
      let result: Promise<boolean> | undefined;
      try {
        await revoker.query("BEGIN");
        await revoker.query("UPDATE user_organizations SET active=false WHERE user_id=$1 AND organization_id=$2", [b.userId, b.organizationId]);
        let settled = false;
        result = persist(b).finally(() => { settled = true; });
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          const waiters = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%user_organizations%'");
          if (waiters.rows[0].n > 0) { blocked = true; break; }
          if (settled) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(blocked, true, "The live membership share lock must wait for in-flight revocation");
        assert.equal(settled, false);
        const before = await pool.query("SELECT * FROM external_identities ORDER BY id");
        await revoker.query("COMMIT");
        assert.equal(await result, false);
        assert.deepEqual((await pool.query("SELECT * FROM external_identities ORDER BY id")).rows, before.rows);
      } finally {
        await revoker.query("ROLLBACK"); revoker.release();
        if (result) await result;
      }
    });
    assert.deepEqual((await pool.query("SELECT * FROM external_identities WHERE id=$1", [victim.existingIdentityId])).rows, originalVictim,
      "The deliberately inconsistent fixture is attributed to the victim, so compare original identity separately");
    console.log(JSON.stringify({ suite: "oidc-identity-membership-binding", postgres: 16,
      ownPositiveWrites: positives, deniedWrites: denials, concurrencyRevocation: true,
      coverageCredits: 0, realProviderCalls: 0, httpAuthenticationTested: false }));
  } finally { await pool.end(); }
});
