/**
 * GET /api/invitations/accept bearer-token preview, distinct from POST invite
 * creation and acceptance. Fictional disposable PG16 + localhost HTTP only.
 * Status: proof candidate; ZERO manifest credits until independently accepted.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

const PATH = "/api/invitations/accept";
const hash = (token) => createHash("sha256").update(token).digest("hex");

export function assertOwnInvitationPreview(response, invitation) {
  assert.equal(response.status, 200, "a possessed own bearer token must resolve over HTTP");
  assert.deepEqual(Object.keys(response.json ?? {}).sort(),
    ["email", "expiresAt", "role", "valid"].sort(),
    "preview must never expose organization, internal ids, token hash or PII beyond its documented fields");
  assert.equal(response.json.valid, true);
  assert.equal(response.json.email, invitation.email);
  assert.equal(response.json.role, invitation.role);
  assert.equal(new Date(response.json.expiresAt).toISOString(),
    new Date(invitation.row.expiresAt).toISOString());
  const text = response.text + "\n" + [...response.headers].map(([k, v]) => k + ":" + v).join("\n");
  assert.ok(!text.includes(invitation.token), "bearer token must never appear in the preview");
  assert.ok(!text.includes(invitation.row.tokenHash), "token hash must never appear in the preview");
  assert.ok(!/(?:^|,\s*)public(?:,|$)/i.test(response.headers.get("cache-control") ?? ""),
    "private invitation previews cannot be publicly cacheable");
}

export function assertInvitationPreviewDenied(response, forbidden) {
  assert.equal(response.status, 404, "invalid, expired or consumed tokens must be indistinguishable");
  assert.deepEqual(response.json, { valid: false }, "refusals must not expose invitation state");
  const text = response.text + "\n" + [...response.headers].map(([k, v]) => k + ":" + v).join("\n");
  for (const marker of forbidden) {
    assert.ok(marker && !text.includes(marker), "denial leaked a real employer or invitation marker");
  }
}

export function assertReadOnly(before, after, label) {
  assert.deepEqual(after, before, label + ": preview GET must not mutate any employer, identity or audit row");
}

export async function verifyInvitationPreviewGetTenantBoundary() {
  // The guard MUST execute before importing a DB, schema, seed helper or Next app.
  requireDisposableApprovalTask();
  const [{ db, pool }, s, orm, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { eq, inArray } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  const { auditEvents, employees, invitations, organizations, orgUnits,
    sessions, userOrganizations, users } = s;

  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "INVITE_PREVIEW_REFUSED: not an empty fictional database");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    for (const key of ["org", "unit", "worker", "owner"]) {
      assert.ok(victim[key].id > Math.max(a[key].id, b[key].id),
        "victim's persisted " + key + " must be higher than both attackers");
    }

    const ownedEmails = new Map();
    async function createInvitation(employer, suffix, overrides = {}) {
      const token = randomBytes(32).toString("hex");
      const email = "preview-" + suffix + "-" + nonce + "@example.invalid";
      const [row] = await db.insert(invitations).values({
        organizationId: employer.org.id, email, role: "employee",
        orgUnitId: employer.unit.id, tokenHash: hash(token),
        invitedBy: employer.owner.name, expiresAt: new Date(Date.now() + 3600_000),
        ...overrides,
      }).returning();
      ownedEmails.set(employer.org.id, [...(ownedEmails.get(employer.org.id) ?? []), email]);
      return { token, email, role: row.role, row };
    }
    const ownA = await createInvitation(a, "a");
    const ownB = await createInvitation(b, "b");
    const expired = await createInvitation(a, "expired", {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const consumed = await createInvitation(b, "consumed", {
      acceptedAt: new Date(),
    });
    for (let n = 0; n < 8; n++) await createInvitation(a, "filler-" + n);
    const victimInvite = await createInvitation(victim, "victim", { role: "hr" });
    assert.ok(victimInvite.row.id > Math.max(ownA.row.id, ownB.row.id, 6),
      "real victim invitation must be higher-ID, not a fabricated reference");

    async function snapshot(employer) {
      const id = employer.org.id;
      const emailList = ownedEmails.get(id) ?? [];
      const accounts = emailList.length
        ? await db.select().from(users).where(inArray(users.email, emailList)).orderBy(users.id)
        : [];
      const ids = accounts.map((row) => row.id);
      return {
        organizations: await db.select().from(organizations).where(eq(organizations.id, id)),
        units: await db.select().from(orgUnits).where(eq(orgUnits.organizationId, id)).orderBy(orgUnits.id),
        staff: await db.select().from(employees).where(eq(employees.organizationId, id)).orderBy(employees.id),
        invitations: await db.select().from(invitations).where(eq(invitations.organizationId, id)).orderBy(invitations.id),
        memberships: await db.select().from(userOrganizations).where(eq(userOrganizations.organizationId, id)).orderBy(userOrganizations.id),
        audits: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, id)).orderBy(auditEvents.id),
        inviteeAccounts: accounts,
        inviteeSessions: ids.length
          ? await db.select().from(sessions).where(inArray(sessions.userId, ids)).orderBy(sessions.id) : [],
      };
    }

    const baseline = new Map([
      [a.org.id, await snapshot(a)],
      [b.org.id, await snapshot(b)],
      [victim.org.id, await snapshot(victim)],
    ]);
    const forbidden = [victim.marker, victimInvite.email, victim.owner.email, victimInvite.row.tokenHash];
    // A caller can supply a real victim id in every ignored query selector;
    // possession of A's or B's token MUST still return only A's or B's preview.
    const get = async (token, extras = "") => standaloneRequest(
      PATH + "?organizationId=" + victim.org.id +
      "&invitationId=" + victimInvite.row.id +
      "&userId=" + victim.owner.id + "&role=owner" +
      "&token=" + encodeURIComponent(token) + extras,
    );

    const aResponse = await get(ownA.token);
    const bResponse = await get(ownB.token);
    assertOwnInvitationPreview(aResponse, ownA);
    assertOwnInvitationPreview(bResponse, ownB);
    assert.notEqual(aResponse.json.email, bResponse.json.email,
      "distinct successful token grants must not collapse to one account");
    assert.ok(!aResponse.text.includes(victimInvite.email) &&
      !bResponse.text.includes(victimInvite.email),
      "victim preview must never be chosen by forged identifiers");

    for (const response of [
      await standaloneRequest(PATH + "?organizationId=" + victim.org.id +
        "&invitationId=" + victimInvite.row.id + "&userId=" + victim.owner.id),
      await get(randomBytes(32).toString("hex")),
      await get(ownA.token + "x"),
      await get(expired.token),
      await get(consumed.token),
      await get(""),
    ]) assertInvitationPreviewDenied(response, forbidden);

    for (const employer of [a, b, victim]) {
      assertReadOnly(baseline.get(employer.org.id), await snapshot(employer),
        employer.marker + " including the higher-ID victim");
    }
    const [unconsumedA] = await db.select({ acceptedAt: invitations.acceptedAt })
      .from(invitations).where(eq(invitations.id, ownA.row.id));
    const [unconsumedB] = await db.select({ acceptedAt: invitations.acceptedAt })
      .from(invitations).where(eq(invitations.id, ownB.row.id));
    assert.equal(unconsumedA.acceptedAt, null);
    assert.equal(unconsumedB.acceptedAt, null);

    console.log(JSON.stringify({
      kind: "tenant-invitation-preview-get", method: "GET invitations/accept",
      ownedRealHttpPreviews: 2, deniedInvalidExpiredConsumedOrMissing: 6,
      forgedVictimSelectorsIgnored: true, higherIdVictim: true,
      allThreeEmployerStatesUnchanged: true, coverageCredits: 0,
      independentSecurityReview: "PENDING", productionTested: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-invitation-preview-get-http.mjs")) {
  verifyInvitationPreviewGetTenantBoundary().catch((error) => {
    console.error(error); process.exitCode = 1;
  });
}
