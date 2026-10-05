import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("rollout readiness is authenticated and does not expose deployment secrets or global counts", () => {
  const route = read("src/app/api/readiness/workspace/route.ts");
  assert.ok(route.includes("getSessionUser"));
  assert.ok(route.includes("ORG_ADMIN_ROLES"));
  assert.ok(route.includes("company-wide access"));
  assert.ok(route.includes("buildReadinessPayload"));
  assert.ok(route.includes("manualWorkaround"));
  assert.equal(route.includes("counts:"), false);
  assert.equal(route.includes("READINESS_TOKEN"), false);
  assert.equal(route.includes("TOTP_ENCRYPTION_KEY"), false);
});

test("workspace readiness separates launch proof from scale gaps", () => {
  const panel = read("src/components/workspace/launch-readiness-panel.tsx");
  assert.ok(panel.includes("Prove launch, don’t infer it."));
  assert.ok(panel.includes('gate.blocks === "launch"'));
  assert.ok(panel.includes('gate.blocks === "scale"'));
  assert.ok(panel.includes("Controlled pilot path:"));
  assert.ok(panel.includes("external or operational proof still missing"));
});

test("readiness is a managed workspace destination and excluded from freelancer access", () => {
  const nav = read("src/components/workspace/nav.ts");
  const workspace = read("src/components/linaw-workspace.tsx");
  const roles = read("src/lib/workspace-role-ui.ts");
  assert.ok(nav.includes('{ name: "Readiness"'));
  assert.ok(nav.includes('"Readiness",'));
  assert.ok(workspace.includes("LaunchReadinessPanel"));
  assert.ok(workspace.includes('page === "Readiness"'));
  assert.ok(roles.includes('"Readiness"'));
});
