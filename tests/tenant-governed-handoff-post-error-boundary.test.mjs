import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/governed-handoffs/route.ts", "utf8");
const post = route.split("export async function POST")[1];

test("Governed handoff POST does not disclose internal approval-chain or SQL errors", () => {
  assert.ok(post.includes('code: "GOVERNED_HANDOFF_UNAVAILABLE"'));
  assert.ok(post.includes('"Cache-Control": "private, no-store"'));
  assert.ok(!post.includes("error instanceof Error ? error.message"));
  assert.ok(post.includes("} catch {"));
});

test("Governed handoff POST retains employer, unit, MFA and source-hash binding", () => {
  for (const token of [
    "enforceSameOriginMutation(request)", "getSessionUser()",
    "publicDemoMutationDenied(", "authorizeHandoff(user.id, organizationId, sourceType)",
    "requireSensitiveActionMfa(user)", "enforceSensitiveActionRateLimit(request",
    "eq(approvalChainPolicies.organizationId, organizationId)",
    "eq(approvalChainPolicies.active, true)",
    "loadGovernedHandoffSource({ organizationId, sourceId, sourceType })",
    "assertScope(auth.access!, source.orgUnitId)",
    "governedHandoffSourceKey(sourceId, source.sourceHash)",
    "createApprovalFromConfiguredChain({",
  ]) assert.ok(post.includes(token), "Missing handoff source guard: " + token);
});
