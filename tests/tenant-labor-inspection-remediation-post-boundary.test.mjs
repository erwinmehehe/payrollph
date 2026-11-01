import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/labor-inspection/route.ts", "utf8");
const post = route.slice(route.indexOf("export async function POST"));
const assign = post.split('if (action === "assign" || action === "acknowledge")')[1]
  .split('if (action === "close")')[0];
const close = post.split('if (action === "close")')[1]
  .split('return Response.json({\n    error: "Unsupported action.')[0];

test("labor inspection POST checks active company-wide role before scoped data reads", () => {
  assert.ok(post.includes("const denied = await requireAccess(user.id, organizationId)"));
  assert.ok(post.indexOf("const denied = await requireAccess(user.id, organizationId)") <
    post.indexOf("const readiness = await buildLaborInspectionReadiness(organizationId)"));
  assert.match(post, /eq\(laborInspectionRemediations\.organizationId, organizationId\)/);
  assert.match(post, /eq\(laborInspectionRemediations\.findingKey, findingKey\)/);
  assert.ok(route.indexOf("export async function GET") < route.indexOf("export async function POST"));
});

test("assign and acknowledge atomically bind final write and audit to employer and observed status", () => {
  assert.ok(assign);
  assert.match(assign, /await db\.transaction\(async \(tx\) =>/);
  assert.match(assign, /await tx\.update\(laborInspectionRemediations\)/);
  assert.match(assign, /await tx\.insert\(laborInspectionRemediations\)/);
  assert.match(assign, /eq\(laborInspectionRemediations\.id, existing\.id\)/);
  assert.match(assign, /eq\(laborInspectionRemediations\.organizationId, organizationId\)/);
  assert.match(assign, /eq\(laborInspectionRemediations\.findingKey, findingKey\)/);
  assert.match(assign, /eq\(laborInspectionRemediations\.status, existing\.status\)/);
  assert.match(assign, /if \(!updated\) throw new Error\("LABOR_INSPECTION_CHANGED"\)/);
  assert.match(assign, /await recordAuditEvent\(\{[\s\S]*?\}, tx\);/);
  assert.doesNotMatch(assign, /await db\.(?:update|insert)\(laborInspectionRemediations\)/);
  assert.match(assign, /status: 409, headers: \{ "Cache-Control": "private, no-store" \}/);
});

test("close is scoped, optimistic, auditable and fails closed on transaction error", () => {
  assert.ok(close);
  assert.match(close, /requireSensitiveActionMfa\(user\)/);
  assert.match(close, /if \(finding\)/);
  assert.match(close, /await db\.transaction\(async \(tx\) =>/);
  assert.match(close, /await tx\.update\(laborInspectionRemediations\)/);
  assert.match(close, /eq\(laborInspectionRemediations\.id, existing\.id\)/);
  assert.match(close, /eq\(laborInspectionRemediations\.organizationId, organizationId\)/);
  assert.match(close, /eq\(laborInspectionRemediations\.findingKey, findingKey\)/);
  assert.match(close, /eq\(laborInspectionRemediations\.status, existing\.status\)/);
  assert.match(close, /if \(!updated\) throw new Error\("LABOR_INSPECTION_CHANGED"\)/);
  assert.match(close, /verification: "finding-no-longer-detected"/);
  assert.match(close, /await recordAuditEvent\(\{[\s\S]*?\}, tx\);/);
  assert.doesNotMatch(close, /await db\.(?:update|insert)\(laborInspectionRemediations\)/);
  assert.match(close, /status: 409, headers: \{ "Cache-Control": "private, no-store" \}/);
});

test("scope stays a no-credit candidate until two-employer real PG16 HTTP proof", () => {
  assert.equal((post.match(/await db\.transaction\(async \(tx\) =>/g) ?? []).length, 2);
  assert.equal((post.match(/\}, tx\);/g) ?? []).length, 2);
  assert.match(post, /Unsupported action\. Use assign, acknowledge, or close\./);
});
