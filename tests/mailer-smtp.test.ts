import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db";
import { outbox } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { queueMessage } from "../src/lib/mailer";

// Regression test for a real gap: activeMailProvider() and deliveryCapable()
// both recognized SMTP_URL and reported the provider as ready, but the actual
// deliver() switch had no "smtp" case, so every SMTP send failed with
// "Provider smtp is not implemented." while /api/readiness claimed the
// adapter was wired. This asserts the failure mode (and success path,
// pending a real network) never regresses to that specific placeholder error.

test("SMTP provider attempts a real send instead of the old 'not implemented' stub", async () => {
  const previous = process.env.SMTP_URL;
  // Deliberately unroutable host — the point is not to reach a mailbox here,
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
