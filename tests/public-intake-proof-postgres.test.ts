import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { issueIntakeProof, consumeIntakeProof } from "../src/lib/public-intake-proof";

test("two PostgreSQL-backed workers cannot consume the same intake proof", {
  skip: process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true",
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1", "disposable CI service only");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.port, "5432");
  const { rateLimitDistributed } = await import("../src/lib/rate-limit");
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const env = { PUBLIC_INTAKE_PROOF_ENABLED: "true", PUBLIC_INTAKE_PROOF_SECRET: "fictional-postgres-claim-secret-32-bytes" };
  let challenge = issueIntakeProof("fictional@example.test", env);
  let nonce = 0;
  while (!createHash("sha256").update(challenge.token + ":" + nonce).digest("hex").startsWith("0000")) nonce++;
  if (challenge.expires - Date.now() < 2000) {
    // Do not cross the replay window in a timing-dependent acceptance case.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, challenge.expires - Date.now()) + 20));
    challenge = issueIntakeProof("fictional@example.test", env);
    nonce = 0;
    while (!createHash("sha256").update(challenge.token + ":" + nonce).digest("hex").startsWith("0000")) nonce++;
  }
  const bucket = "intake-proof:" + createHash("sha256").update(challenge.token).digest("hex");
  const attempt = () => consumeIntakeProof({ proof: { token: challenge.token, nonce }, email: "fictional@example.test", env,
    claim: hash => rateLimitDistributed("intake-proof:" + hash, { limit: 1, windowMs: 300_000 }) });
  try {
    assert.deepEqual((await Promise.all([attempt(), attempt()])).sort(), ["accepted", "replayed"]);
    assert.equal(await attempt(), "replayed");
  } finally {
    await db.execute(sql`delete from rate_limit_hits where bucket_key = ${bucket}`);
  }
});
