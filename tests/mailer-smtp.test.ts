import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { db } from "../src/db";
import { outbox } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { queueMessage, retryOutboxMessage } from "../src/lib/mailer";

// Regression test for a real gap: activeMailProvider() and deliveryCapable()
// both recognized SMTP_URL and reported the provider as ready, but the actual
// deliver() switch had no "smtp" case, so every SMTP send failed with
// "Provider smtp is not implemented." while /api/readiness claimed the
// adapter was wired. This asserts the failure mode (and success path,
// pending a real network) never regresses to that specific placeholder error.

test("SMTP provider attempts a real send instead of the old 'not implemented' stub", async () => {
  const previous = process.env.SMTP_URL;
  // Deliberately unroutable host. The point is not to reach a mailbox here,
  // it's to prove nodemailer is actually invoked rather than short-circuited.
  process.env.SMTP_URL = "smtp://user:pass@127.0.0.1:1";

  try {
    const result = await queueMessage({
      recipient: "test@example.com",
      subject: "Test",
      body: "Test body",
      purpose: "test",
    });

    assert.equal(result.provider, "smtp");
    assert.notEqual(result.reason, "Provider smtp is not implemented.");
    assert.ok(result.reason?.startsWith("SMTP:"), `expected an SMTP connection error, got: ${result.reason}`);

    const [row] = await db.select().from(outbox).where(eq(outbox.id, result.id)).limit(1);
    assert.equal(row.status, "failed");
    assert.ok(row.error?.startsWith("SMTP:"));
  } finally {
    if (previous === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previous;
  }
});


test("non-sensitive email failure is recoverable and a successful retry is recorded", async () => {
  const previousResend = process.env.RESEND_API_KEY;
  const previousPostmark = process.env.POSTMARK_SERVER_TOKEN;
  const previousSmtp = process.env.SMTP_URL;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_outbox_reliability";
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.SMTP_URL;

  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return new Response(JSON.stringify({ message: "temporary provider failure" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "email_retry_success_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  let messageId = 0;
  try {
    const first = await queueMessage({
      organizationId: 987654,
      recipient: "employee@example.com",
      subject: "Payslip ready",
      body: "Your payslip is ready.",
      purpose: "payslip-ready",
      metadata: { runId: 77, employeeId: 123 },
    });
    messageId = first.id;

    assert.equal(first.delivered, false);
    assert.equal(first.status, "failed");
    assert.equal(first.attempts, 1);

    let [row] = await db.select().from(outbox).where(eq(outbox.id, messageId)).limit(1);
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    assert.equal(row.maxAttempts, 5);
    assert.ok(row.nextAttemptAt, "non-sensitive failure should have a scheduled retry");
    assert.equal((row.metadata as Record<string, unknown>).runId, 77);

    const retried = await retryOutboxMessage(messageId, 987654);
    assert.equal(retried.delivered, true);
    assert.equal(retried.attempts, 2);
    assert.equal(retried.providerMessageId, "email_retry_success_123");

    [row] = await db.select().from(outbox).where(eq(outbox.id, messageId)).limit(1);
    assert.equal(row.status, "sent");
    assert.equal(row.attempts, 2);
    assert.equal(row.error, null);
    assert.equal(row.providerMessageId, "email_retry_success_123");
    assert.equal(row.nextAttemptAt, null);
  } finally {
    if (messageId) await db.delete(outbox).where(eq(outbox.id, messageId));
    globalThis.fetch = previousFetch;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousPostmark === undefined) delete process.env.POSTMARK_SERVER_TOKEN;
    else process.env.POSTMARK_SERVER_TOKEN = previousPostmark;
    if (previousSmtp === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previousSmtp;
  }
});

test("sensitive one-time-link email is redacted and cannot be replayed after failure", async () => {
  const previousResend = process.env.RESEND_API_KEY;
  const previousPostmark = process.env.POSTMARK_SERVER_TOKEN;
  const previousSmtp = process.env.SMTP_URL;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_sensitive_mail";
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.SMTP_URL;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "temporary provider failure" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });

  let messageId = 0;
  try {
    const result = await queueMessage({
      organizationId: 987655,
      recipient: "owner@example.com",
      subject: "Reset password",
      body: "https://example.com/reset?token=secret-one-time-token",
      purpose: "password-reset",
    });
    messageId = result.id;

    const [row] = await db.select().from(outbox).where(eq(outbox.id, messageId)).limit(1);
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    assert.equal(row.maxAttempts, 1);
    assert.equal(row.nextAttemptAt, null);
    assert.ok(row.body.includes("redacted"));
    assert.ok(!row.body.includes("secret-one-time-token"));

    await assert.rejects(
      () => retryOutboxMessage(messageId, 987655),
      /cannot be retried|fresh reset/i,
    );
  } finally {
    if (messageId) await db.delete(outbox).where(eq(outbox.id, messageId));
    globalThis.fetch = previousFetch;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousPostmark === undefined) delete process.env.POSTMARK_SERVER_TOKEN;
    else process.env.POSTMARK_SERVER_TOKEN = previousPostmark;
    if (previousSmtp === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previousSmtp;
  }
});

test("worker and outbox API expose bounded retry and operator recovery", () => {
  const mailer = readFileSync("src/lib/mailer.ts", "utf8");
  const worker = readFileSync("scripts/worker.ts", "utf8");
  const outboxRoute = readFileSync("src/app/api/outbox/route.ts", "utf8");
  const drainRoute = readFileSync("src/app/api/outbox/drain/route.ts", "utf8");
  const releaseRoute = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const outboxUi = readFileSync("src/components/workspace/panels.tsx", "utf8");

  assert.ok(mailer.includes("for update skip locked"));
  assert.ok(mailer.includes("attempts < max_attempts"));
  assert.ok(mailer.includes("nextBackoffMs(attempts)"));
  assert.ok(mailer.includes("This message is already sent and will not be duplicated."));
  assert.ok(worker.includes("drainOutboxRetries(25)"));
  assert.ok(drainRoute.includes("A valid worker token is required."));
  assert.ok(outboxRoute.includes('body.action !== "retry"'));
  assert.ok(outboxRoute.includes("providerMessageId"));
  assert.ok(releaseRoute.includes('purpose: "payslip-ready"'));
  assert.ok(releaseRoute.includes("noticesFailed"));
  assert.ok(outboxUi.includes("Delivery health you can recover"));
  assert.ok(outboxUi.includes("Retry delivery now"));
  assert.ok(outboxUi.includes("Generate a fresh one-time link"));
});
