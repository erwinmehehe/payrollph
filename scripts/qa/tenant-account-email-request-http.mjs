/**
 * POST /api/account/email: isolated, real-HTTP production-build PG16 proof.
 * Two attacker employers, a higher-ID victim, and same-employer peer.
 * Positive messages go ONLY to an in-process 127.0.0.1:2525 SMTP sink.
 * Draft proof candidate, zero tenant-coverage credits pending independent review.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {securityWriteRun,requireSecurityWrite,assertSecurityDatabase,securityReceipt} from './tenant-security-write-local-contract.mjs';
import { createServer } from "node:net";
import {
  ROUTE_PATH, requireDisposableEmailRequest, assertEmailRequestDenied,
  assertOwnEmailRequest, assertPersistedUnchanged, assertLocalSmtpMessage,
} from "./tenant-account-email-request-contract.mjs";

const sha256 = (input) => createHash("sha256").update(input).digest("hex");

/** Minimal local SMTP receiver. It has no relay, DNS or outbound connection. */
export async function startFictionalSmtpSink() {
  const messages = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    let inData = false;
    let data = [];
    let recipients = [];
    socket.write("220 127.0.0.1 fictional ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const stop = buffer.indexOf("\r\n");
        if (stop < 0) break;
        const line = buffer.slice(0, stop);
        buffer = buffer.slice(stop + 2);
        if (inData) {
          if (line === ".") {
            messages.push({ recipients: [...recipients], data: data.join("\r\n") });
            recipients = [];
            data = [];
            inData = false;
            socket.write("250 2.0.0 accepted by fictional localhost sink\r\n");
          } else {
            data.push(line.startsWith("..") ? line.slice(1) : line);
          }
        } else if (/^EHLO\s/i.test(line)) {
          socket.write("250-localhost\r\n250 8BITMIME\r\n");
        } else if (/^HELO\s/i.test(line)) {
          socket.write("250 localhost\r\n");
        } else if (/^MAIL FROM:/i.test(line)) {
          recipients = [];
          socket.write("250 2.1.0 sender ok\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          const recipient = line.match(/^RCPT TO:\s*<?([^>\s]+)>?/i)?.[1];
          if (!recipient || !recipient.endsWith("@example.invalid")) {
            socket.write("550 5.1.1 only fictional example.invalid recipients permitted\r\n");
          } else {
            recipients.push(recipient);
            socket.write("250 2.1.5 recipient ok\r\n");
          }
        } else if (/^DATA$/i.test(line) && recipients.length === 1) {
          inData = true;
          socket.write("354 end with CRLF dot CRLF\r\n");
        } else if (/^RSET$/i.test(line)) {
          recipients = []; data = []; inData = false;
          socket.write("250 reset\r\n");
        } else if (/^NOOP$/i.test(line)) {
          socket.write("250 ok\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.write("221 closing\r\n");
          socket.end();
        } else {
          socket.write("554 unsupported or unsafe SMTP command\r\n");
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(2525, "127.0.0.1", resolve);
  });
  return {
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export async function verifyAccountEmailRequestBoundary() {
  // Guard MUST run before importing any DB, schema, fixture or runtime module.
  if(securityWriteRun())requireSecurityWrite();else requireDisposableEmailRequest();
  const [{ db, pool }, schema, orm, fixtures, crypto] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
    import("../../src/lib/crypto.ts"),
  ]);
  const {
    users, sessions, emailChangeTokens, userOrganizations, employees,
    auditEvents, outbox, organizations,
  } = schema;
  const { eq, inArray } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixtures;
  const { hashPassword, verifyPassword } = crypto;
  let sink;
  try {
    if(securityWriteRun())await assertSecurityDatabase(pool);
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "ACCOUNT_EMAIL_REQUEST_REFUSED: database must begin with zero users");
    assert.equal((await db.select().from(organizations).limit(1)).length, 0,
      "ACCOUNT_EMAIL_REQUEST_REFUSED: database must begin with zero employers");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    // Keep a real, high-ID victim rather than a fabricated or low-numbered ID.
    for (let i = 0; i < 7; i++) {
      await db.insert(users).values({
        email: "request-filler-" + i + "-" + nonce + "@example.invalid",
        name: "Fictional filler " + i, passwordHash: "disabled", role: "owner",
      });
    }
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6));
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    const employers = [a, b, victim];
    const password = (label) => "Fictional-" + label + "-" + nonce + "-A7!";
    const secrets = {
      a: password("attacker-a"), b: password("attacker-b"),
      v: password("victim"),
    };
    for (const [e, key] of [[a, "a"], [b, "b"], [victim, "v"]]) {
      await db.update(users).set({ passwordHash: hashPassword(secrets[key]) })
        .where(eq(users.id, e.owner.id));
    }
    // Same-employer peer must not be affected by the owner's email-change request.
    const [peer] = await db.insert(users).values({
      email: "request-peer-" + nonce + "@example.invalid",
      name: "Unrelated same-company peer " + nonce, role: "owner",
      passwordHash: hashPassword(password("peer")), active: true,
    }).returning();
    await db.insert(userOrganizations).values({
      userId: peer.id, organizationId: a.org.id, role: "owner", active: true,
    });
    const peerSession = await standaloneMakeSession(peer.id);

    async function seedExistingToken(e, label) {
      const raw = randomBytes(24).toString("hex");
      const [row] = await db.insert(emailChangeTokens).values({
        userId: e.owner.id,
        newEmail: "old-pending-" + label + "-" + nonce + "@example.invalid",
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 20 * 60_000),
      }).returning();
      return row;
    }
    const oldA = await seedExistingToken(a, "a");
    const oldB = await seedExistingToken(b, "b");
    const oldV = await seedExistingToken(victim, "victim");

    const ownedNewEmail = (key, index = 1) =>
      "request-new-" + key + "-" + index + "-" + nonce + "@example.invalid";
    const userRow = async (id) => (await db.select().from(users).where(eq(users.id, id)))[0];
    const tokens = async (userId) => db.select().from(emailChangeTokens)
      .where(eq(emailChangeTokens.userId, userId)).orderBy(emailChangeTokens.id);
    const accountSnapshot = async (e) => ({
      account: await db.select().from(users).where(eq(users.id, e.owner.id)),
      grants: await db.select().from(userOrganizations)
        .where(eq(userOrganizations.userId, e.owner.id)).orderBy(userOrganizations.id),
      sessions: await db.select().from(sessions)
        .where(eq(sessions.userId, e.owner.id)).orderBy(sessions.id),
      tokens: await tokens(e.owner.id),
      workers: await db.select().from(employees)
        .where(eq(employees.organizationId, e.org.id)).orderBy(employees.id),
      audits: await db.select().from(auditEvents)
        .where(eq(auditEvents.organizationId, e.org.id)).orderBy(auditEvents.id),
      outbox: await db.select().from(outbox)
        .where(eq(outbox.organizationId, e.org.id)).orderBy(outbox.id),
    });
    const peerSnapshot = async () => ({
      account: await db.select().from(users).where(eq(users.id, peer.id)),
      grants: await db.select().from(userOrganizations)
        .where(eq(userOrganizations.userId, peer.id)),
      sessions: await db.select().from(sessions)
        .where(eq(sessions.userId, peer.id)),
      tokens: await tokens(peer.id),
    });
    const snapshots = async () => ({
      a: await accountSnapshot(a), b: await accountSnapshot(b),
      victim: await accountSnapshot(victim), peer: await peerSnapshot(),
    });
    const forbidden = [
      victim.marker, victim.owner.email, secrets.v, oldV.tokenHash,
      victim.cookie.split("=")[1], peer.email, secrets.a, secrets.b,
    ];

    // The production-mode endpoint requires a capable provider. The sole SMTP
    // target is an in-process, non-relaying localhost receiver that rejects any
    // recipient outside example.invalid; no real email provider is configured.
    sink = await startFictionalSmtpSink();
    const clearThrottle = () =>
      pool.query("DELETE FROM rate_limit_hits WHERE bucket_key LIKE 'emailchange:%'");
    const post = async (cookie, body) => {
      // The 5/IP/min throttle is outside this ownership proof; isolate each
      // fictional HTTP attempt in a new rate bucket on the throwaway database.
      await clearThrottle();
      return standaloneRequest(ROUTE_PATH, { method: "POST", cookie, body });
    };
    async function denied(cookie, body, status, label) {
      const before = await snapshots();
      const mailCount = sink.messages.length;
      const response = await post(cookie, body);
      const denial = assertEmailRequestDenied(response, status, forbidden);
      assertPersistedUnchanged(before, await snapshots(), label);
      assert.equal(sink.messages.length, mailCount, label + ": refusal sent an email");
      return denial;
    }
    assert.ok(verifyPassword(secrets.v, (await userRow(victim.owner.id)).passwordHash));
    assert.equal((await standaloneRequest("/api/account", { cookie: victim.cookie })).status, 200);
    assert.equal((await standaloneRequest("/api/account", { cookie: peerSession.cookie })).status, 200);
    const victimBaseline = await accountSnapshot(victim);
    const peerBaseline = await peerSnapshot();

    // Independent attackers must both be unable to reach a foreign principal.
    for (const [attacker, key] of [[a, "a"], [b, "b"]]) {
      const ownEmail = ownedNewEmail(key);
      await denied(undefined, { email: ownEmail, password: secrets[key] }, 401, key + " anonymous");
      await denied("__Host-linaw_session=" + "0".repeat(64),
        { email: ownEmail, password: secrets[key] }, 401, key + " invalid cookie");
      const stolen = await denied(attacker.cookie, {
        email: victim.owner.email, password: secrets.v,
        userId: victim.owner.id, organizationId: victim.org.id,
      }, 422, key + " victim email and victim password are not caller credentials");
      assert.ok(stolen.problems.includes("Your current password is not correct."));
      assert.ok(!stolen.problems.some((p) => /already used/i.test(p)),
        "invalid caller password must not reveal victim email existence");
      await denied(attacker.cookie, {
        email: ownEmail, password: "wrong-" + nonce,
      }, 422, key + " wrong current password");
      await denied(attacker.cookie, {
        email: "not-an-email", password: secrets[key],
      }, 422, key + " invalid email");
      await denied(attacker.cookie, {
        email: attacker.owner.email, password: secrets[key],
      }, 422, key + " unchanged own email");
      const taken = await denied(attacker.cookie, {
        email: victim.owner.email, password: secrets[key],
      }, 409, key + " correctly reauthenticated collision");
      assert.ok(taken.problems.some((p) => /already used/i.test(p)),
        "uniqueness check remains available after correct current password");
    }

    async function successfulRequest(attacker, key, index, previousToken) {
      const other = attacker === a ? b : a;
      const otherBefore = await accountSnapshot(other);
      const victimBefore = await accountSnapshot(victim);
      const peerBefore = await peerSnapshot();
      const before = await accountSnapshot(attacker);
      const mailCount = sink.messages.length;
      const email = ownedNewEmail(key, index);
      const response = await post(attacker.cookie, {
        email, password: secrets[key],
        userId: victim.owner.id, organizationId: victim.org.id,
        role: "owner", id: victim.owner.id, tokenId: oldV.id,
        employeeId: victim.worker.id, sessionId: victim.cookie,
      });
      assertOwnEmailRequest(response, email, forbidden);
      assert.throws(()=>assertOwnEmailRequest(response,victim.owner.email,[]),undefined,
        "email validator accepts another employer's data");
      assert.equal(sink.messages.length, mailCount + 1, "one local email per own request");
      const ownTokens = await tokens(attacker.owner.id);
      const pending = ownTokens.filter((row) => !row.usedAt && row.expiresAt > new Date());
      assert.equal(pending.length, 1, "only the caller's latest own token may be usable");
      assert.equal(pending[0].newEmail, email);
      assert.equal(pending[0].userId, attacker.owner.id);
      assert.ok(pending[0].id > previousToken.id, "a new persisted token is required");
      const formerlyPending = ownTokens.find((row) => row.id === previousToken.id);
      assert.ok(formerlyPending.usedAt instanceof Date, "previous pending token must be consumed");
      const deliveredToken = assertLocalSmtpMessage(sink.messages.at(-1), email);
      assert.equal(sha256(deliveredToken), pending[0].tokenHash,
        "SMTP verification link must match only the caller's persisted token hash");
      assert.ok(!response.text.includes(deliveredToken), "response must never reveal verification token");
      const after = await accountSnapshot(attacker);
      assert.deepEqual(after.account, before.account, "request must not change login identifier or password hash");
      assert.deepEqual(after.sessions, before.sessions, "request must not revoke/create sessions");
      assert.deepEqual(after.workers, before.workers, "request cannot mutate employees or payroll");
      assert.deepEqual(after.grants, before.grants, "request cannot change tenant grants");
      const newMessages = after.outbox.slice(before.outbox.length);
      assert.equal(newMessages.length, 1);
      assert.equal(newMessages[0].organizationId, attacker.org.id);
      assert.equal(newMessages[0].recipient, email);
      assert.equal(newMessages[0].purpose, "email-change-verification");
      assert.equal(newMessages[0].provider, "smtp");
      assert.equal(newMessages[0].status, "sent", "SMTP sink accepted real delivery");
      assert.ok(!newMessages[0].body.includes(deliveredToken),
        "sensitive delivery link must be removed from stored outbox body");
      const newAudits = after.audits.slice(before.audits.length);
      const requested = newAudits.filter((row) => row.action === "Account email change verification requested");
      assert.equal(requested.length, 1, "one own-employer email request audit required");
      assert.equal(requested[0].organizationId, attacker.org.id);
      assert.equal(requested[0].actor, attacker.owner.name);
      assert.equal(requested[0].resource, attacker.owner.email + " → " + email);
      assert.ok(!JSON.stringify(newAudits).includes(deliveredToken));
      assertPersistedUnchanged(otherBefore, await accountSnapshot(other), "other attacker after " + key + " success");
      assertPersistedUnchanged(victimBefore, await accountSnapshot(victim), "higher-ID victim after " + key + " success");
      assertPersistedUnchanged(peerBefore, await peerSnapshot(), "same-employer peer after " + key + " success");
      assert.equal((await standaloneRequest("/api/account", { cookie: attacker.cookie })).status, 200,
        "email request must not sign the caller out");
      return pending[0];
    }

    const currentA = await successfulRequest(a, "a", 1, oldA);
    await successfulRequest(b, "b", 1, oldB);
    await successfulRequest(a, "a", 2, currentA);

    // Verify both other employers and the same-company peer remain byte-identical.
    assertPersistedUnchanged(victimBaseline, await accountSnapshot(victim), "victim final rows");
    assertPersistedUnchanged(peerBaseline, await peerSnapshot(), "peer final rows");
    assert.equal((await tokens(victim.owner.id))[0].id, oldV.id);
    assert.ok((await tokens(victim.owner.id))[0].usedAt === null);
    assert.ok(verifyPassword(secrets.v, (await userRow(victim.owner.id)).passwordHash));
    assert.equal((await standaloneRequest("/api/account", { cookie: victim.cookie })).status, 200);

    const result={
      kind: "tenant-account-email-request-post",
      method: "POST account/email", ownRequests: 3,
      independentAttackers: 2, higherIdVictim: true, sameEmployerPeer: true,
      anonymousInvalidWrongPasswordDenied: true, victimEmailHiddenWithoutCurrentPassword: true,
      forgedVictimSelectorsIgnored: true, ownTokenSupersession: true,
      ownAuditAndLocalSmtpDelivery: true, foreignAccountGrantsTokensSessionsAuditOutboxUnchanged: true,
      noRealMailOrPayroll: true, productionTested: false, coverageCredits: 0,
      independentSecurityReview: "PENDING",
    };
    securityReceipt('email',result);console.log(JSON.stringify(result));
  } finally {
    if (sink) await sink.close();
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-account-email-request-http.mjs")) {
  verifyAccountEmailRequestBoundary().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Email request proof failed");
    process.exitCode = 1;
  });
}
