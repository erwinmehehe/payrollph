import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { outbox } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { queueMessage, queueMessageOnce } from "../src/lib/mailer";

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


test("queueMessageOnce keeps one outbox row per organization, recipient and purpose", async () => {
  const previous = {
    resend: process.env.RESEND_API_KEY,
    postmark: process.env.POSTMARK_SERVER_TOKEN,
    smtp: process.env.SMTP_URL,
  };
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.SMTP_URL;

  const organizationId = 987654;
  const recipient = "handoff-once@example.com";
  const purpose = "payroll-review-test";

  try {
    await db.delete(outbox).where(and(
      eq(outbox.organizationId, organizationId),
      eq(outbox.recipient, recipient),
      eq(outbox.purpose, purpose),
    ));

    const first = await queueMessageOnce({
      organizationId,
      recipient,
      subject: "Payroll review needed",
      body: "Review this payroll.",
      purpose,
    });
    const second = await queueMessageOnce({
      organizationId,
      recipient,
      subject: "Payroll review needed",
      body: "Review this payroll.",
      purpose,
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.id, first.id);

    const rows = await db.select().from(outbox).where(and(
      eq(outbox.organizationId, organizationId),
      eq(outbox.recipient, recipient),
      eq(outbox.purpose, purpose),
    ));
    assert.equal(rows.length, 1);

    await db.update(outbox)
      .set({ status: "failed", error: "simulated failure" })
      .where(eq(outbox.id, first.id));
    const failedDuplicate = await queueMessageOnce({
      organizationId,
      recipient,
      subject: "Payroll review needed",
      body: "Review this payroll.",
      purpose,
    });
    assert.equal(failedDuplicate.duplicate, true);
    assert.equal(failedDuplicate.delivered, false);
    assert.equal(failedDuplicate.queued, false);
    assert.match(failedDuplicate.reason ?? "", /previous notification attempt failed/i);
  } finally {
    await db.delete(outbox).where(and(
      eq(outbox.organizationId, organizationId),
      eq(outbox.recipient, recipient),
      eq(outbox.purpose, purpose),
    ));
    if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.resend;
    if (previous.postmark === undefined) delete process.env.POSTMARK_SERVER_TOKEN;
    else process.env.POSTMARK_SERVER_TOKEN = previous.postmark;
    if (previous.smtp === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previous.smtp;
  }
});
