import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AUDIT_CHAIN_PROOF_KEYS, auditChainProtectionProven } from "../src/lib/audit-chain-protection-readiness";

const passedProof = () => Object.fromEntries(AUDIT_CHAIN_PROOF_KEYS.map(key => [key, true]));

test("audit chain production readiness requires every distinct verified DB control", () => {
  assert.equal(AUDIT_CHAIN_PROOF_KEYS.length, 11);
  assert.equal(auditChainProtectionProven(passedProof()), true);
  for (const key of AUDIT_CHAIN_PROOF_KEYS) {
    const absent = passedProof();
    delete absent[key];
    assert.equal(auditChainProtectionProven(absent), false, "Missing " + key);
    for (const value of [false, null, "true", 1, undefined]) {
      assert.equal(auditChainProtectionProven({ ...passedProof(), [key]: value }), false, "Unproved " + key);
    }
  }
  assert.equal(auditChainProtectionProven(null), false);
  assert.equal(auditChainProtectionProven([]), false);
});

test("readiness and rollout both fail closed on unverified audit database protection", () => {
  const route = (readFileSync("src/app/api/readiness/route.ts", "utf8") + readFileSync("src/lib/operational-readiness.ts", "utf8"));
  const pilot = readFileSync("src/app/api/readiness/pilot-status/route.ts", "utf8");
  const rollout = readFileSync("scripts/live-production-readiness.ts", "utf8");
  const probe = readFileSync("src/lib/audit-chain-protection-readiness.ts", "utf8");
  assert.match(route, /auditChainRuntimeProtectionReady\(\)/);
  assert.match(route, /key: "audit-chain-protection"/);
  assert.match(route, /blocks: auditChainProtectionReady \? "none" : "launch"/);
  assert.match(pilot, /"audit-chain-protection"/);
  assert.match(rollout, /"audit-chain-protection"/);
  assert.match(probe, /executeAuditRoleProof/);
  assert.doesNotMatch(probe, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\s+(?:TABLE|TRIGGER|FUNCTION|INTO|audit_events)\b/i);
});
