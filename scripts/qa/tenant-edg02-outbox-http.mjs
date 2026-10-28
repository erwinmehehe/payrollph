/**
 * EDG-02: independent outbox retry isolation proof.
 * Real production-mode localhost HTTP + disposable PostgreSQL 16 + a
 * fictional-only SMTP sink. Never touches a deployed app, worker or provider.
 * This proof does NOT grant manifest method credit or production acceptance.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startLocalSmtpSink } from "./tenant-invitations-post-boundary.mjs";

const BASE = "http://127.0.0.1:3000";

export function requireDisposableEdg02Outbox(env = process.env) {
  const expected = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: BASE,
    APP_BASE_URL: "https://payroll.example.test",
    SMTP_URL: "smtp://127.0.0.1:2525",
    MAIL_FROM: "PayrollPH QA <no-reply@example.invalid>",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
    DEMO_MODE: "false",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(env[name], value, "EDG02_OUTBOX_REFUSED: " + name);
  }
  for (const key of [
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY", "DATABASE_AUTH_TOKEN",
  ]) {
    assert.ok(!env[key], "EDG02_OUTBOX_REFUSED: external credential " + key);
  }
}

async function waitForNext(server, logs) {
  for (let attempt = 0; attempt < 70; attempt++) {
    if (server.exitCode !== null) throw new Error("Next exited: " + logs());
    try {
      const reply = await fetch(BASE + "/login", { redirect: "manual" });
      if (reply.ok) return;
    } catch { /* Startup is local only. */ }
    await delay(1000);
  }
  throw new Error("Next did not start: " + logs());
}

