import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { employees, organizations, outbox, payrollRuns } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { payrollRunOutboxHealth, queueMessage, retryPayrollRunOutbox } from "../src/lib/mailer";

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


test("failed email attempts persist attempt count, retry time and exact payroll linkage", async () => {
  const previousSmtp = process.env.SMTP_URL;
  const previousResend = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_URL = "smtp://user:pass@127.0.0.1:1";

  const [org] = await db.insert(organizations).values({
    name: "Outbox Reliability Test",
    legalName: "Outbox Reliability Test Inc.",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "MAIL-001",
      firstName: "Mia",
      lastName: "Reyes",
      title: "Staff",
      avatarInitials: "MR",
      basicRate: "30000",
      email: "mia@example.com",
      startDate: "2026-01-01",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
      status: "Released",
    }).returning();

    const result = await queueMessage({
      organizationId: org.id,
      payrollRunId: run.id,
      employeeId: employee.id,
      recipient: employee.email!,
      subject: "Payslip ready",
      body: "Your payslip is ready.",
      purpose: "payslip-ready",
    });

    assert.equal(result.delivered, false);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, result.id)).limit(1);
    assert.equal(row.payrollRunId, run.id);
    assert.equal(row.employeeId, employee.id);
    assert.equal(row.status, "failed");
    assert.equal(row.attemptCount, 1);
    assert.ok(row.lastAttemptAt);
    assert.ok(row.nextAttemptAt);
    assert.ok(row.error?.startsWith("SMTP:"));

    const health = await payrollRunOutboxHealth(org.id, run.id);
    assert.equal(health.total, 1);
    assert.equal(health.failed, 1);
    assert.equal(health.sent, 0);
  } finally {
    if (previousSmtp === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previousSmtp;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("payroll retry sends only queued/failed rows and records provider message id", async () => {
  const previousSmtp = process.env.SMTP_URL;
  const previousResend = process.env.RESEND_API_KEY;
  const previousFetch = globalThis.fetch;
  delete process.env.SMTP_URL;
  process.env.RESEND_API_KEY = "re_test_outbox_retry";

  const [org] = await db.insert(organizations).values({
    name: "Outbox Retry Test",
    legalName: "Outbox Retry Test Inc.",
  }).returning();

  try {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Oct 1–15, 2026",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      payDate: "2026-10-15",
      status: "Released",
    }).returning();

    const [failed, sent] = await db.insert(outbox).values([
      {
        organizationId: org.id,
        payrollRunId: run.id,
        recipient: "failed@example.com",
        subject: "Payslip ready",
        body: "Retry me",
        purpose: "payslip-ready",
        provider: "resend",
        status: "failed",
        attemptCount: 1,
        error: "temporary failure",
      },
      {
        organizationId: org.id,
        payrollRunId: run.id,
        recipient: "sent@example.com",
        subject: "Payslip ready",
        body: "Already sent",
        purpose: "payslip-ready",
        provider: "resend",
        status: "sent",
        attemptCount: 1,
        sentAt: new Date(),
        providerMessageId: "email_existing",
      },
    ]).returning();

    const requestedRecipients: string[] = [];
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      requestedRecipients.push(payload.to?.[0] ?? "");
      return new Response(JSON.stringify({ id: "email_retry_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const results = await retryPayrollRunOutbox(org.id, run.id);
    assert.equal(results.length, 1, "already-sent messages must not be retried");
    assert.deepEqual(requestedRecipients, ["failed@example.com"]);

    const [retried] = await db.select().from(outbox).where(eq(outbox.id, failed.id)).limit(1);
    assert.equal(retried.status, "sent");
    assert.equal(retried.attemptCount, 2);
    assert.equal(retried.providerMessageId, "email_retry_123");
    assert.ok(retried.sentAt);
    assert.equal(retried.error, null);
    assert.equal(retried.nextAttemptAt, null);

    const [stillSent] = await db.select().from(outbox).where(eq(outbox.id, sent.id)).limit(1);
    assert.equal(stillSent.providerMessageId, "email_existing");
    assert.equal(stillSent.attemptCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSmtp === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previousSmtp;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
