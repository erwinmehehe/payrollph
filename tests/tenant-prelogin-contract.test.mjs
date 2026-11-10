import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import test from "node:test";
import {
  assertRefusal, assertRowsUnchanged, clientAddresses, mailedTokens, requireDisposablePrelogin, solveIntakeProof,
} from "../scripts/qa/tenant-prelogin-contract.mjs";
import { PRELOGIN_SMTP_HOST, PRELOGIN_SMTP_PORT, startPreloginSmtpSink } from "../scripts/qa/tenant-prelogin-smtp-sink.mjs";

const SAFE = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true", TENANT_PRELOGIN_MODE: "fictional-pg16-http", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  NODE_ENV: "production", DEMO_MODE: "false", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db", APP_BASE_URL: "https://payroll.example.test",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false", SMTP_URL: "smtp://127.0.0.1:2525",
  PUBLIC_SIGNUP_MODE: "pilot", PUBLIC_INTAKE_PROOF_ENABLED: "true",
  PUBLIC_INTAKE_PROOF_SECRET: "a".repeat(64), TRUSTED_PROXY_HOPS: "1", SETUP_TOKEN: "ci-setup-token",
});

test("the pre-login proof refuses every environment that could reach a real service or skip a control", () => {
  assert.equal(requireDisposablePrelogin({ ...SAFE }), true);
  const unsafe = {
    "not CI": { GITHUB_ACTIONS: "false" },
    "wrong mode": { TENANT_PRELOGIN_MODE: "other" },
    "development build": { NODE_ENV: "development" },
    "demo mode": { DEMO_MODE: "true" },
    "non-loopback app": { SECURITY_SMOKE_URL: "http://example.com:3000" },
    "non-disposable database": { DATABASE_URL: "postgresql://postgres:postgres@db.example.com:5432/app_db" },
    "other database name": { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/payroll" },
    "payouts on": { XENDIT_PAYOUTS_ENABLED: "true" },
    "billing on": { XENDIT_BILLING_ENABLED: "true" },
    "worker on": { WORKER_ENABLED: "true" },
    "payment key present": { PAYMONGO_SECRET_KEY: "sk_live_x" },
    "real mail provider": { RESEND_API_KEY: "re_live_x" },
    "postmark provider": { POSTMARK_SERVER_TOKEN: "pm_live_x" },
    "non-loopback smtp": { SMTP_URL: "smtp://mail.example.com:25" },
    "paid signup": { PUBLIC_SIGNUP_MODE: "paid" },
    "intake proof off": { PUBLIC_INTAKE_PROOF_ENABLED: "false" },
    "weak proof secret": { PUBLIC_INTAKE_PROOF_SECRET: "short" },
    "invite bypass on": { PRIVATE_PILOT_INVITE_ENABLED: "true" },
    "no proxy hops": { TRUSTED_PROXY_HOPS: "" },
    "vercel": { VERCEL: "1" },
    "no setup token": { SETUP_TOKEN: "" },
    "http app origin": { APP_BASE_URL: "http://payroll.example.test" },
  };
  for (const [label, override] of Object.entries(unsafe)) {
    assert.throws(() => requireDisposablePrelogin({ ...SAFE, ...override }), /PRELOGIN_PROOF_REFUSED/, label + " must be refused");
  }
});

test("the intake proof is solved the way a browser solves it", () => {
  const token = "eyJ0ZXN0IjoxfQ." + "b".repeat(64);
  const nonce = solveIntakeProof(token);
  assert.ok(Number.isSafeInteger(nonce) && nonce >= 0);
  assert.ok(createHash("sha256").update(token + ":" + nonce).digest("hex").startsWith("0000"));
  assert.throws(() => solveIntakeProof("no-dot-here"), /issued intake token/);
});

test("verification links are read only from the recipient's own mail and only in the exact link shape", () => {
  const token = "0123456789abcdef".repeat(3);
  const mail = (recipients, data) => ({ receivedAt: "2026-01-01T00:00:00Z", from: "<a@b>", recipients, data });
  const inbox = [
    mail(["alice@example.invalid"], "Hello\r\nhttps://payroll.example.test/verify-signup?token=" + token + "\r\nbye"),
    mail(["alice@example.invalid"], "wrapped https://payroll.example.test/verify-signup?token=3D" + token.slice(0, 20) + "=\r\n" + token.slice(20) + "\r\n"),
    mail(["bob@example.invalid"], "https://payroll.example.test/verify-signup?token=" + "f".repeat(48)),
    mail(["alice@example.invalid", "bob@example.invalid"], "https://payroll.example.test/verify-signup?token=" + "e".repeat(48)),
    mail(["alice@example.invalid"], "no link here"),
  ];
  assert.deepEqual(mailedTokens(inbox, "ALICE@example.invalid"), [token, token], "quoted-printable wrapping is undone; case is ignored");
  assert.deepEqual(mailedTokens(inbox, "bob@example.invalid"), ["f".repeat(48)], "a multi-recipient message is never trusted as one recipient's link");
  assert.deepEqual(mailedTokens(inbox, "carol@example.invalid"), []);
});

test("the loopback mail sink stores a message before acknowledging it and binds loopback only", async () => {
  const inbox = [];
  const server = await startPreloginSmtpSink(inbox);
  try {
    assert.equal(server.address().address, PRELOGIN_SMTP_HOST, "the sink must listen on loopback only");
    assert.equal(server.address().port, PRELOGIN_SMTP_PORT);
    const transcript = await new Promise((resolve, reject) => {
      const socket = net.connect(PRELOGIN_SMTP_PORT, PRELOGIN_SMTP_HOST);
      const script = ["EHLO test", "MAIL FROM:<no-reply@linaw.ph>", "RCPT TO:<Dana@Example.invalid>", "DATA",
        "Subject: hi\r\n\r\nhttps://payroll.example.test/verify-signup?token=" + "a".repeat(48) + "\r\n.", "QUIT"];
      let seen = "", step = 0;
      socket.setEncoding("utf8");
      // One command per server reply (the greeting counts as the first reply) keeps the exchange deterministic.
      socket.on("data", (chunk) => {
        seen += chunk;
        if (seen.includes("221 bye")) { socket.end(); resolve(seen); return; }
        if (step < script.length) socket.write(script[step++] + "\r\n");
      });
      socket.on("error", reject);
    });
    assert.match(transcript, /250 stored/);
    assert.equal(inbox.length, 1);
    assert.deepEqual(inbox[0].recipients, ["dana@example.invalid"]);
    assert.deepEqual(mailedTokens(inbox, "dana@example.invalid"), ["a".repeat(48)]);
    assert.throws(() => startPreloginSmtpSink("not-an-array"), /in-memory inbox array is required/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("client addresses are distinct documentation-range values", () => {
  const next = clientAddresses();
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const address = next();
    assert.match(address, /^(198\.51\.100|203\.0\.113)\.\d+$/);
    assert.ok(!seen.has(address));
    seen.add(address);
  }
});

test("refusal and snapshot helpers fail closed", () => {
  const response = (status, text) => ({ status, text, json: null, headers: new Map() });
  assert.doesNotThrow(() => assertRefusal(response(401, "denied"), 401, ["VICTIM"]));
  assert.throws(() => assertRefusal(response(200, "ok"), 401), /incorrect refusal status/);
  assert.throws(() => assertRefusal(response(403, "leak VICTIM-1"), 403, ["VICTIM-1"]), /leaked/);
  assert.throws(() => assertRefusal(response(403, "x"), 403, [""]), /missing forbidden marker/);
  assert.doesNotThrow(() => assertRowsUnchanged({ t: [{ a: 1 }] }, { t: [{ a: 1 }] }, "same"));
  assert.throws(() => assertRowsUnchanged({ t: [{ a: 1 }] }, { t: [{ a: 2 }] }, "changed"), /changed/);
  assert.throws(() => assertRowsUnchanged({ t: [] }, { t: [], u: [] }, "extra table"), /table set changed/);
});

test("the pre-login proof is additive, two-applicant, higher-ID, mailbox-sourced and zero-credit", () => {
  const runner = readFileSync("scripts/qa/tenant-prelogin-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-prelogin-http.yml", "utf8");
  for (const token of [
    "requireDisposablePrelogin();", "genuinely empty disposable users required", "const a = applicant(\"A\"), b = applicant(\"B\");",
    "const victim = await seedEmployer(\"VICTIM\", nonce, standaloneMakeSession);",
    "victim.org.id > Math.max(registeredA.org.id, 6)", "for (let pad = 0; pad < 6; pad++)",
    "organizationId: victim.org.id, userId: victim.owner.id, role: \"admin\", active: true", "plan: \"Enterprise\", seats: 2000",
    "mailedTokens(MAIL, who.email)", "const sink = await startPreloginSmtpSink(MAIL);", "a forged organization ID never attaches an applicant to an existing employer",
    "a forged plan is ignored in pilot mode", "forged seats and plan cannot buy or enlarge a subscription",
    "the verified owner is active", "the session belongs to the verified owner, never to a forged user ID",
    "The link is single-use.", "resend must answer identically for an unknown, a verified and a foreign address",
    "A registered address cannot be re-registered", "Setup is single-use", "every refused setup attempt must leave the instance empty",
    "assertRowsUnchanged(victimBefore, await snapshot(victim)", "assertRowsUnchanged(bootBefore, await snapshot(boot)",
    "knownFindingsNotClosedByThisProof", "coverageCredits: 0", "independentlyAccepted: false", "paidEnrollmentExercised: false",
  ]) assert.ok(runner.includes(token), "Missing pre-login proof control: " + token);
  for (const forbidden of ["secrets.", "RESEND_API_KEY: ${{", "PAYMONGO_SECRET_KEY: ${{"])
    assert.ok(!workflow.includes(forbidden), "the proof workflow must hold no secret: " + forbidden);
  for (const token of ["image: postgres:16", "SMTP_URL=smtp://127.0.0.1:2525", "PUBLIC_SIGNUP_MODE=pilot", "TRUSTED_PROXY_HOPS=1",
    "node --import tsx scripts/qa/tenant-prelogin-http.mjs", "node --test tests/tenant-prelogin-contract.test.mjs",
    "tenant-prelogin-smtp-sink.mjs", "XENDIT_PAYOUTS_ENABLED=false", "WORKER_ENABLED=false"])
    assert.ok(workflow.includes(token), "workflow lacks " + token);
});
