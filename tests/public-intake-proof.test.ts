import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { issueIntakeProof, verifyIntakeProof, consumeIntakeProof } from "../src/lib/public-intake-proof";
const env = { PUBLIC_INTAKE_PROOF_ENABLED: "true", PUBLIC_INTAKE_PROOF_SECRET: "synthetic-independent-secret-32-bytes" };
const now = Date.parse("2026-10-12T00:00:00Z");
const challenge = issueIntakeProof("buyer@example.test", env, now);
let nonce = 0;
while (!createHash("sha256").update(challenge.token + ":" + nonce).digest("hex").startsWith("0000")) nonce++;
const proof = { token: challenge.token, nonce };
test("signed work verifies only for the bound email, key and unexpired window", () => {
  assert.equal(verifyIntakeProof(proof, "BUYER@example.test", env, now), true);
  assert.equal(verifyIntakeProof(proof, "other@example.test", env, now), false);
  assert.equal(verifyIntakeProof(proof, "buyer@example.test", env, challenge.expires), false);
  assert.equal(verifyIntakeProof({ token: proof.token + "x", nonce }, "buyer@example.test", env, now), false);
  assert.equal(verifyIntakeProof({ token: proof.token, nonce: -1 }, "buyer@example.test", env, now), false);
  assert.equal(verifyIntakeProof(proof, "buyer@example.test", { ...env, PUBLIC_INTAKE_PROOF_SECRET: "other-independent-secret-32-bytes" }, now), false);
});
test("the consumption policy accepts one concurrent claim and rejects replay", async () => {
  const used = new Set<string>();
  const claim = async (id: string) => { const allowed = !used.has(id); used.add(id); return { allowed, mode: "distributed-postgres" }; };
  const attempt = () => consumeIntakeProof({ proof, email: "buyer@example.test", env, now, claim });
  const results = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(results.sort(), ["accepted", "replayed"]);
});
test("flag-off does not claim a counter and an in-memory fallback cannot certify single use", async () => {
  const claim = async () => { throw Error("must not claim"); };
  assert.equal(await consumeIntakeProof({ proof: null, email: "buyer@example.test", env: {}, now, claim }), "disabled");
  assert.equal(await consumeIntakeProof({ proof, email: "buyer@example.test", env, now, claim: async () => ({ allowed: true, mode: "memory" }) }), "unavailable");
});
test("work expires before a replay-counter rollover", () => {
  const boundary = Math.floor(now / 300_000) * 300_000 + 300_000;
  assert.equal(issueIntakeProof("buyer@example.test", env, boundary - 1).expires, boundary);
});