async function stopNext(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(4000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

export async function proveEdg02OutboxHttp() {
  requireDisposableEdg02Outbox(); // Must run before DB/app imports.
  const [{ db, pool }, schema, { eq, asc }, http, { queueMessage }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/mailer.ts"),
  ]);
  const { organizations, outbox, auditEvents, employees, payrollRuns } = schema;
  let smtp;
  let server;
  try {
    const [existingOrgs, existingOutbox] = await Promise.all([
      db.select({ id: organizations.id }).from(organizations).limit(1),
      db.select({ id: outbox.id }).from(outbox).limit(1),
    ]);
    assert.equal(existingOrgs.length, 0, "Requires an empty fictional database");
    assert.equal(existingOutbox.length, 0, "Requires a fresh outbox");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await http.seedEmployer("ATTA", nonce, http.standaloneMakeSession);
    const b = await http.seedEmployer("ATTB", nonce, http.standaloneMakeSession);
    const victim = await http.seedEmployer("VICTIM", nonce, http.standaloneMakeSession);
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);

    async function seedNotice(employer, name, purpose) {
      const [row] = await db.insert(outbox).values({
        organizationId: employer.org.id,
        channel: "email",
        recipient: (employer.marker + "-" + name + "@example.invalid").toLowerCase(),
        subject: employer.marker + " " + name,
        body: "Fictional " + name + " notice for " + employer.marker,
        purpose,
        dedupeKey: employer.marker + "-" + name + "-edg02",
        status: "failed",
        provider: "none",
        attempts: 1,
        maxAttempts: 4,
      }).returning();
      return row;
    }
    for (const employer of [a, b]) {
      employer.single = await seedNotice(employer, "single", "statutory-remittance-escalation");
      employer.bulk = await seedNotice(employer, "bulk", "payslip-ready");
    }
    for (let i = 0; i < 6; i++) {
      await seedNotice(victim, "padding-" + i, "fixture-only");
    }
    victim.single = await seedNotice(victim, "confidential", "statutory-remittance-escalation");
    victim.bulk = await seedNotice(victim, "payslip", "payslip-ready");
    assert.ok(victim.single.id > 6 && victim.single.id > a.single.id && victim.single.id > b.single.id);
    assert.ok(victim.bulk.id > a.bulk.id && victim.bulk.id > b.bulk.id);

    async function snapshot(orgId) {
      const byOrg = table => db.select().from(table)
        .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      const [messages, audit, staff, payroll] = await Promise.all([
        byOrg(outbox), byOrg(auditEvents), byOrg(employees), byOrg(payrollRuns),
      ]);
      return { messages, audit, staff, payroll };
    }
    const victimBefore = await snapshot(victim.org.id);
    const ownBefore = new Map();
    for (const actor of [a, b]) ownBefore.set(actor.org.id, await snapshot(actor.org.id));

    smtp = await startLocalSmtpSink();
    server = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000",
    ], { env: { ...process.env, DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    const capture = chunk => { logs = (logs + String(chunk)).slice(-1800); };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    await waitForNext(server, () => logs);

    const post = (cookie, body) => http.standaloneRequest("/api/outbox", {
      method: "POST", cookie, body,
    });
    const deniedAnonymous = await post(undefined, {
      organizationId: victim.org.id, messageId: victim.single.id,
    });
    assert.equal(deniedAnonymous.status, 401, "Anonymous caller cannot retry");
    assert.equal(smtp.captured.length, 0);

    for (const actor of [a, b]) {
      const probes = [
        [{ organizationId: actor.org.id, messageId: victim.single.id }, 404],
        [{ organizationId: victim.org.id, messageId: victim.single.id }, 403],
        [{ organizationId: victim.org.id, messageId: actor.single.id }, 404],
        [{ organizationId: victim.org.id, mode: "retry-failed-payslips" }, 403],
      ];
      for (const [body, status] of probes) {
        const denied = await post(actor.cookie, body);
        assert.equal(denied.status, status, "Foreign outbox ID/org must be rejected");
        assert.ok(!denied.text.includes(victim.single.recipient), "Victim recipient leaked");
        assert.ok(!denied.text.includes(victim.single.body), "Victim message body leaked");
        assert.deepEqual(await snapshot(victim.org.id), victimBefore,
          "Denied retry must leave real victim data and audit unchanged");
        assert.equal(smtp.captured.length, 0, "Denied request must not send email");
      }

      // The dedupe key is globally unique in SQL. A cross-employer collision
      // must NOT return the other employer's outbox ID, status or delivery data.
      await assert.rejects(() => queueMessage({
        organizationId: actor.org.id,
        recipient: actor.single.recipient,
        subject: "Fictional dedupe collision",
        body: "No delivery should occur",
        purpose: "statutory-remittance-escalation",
        dedupeKey: victim.single.dedupeKey,
      }), /Outbox idempotency conflict could not be resolved/);
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "Cross-employer dedupe collision must not change victim message");
      assert.equal(smtp.captured.length, 0, "Collision must not send mail");
    }

    for (const actor of [a, b]) {
      const ownSingle = await post(actor.cookie, {
        organizationId: actor.org.id, messageId: actor.single.id,
      });
      assert.equal(ownSingle.status, 200, "Real own single retry must succeed");
      assert.equal(ownSingle.json?.retried, true);
      assert.equal(ownSingle.json?.id, actor.single.id);
      assert.equal(ownSingle.json?.provider, "smtp");
      const [savedSingle] = await db.select().from(outbox)
        .where(eq(outbox.id, actor.single.id)).limit(1);
      assert.equal(savedSingle.organizationId, actor.org.id);
      assert.equal(savedSingle.status, "sent");
      assert.equal(savedSingle.attempts, 2);
      assert.ok(savedSingle.sentAt, "Own SMTP delivery timestamp must be persisted");
      assert.equal(smtp.captured.filter(x => x.recipient === actor.single.recipient).length, 1,
        "Single retry must reach the fictional localhost SMTP sink");

      const replay = await post(actor.cookie, {
        organizationId: actor.org.id, messageId: actor.single.id,
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.json?.alreadySent, true, "Already-sent retry is idempotent");
      assert.equal(smtp.captured.filter(x => x.recipient === actor.single.recipient).length, 1,
        "Replay must not send a duplicate email");

      const ownDedupe = await queueMessage({
        organizationId: actor.org.id,
        recipient: actor.single.recipient,
        subject: "Fictional same-org duplicate",
        body: "No duplicate delivery",
        purpose: "statutory-remittance-escalation",
        dedupeKey: actor.single.dedupeKey,
      });
      assert.equal(ownDedupe.deduplicated, true, "Own org may resolve its own key");
      assert.equal(ownDedupe.id, actor.single.id);
      assert.equal(smtp.captured.filter(x => x.recipient === actor.single.recipient).length, 1);

      const ownBulk = await post(actor.cookie, {
        organizationId: actor.org.id, mode: "retry-failed-payslips",
      });
      assert.equal(ownBulk.status, 200, "Real own bulk retry must succeed");
      assert.equal(ownBulk.json?.retried, 1);
      assert.equal(ownBulk.json?.sent, 1);
      assert.equal(ownBulk.json?.failed, 0);
      const [savedBulk] = await db.select().from(outbox)
        .where(eq(outbox.id, actor.bulk.id)).limit(1);
      assert.equal(savedBulk.organizationId, actor.org.id);
      assert.equal(savedBulk.status, "sent");
      assert.equal(savedBulk.attempts, 2);
      assert.equal(smtp.captured.filter(x => x.recipient === actor.bulk.recipient).length, 1);

      const ownAfter = await snapshot(actor.org.id);
      assert.deepEqual(ownAfter.staff, ownBefore.get(actor.org.id).staff,
        "Outbox retry cannot change employee records");
      assert.deepEqual(ownAfter.payroll, ownBefore.get(actor.org.id).payroll,
        "Outbox retry cannot change payroll");
      const retryAudits = ownAfter.audit.filter(x => x.action === "Outbox delivery retried");
      assert.equal(retryAudits.length, 2, "Both real own retries must be audited");
      assert.ok(retryAudits.every(x => x.organizationId === actor.org.id));
      assert.deepEqual(await snapshot(victim.org.id), victimBefore,
        "Successful own retry must not affect the foreign victim");
    }

    assert.equal(smtp.captured.length, 4, "Exactly four owned notices may be sent");
    assert.ok(smtp.captured.every(x => [a, b].some(actor =>
      x.recipient === actor.single.recipient || x.recipient === actor.bulk.recipient)));
    assert.ok(smtp.captured.every(x => !x.raw.includes(victim.marker)),
      "Fictional victim markers must never enter SMTP");
    assert.deepEqual(await snapshot(victim.org.id), victimBefore,
      "Higher-ID victim remains unchanged across all positive and negative cases");
    console.log(JSON.stringify({
      family: "EDG-02", method: "POST /api/outbox",
      independentAuthenticatedAttackers: 2, populatedHigherIdVictim: true,
      realOwnedSingleRetries: 2, realOwnedBulkRetries: 2,
      forgedOrgAndMessageIdDenials: 8, localhostSmtpMessages: 4,
      crossTenantDedupeBlocked: true, ownTenantDedupePreserved: true,
      victimDbAndAuditUnchanged: true, providerCalls: false,
      coverageCredits: 0, accepted: false,
    }));
  } finally {
    await stopNext(server);
    if (smtp) await smtp.close();
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-edg02-outbox-http.mjs")) {
  proveEdg02OutboxHttp().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
