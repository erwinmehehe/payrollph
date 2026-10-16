import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";

/**
 * Fictional-only, exact-build HTTP/database acceptance for public intake.
 * Run ONLY against disposable CI PostgreSQL (never a Neon branch or production).
 */
const base = "http://127.0.0.1:3000";
const unavailable = "http://127.0.0.1:3001";
const dbUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(dbUrl.hostname, "127.0.0.1");
assert.equal(dbUrl.port, "5432");
assert.equal(dbUrl.pathname, "/app_db");
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.PUBLIC_INTAKE_PROOF_ENABLED, "true");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const marker = "synthetic-pr917-" + randomBytes(5).toString("hex");
const mail = (suffix: string) => marker + "-" + suffix + "@example.test";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function post(host: string, path: string, payload: unknown, crossSite = false) {
  return fetch(new URL(path, host), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: crossSite ? "https://external.invalid" : host,
      "sec-fetch-site": crossSite ? "cross-site" : "same-origin",
    },
    body: JSON.stringify(payload),
  });
}

async function obtain(host: string, email: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await post(host, "/api/intake-challenge", { email });
    assert.equal(res.status, 200, "challenge endpoint must issue a token");
    assert.match(res.headers.get("cache-control") ?? "", /(?:^|,\s*)no-store(?:,|$)/, "challenge must not be cacheable");
    const challenge = await res.json() as { enabled: boolean; token: string; expires: number; difficulty: number };
    assert.equal(challenge.enabled, true);
    assert.equal(challenge.difficulty, 16);
    assert.ok(typeof challenge.token === "string" && challenge.token.length < 1024);
    assert.ok(!challenge.token.includes(email), "token must not contain plaintext email");
    const remaining = challenge.expires - Date.now();
    if (remaining < 15000) {
      await sleep(Math.max(0, remaining) + 50);
      continue;
    }
    for (let nonce = 0; nonce <= 0xffffffff; nonce++) {
      const digest = createHash("sha256").update(challenge.token + ":" + nonce).digest();
      if (digest[0] === 0 && digest[1] === 0) {
        assert.ok(Date.now() < challenge.expires, "solved work must still be unexpired");
        return { token: challenge.token, nonce };
      }
    }
  }
  throw new Error("Could not obtain an unexpired synthetic challenge");
}

async function leadCount(email: string) {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM marketing_leads WHERE email = $1", [email],
  );
  return result.rows[0]?.count ?? 0;
}

