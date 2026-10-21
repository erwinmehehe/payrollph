/**
 * Synthetic, three-employer login-audit security acceptance. Runs only inside
 * the existing protected PG16 localhost HTTP harness; no live credentials,
 * identity providers, email delivery or deployed environment are accessed.
 *
 * The login API is publicly reachable to accept credentials, but a valid
 * authenticated account must be able to write audit records only to the
 * employer(s) established by its server-side active memberships. Client
 * supplied organizationId/userId fields must never select an audit tenant.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, users } from "../../src/db/schema";
import { hashPassword } from "../../src/lib/crypto";

const loginPath = "/api/auth/login";

async function tenantAuditRows(organizationId) {
  return db.select({
    id: auditEvents.id,
    organizationId: auditEvents.organizationId,
    actor: auditEvents.actor,
    action: auditEvents.action,
    resource: auditEvents.resource,
    metadata: auditEvents.metadata,
  }).from(auditEvents).where(eq(auditEvents.organizationId, organizationId))
    .orderBy(auditEvents.id);
}

export async function verifyTenantLoginAuditIsolation(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");

  // Passwords exist solely in this disposable fixture; the raw value is never
  // printed, persisted into an artifact or included in audit metadata.
  const fictionalPassword = randomBytes(24).toString("hex") + "Aa9!";
  for (const idx of [1, 2]) {
    const owner = f.owners[idx];
    const ownOrg = f.orgs[idx];
    const victimOrg = f.orgs[0];
    await db.update(users).set({ passwordHash: hashPassword(fictionalPassword) })
      .where(eq(users.id, owner.id));

    const victimBefore = await tenantAuditRows(victimOrg.id);
    const ownBefore = await tenantAuditRows(ownOrg.id);
    const own = expectStatus(await request(loginPath, {
      method: "POST",
      body: {
        email: owner.email, password: fictionalPassword,
        organizationId: victimOrg.id, userId: f.owners[0].id,
      },
    }), 200, "Real own-identity sign-in must succeed with forged victim selectors");
    assert.equal(own.json?.user?.id, owner.id);
    assert.match(own.headers.get("set-cookie") ?? "",
      /__Host-linaw_session=/, "Real login must issue a session cookie");

    const ownAfter = await tenantAuditRows(ownOrg.id);
    const victimAfter = await tenantAuditRows(victimOrg.id);
    assert.equal(ownAfter.length, ownBefore.length + 1,
      "An authenticated login must append exactly one real own-employer receipt");
    const receipt = ownAfter.at(-1);
    assert.equal(receipt.organizationId, ownOrg.id);
    assert.equal(receipt.action, "Successful local password sign-in");
    assert.equal(receipt.metadata?.userId, owner.id);
    assert.equal(receipt.metadata?.authMethod, "local");
    assert.equal(receipt.metadata?.mfaVerified, false);
    assert.ok(!Object.keys(receipt.metadata).some(key =>
      /password|token|cookie|secret|backup|ip/i.test(key)),
    "Sensitive login material must never be copied into the audit event");
    assert.deepEqual(victimAfter, victimBefore,
      "A real attacker sign-in with forged victim selectors must leave every victim audit row unchanged");

    const invalid = expectStatus(await request(loginPath, {
      method: "POST",
      body: { email: owner.email, password: fictionalPassword + "wrong",
        organizationId: victimOrg.id },
    }), 401, "Rejected credentials must not create audit receipts");
    assert.equal(invalid.json?.user, undefined);
    assert.deepEqual(await tenantAuditRows(ownOrg.id), ownAfter,
      "A rejected credential must not create a fake successful-login audit receipt");
    assert.deepEqual(await tenantAuditRows(victimOrg.id), victimBefore,
      "Rejected login must not alter victim audit history");
    console.log("PASS isolated real-HTTP login audit: fictional attacker " + idx +
      " gets one own receipt; forged victim selection and invalid login cannot change victim audit");
  }
}
