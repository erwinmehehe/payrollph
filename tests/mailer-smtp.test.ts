import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, organizations, outbox } from "../src/db/schema";
import {
  drainOutboxRetries,
  queueMessage,
  recentOutboxWithAttempts,
  retryOutboxMessage,
} from "../src/lib/mailer";

type ProviderEnv = {
  RESEND_API_KEY?: string;
  POSTMARK_SERVER_TOKEN?: string;
  SMTP_URL?: string;
};

function snapshotProviders(): ProviderEnv {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN,
    SMTP_URL: process.env.SMTP_URL,
  };
}

function restoreProviders(previous: ProviderEnv) {
  for (const key of ["RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL"] as const) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearProviders() {
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.SMTP_URL;
}

async function createOrg(name: string) {
  const [org] = await db.insert(organizations).values({
    name,
    legalName: `${name} Inc.`,
  }).returning();
  return org;
}

async function cleanupOrg(organizationId: number) {
  await db.delete(auditEvents).where(eq(auditEvents.organizationId, organizationId));
  await db.delete(outbox).where(eq(outbox.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

// Regression test for a real gap: activeMailProvider() and deliveryCapable()
// both recognized SMTP_URL and reported the provider as ready, but the actual
// deliver() switch had no "smtp" case. This asserts nodemailer is invoked.
test("SMTP provider attempts a real send instead of the old 'not implemented' stub", async () => {
  const previous = snapshotProviders();
  clearProviders();
  process.env.SMTP_URL = "smtp://user:pass@127.0.0.1:1";

  try {
    const result = await queueMessage({
      recipient: "test@example.com",
      subject: "Test",
      body: "Test body",
      purpose: "test",
    });

    assert.equal(result.provider, "smtp");
    assert.equal(result.status, "failed");
    assert.notEqual(result.reason, "Provider smtp is not implemented.");
    assert.ok(result.reason?.startsWith("SMTP:"), `expected an SMTP connection error, got: ${result.reason}`);

    const [row] = await db.select().from(outbox).where(eq(outbox.id, result.id)).limit(1);
    assert.equal(row.status, "failed");
    assert.ok(row.error?.startsWith("SMTP:"));
    await db.delete(outbox).where(eq(outbox.id, result.id));
  } finally {
    restoreProviders(previous);
  }
});

test("no provider leaves a payslip notice queued with exact payroll context", async () => {
  const previous = snapshotProviders();
  clearProviders();
  const org = await createOrg("Outbox Queue Test");

  try {
    const result = await queueMessage({
      organizationId: org.id,
      recipient: "employee@example.com",
      subject: "Payslip ready",
      body: "Your payslip is ready.",
      purpose: "payslip-ready",
      audit: {
        actor: "Payroll Owner",
        metadata: {
          runId: 77,
          employeeId: 123,
          employeeNo: "E-123",
          periodLabel: "Sep 16–30, 2026",
        },
      },
    });

    assert.equal(result.status, "queued");
    assert.equal(result.queued, true);

    const rows = await recentOutboxWithAttempts(10, org.id);
    const row = rows.find((item) => item.id === result.id);
    assert.ok(row);
    assert.equal(row!.stateLabel, "Queued");
    assert.equal(row!.attemptCount, 0);
    assert.equal(row!.retryCount, 0);
    assert.equal(row!.runId, 77);
    assert.equal(row!.employeeId, 123);
    assert.equal(row!.periodLabel, "Sep 16–30, 2026");
    assert.equal(row!.canRetry, true);
  } finally {
    restoreProviders(previous);
    await cleanupOrg(org.id);
  }
});

test("a failed payslip notice can be retried on the same durable outbox row", async () => {
  const previous = snapshotProviders();
  clearProviders();
  process.env.SMTP_URL = "smtp://user:pass@127.0.0.1:1";
  const org = await createOrg("Outbox Retry Test");

  try {
    const initial = await queueMessage({
      organizationId: org.id,
      recipient: "employee@example.com",
      subject: "Payslip ready",
      body: "Your payslip is ready.",
      purpose: "payslip-ready",
      audit: {
        actor: "Payroll Owner",
        metadata: { runId: 88, employeeId: 456, periodLabel: "Sep 1–15, 2026" },
      },
    });
    assert.equal(initial.status, "failed");

    const retry = await retryOutboxMessage({
      id: initial.id,
      organizationId: org.id,
      actor: "Payroll Owner",
      trigger: "manual",
    });
    assert.equal(retry.ok, false);
    assert.equal(retry.httpStatus, 502);

    const rows = await recentOutboxWithAttempts(10, org.id);
    const row = rows.find((item) => item.id === initial.id);
    assert.ok(row);
    assert.equal(row!.status, "failed");
    assert.equal(row!.retryCount, 1);
    assert.equal(row!.attemptCount, 2);
    assert.equal(row!.stateLabel, "Retry failed");
  } finally {
    restoreProviders(previous);
    await cleanupOrg(org.id);
  }
});

test("failed one-time security links are never replayed from stored redacted content", async () => {
  const previous = snapshotProviders();
  clearProviders();
  process.env.SMTP_URL = "smtp://user:pass@127.0.0.1:1";
  const org = await createOrg("Outbox Sensitive Test");

  try {
    const initial = await queueMessage({
      organizationId: org.id,
      recipient: "employee@example.com",
      subject: "Reset your password",
      body: "https://example.test/reset?token=super-secret",
      purpose: "password-reset",
    });
    assert.equal(initial.status, "failed");

    const [stored] = await db.select().from(outbox).where(eq(outbox.id, initial.id)).limit(1);
    assert.match(stored.body, /redacted after delivery attempt/);

    const retry = await retryOutboxMessage({
      id: initial.id,
      organizationId: org.id,
      actor: "Owner",
      trigger: "manual",
    });
    assert.equal(retry.ok, false);
    assert.equal(retry.httpStatus, 409);
    assert.ok(retry.error);
    assert.match(retry.error!, /cannot be retried/i);
  } finally {
    restoreProviders(previous);
    await cleanupOrg(org.id);
  }
});

test("automatic payslip retry uses backoff after an attempted retry", async () => {
  const previous = snapshotProviders();
  clearProviders();
  process.env.SMTP_URL = "smtp://user:pass@127.0.0.1:1";
  const org = await createOrg("Outbox Backoff Test");

  try {
    const initial = await queueMessage({
      organizationId: org.id,
      recipient: "employee@example.com",
      subject: "Payslip ready",
      body: "Your payslip is ready.",
      purpose: "payslip-ready",
      audit: {
        actor: "Payroll Owner",
        metadata: { runId: 99, employeeId: 789, periodLabel: "Sep 16–30, 2026" },
      },
    });
    assert.equal(initial.status, "failed");

    await db.update(outbox)
      .set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(outbox.id, initial.id));

    const firstDrain = await drainOutboxRetries(10);
    const first = firstDrain.find((item) => item.id === initial.id);
    assert.ok(first);
    assert.equal(first!.retried, true);

    const secondDrain = await drainOutboxRetries(10);
    const second = secondDrain.find((item) => item.id === initial.id);
    assert.ok(second);
    assert.equal(second!.retried, false);
    assert.equal(second!.reason, "backoff");
  } finally {
    restoreProviders(previous);
    await cleanupOrg(org.id);
  }
});

test("worker, scheduler and release route are wired to durable email recovery", () => {
  const worker = readFileSync("scripts/worker.ts", "utf8");
  const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const outboxRoute = readFileSync("src/app/api/outbox/route.ts", "utf8");

  assert.ok(worker.includes("drainOutboxRetries"));
  assert.ok(worker.includes("mailRetries"));
  assert.ok(scheduler.includes('jobName, "delivery-drain"'));
  assert.ok(scheduler.includes("mailRetries"));
  assert.ok(release.includes("noticesSent"));
  assert.ok(release.includes("noticesQueued"));
  assert.ok(release.includes("noticesFailed"));
  assert.ok(release.includes("runId: run.id"));
  assert.ok(release.includes("employeeId: person.id"));
  assert.ok(outboxRoute.includes("recentOutboxWithAttempts"));
  assert.ok(outboxRoute.includes("retryOutboxMessage"));
});