async function main() {
  const demoEmail = mail("demo");
  const wrongEmail = mail("wrong");
  const demo = {
    requestType: "demo", name: "Synthetic Intake QA",
    company: "Synthetic CI Company", email: demoEmail,
    headcount: "7", privacyConsent: true,
    notes: "Fictional acceptance only; do not contact",
  };
  assert.equal((await post(base, "/api/demo-requests", demo, true)).status, 403, "cross-site request");
  assert.equal((await post(base, "/api/demo-requests", demo)).status, 422, "missing proof");
  const work = await obtain(base, demoEmail);
  assert.equal((await post(base, "/api/demo-requests", { ...demo, email: wrongEmail, intakeProof: work })).status, 422, "wrong email");
  const results = await Promise.all([
    post(base, "/api/demo-requests", { ...demo, intakeProof: work }),
    post(base, "/api/demo-requests", { ...demo, intakeProof: work }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 422], "concurrent attempts must accept exactly one");
  const accepted = results.find(r => r.status === 201)!;
  const acceptedPayload = await accepted.text();
  assert.ok(!acceptedPayload.includes(demoEmail) && !acceptedPayload.includes(demo.company), "successful response must not echo PII");
  assert.equal(await leadCount(demoEmail), 1, "exactly one durable marketing lead");
  assert.equal(await leadCount(wrongEmail), 0, "wrong-email request must not persist");

  const hash = createHash("sha256").update(work.token).digest("hex");
  const counters = await pool.query<{ hits: number }>(
    "SELECT hits FROM rate_limit_hits WHERE bucket_key = $1",
    ["intake-proof:" + hash],
  );
  assert.equal(Number(counters.rows[0]?.hits), 2, "two attempts share one atomic PostgreSQL replay bucket");
  const quoteReplay = {
    name: demo.name, email: demoEmail, company: demo.company,
    headcount: "7", privacyConsent: true, intakeProof: work,
  };
  assert.equal((await post(base, "/api/payroll-outsourcing/quote", quoteReplay)).status, 422, "proof cannot be reused across intake routes");
  assert.equal(await leadCount(demoEmail), 1, "cross-route replay must not persist");

  const honeypot = await post(base, "/api/demo-requests", { ...demo, email: mail("honeypot"), website: "http://spam.invalid" });
  assert.equal(honeypot.status, 200, "honeypot should return safe acknowledgement");
  assert.equal((await honeypot.json() as { recorded: boolean }).recorded, false, "honeypot must never persist");

  // The rate limiter has UTC-aligned, fixed one-hour Postgres windows.
  // Earlier CSRF/proof/replay checks can straddle an hour boundary on slow CI
  // jobs; relying on those incidental hits made the sixth-request assertion
  // flaky even though the limiter correctly began a new hourly window.
  //
  // In this *disposable, CI-only PostgreSQL* fixture (validated above), reset
  // only the known synthetic unknown-IP bucket and drive the actual HTTP
  // endpoint five times with missing proof. Each request must be counted and
  // rejected with 422 before a valid sixth request is blocked with 429.
  const testLimiter = "demo-request:unknown";
  const rateWindowMs = 60 * 60 * 1000;
  const msUntilWindowEnd = rateWindowMs - (Date.now() % rateWindowMs);
  if (msUntilWindowEnd < 30_000) await sleep(msUntilWindowEnd + 250);
  // Intake proof itself expires at a five-minute boundary. Obtain it *after*
  // any hour-boundary pause so both the blocked request and the successful
  // post-reset trial use an unexpired, independently valid challenge.
  const trialEmail = mail("trial");
  const trial = {
    ...demo, requestType: "trial-access",
    email: trialEmail, intakeProof: await obtain(base, trialEmail),
  };
  const rateWindow = Math.floor(Date.now() / rateWindowMs);

  await pool.query("DELETE FROM rate_limit_hits WHERE bucket_key = $1", [testLimiter]);
  for (let index = 0; index < 5; index++) {
    const probeEmail = mail(`rate-limit-probe-${index}`);
    const probe = await post(base, "/api/demo-requests", { ...demo, email: probeEmail });
    assert.equal(probe.status, 422, `same-IP probe ${index + 1} must require a valid proof`);
    assert.equal(await leadCount(probeEmail), 0, "invalid-proof probe must never persist");
  }
  assert.equal(Math.floor(Date.now() / rateWindowMs), rateWindow,
    "all five limiter probes must finish within the same fixed hour");
  const fixtureHit = await pool.query<{ hits: number }>(
    "SELECT hits FROM rate_limit_hits WHERE bucket_key = $1 ORDER BY window_start DESC LIMIT 1",
    [testLimiter],
  );
  assert.equal(Number(fixtureHit.rows[0]?.hits), 5,
    "the real distributed limiter must count exactly five same-window HTTP requests");
  const rateLimitedTrial = await post(base, "/api/demo-requests", trial);
  assert.equal(Math.floor(Date.now() / rateWindowMs), rateWindow,
    "valid sixth request must remain in the same fixed hour as the five probes");
  assert.equal(rateLimitedTrial.status, 429,
    "sixth same-IP request must be limited even with a valid proof");
  assert.equal(await leadCount(trialEmail), 0, "rate-limited lead must not persist");
  const exhaustedHit = await pool.query<{ hits: number }>(
    "SELECT hits FROM rate_limit_hits WHERE bucket_key = $1 ORDER BY window_start DESC LIMIT 1",
    [testLimiter],
  );
  assert.equal(Number(exhaustedHit.rows[0]?.hits), 6,
    "blocked sixth request must be counted by the distributed PostgreSQL limiter");
  // Only the isolated CI fixture can reset this synthetic bucket; never
  // clear live staging, production or Neon rate-limit evidence.
  await pool.query("DELETE FROM rate_limit_hits WHERE bucket_key = $1", [testLimiter]);
  assert.equal((await post(base, "/api/demo-requests", trial)).status, 201,
    "trial intake must persist after isolated fixture-rate reset");
  assert.equal(await leadCount(trialEmail), 1);

  const quoteEmail = mail("quote");
  const quote = {
    name: demo.name, company: demo.company, email: quoteEmail,
    headcount: "7", privacyConsent: true,
    intakeProof: await obtain(base, quoteEmail),
  };
  assert.equal((await post(base, "/api/payroll-outsourcing/quote", quote)).status, 201, "quote intake must persist");
  assert.equal(await leadCount(quoteEmail), 1);

  const rows = await pool.query<{ kind: string; purpose: string }>(
    "SELECT kind, attribution->>'privacyConsentPurpose' AS purpose FROM marketing_leads WHERE email = ANY($1::text[]) ORDER BY kind",
    [[demoEmail, trialEmail, quoteEmail]],
  );
  assert.deepEqual(rows.rows.map(r => r.kind), ["demo", "payroll-outsourcing", "trial-access"]);
  assert.ok(rows.rows.every(r => r.purpose === "requested-enquiry-follow-up"), "consent evidence persists");

  const outageEmail = mail("unavailable");
  const unavailableChallenge = await post(unavailable, "/api/intake-challenge", { email: outageEmail });
  assert.equal(unavailableChallenge.status, 503, "challenge issuance must fail closed without PostgreSQL");
  const outageProof = await obtain(base, outageEmail);
  const outageResponse = await post(unavailable, "/api/demo-requests", {
    ...demo, email: outageEmail, intakeProof: outageProof,
  });
  assert.equal(outageResponse.status, 503, "no PostgreSQL replay store must fail closed");
  assert.equal(await leadCount(outageEmail), 0, "unavailable backend must not write a marketing lead");
  console.log("PASS synthetic intake DB HTTP: concurrent replay, cross-route replay, lead persistence, consent, CSRF, honeypot, outage fail-closed");
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Synthetic intake acceptance failed");
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
