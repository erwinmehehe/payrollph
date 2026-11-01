import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/payout-profiles/route.ts", "utf8");
const script = readFileSync("scripts/qa/tenant-payout-profiles-patch-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-payout-profiles-patch-http.yml", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));

function fnv64(value) {
  let h = 0xcbf29ce484222325n;
  for (const ch of value) h = (h ^ BigInt(ch.charCodeAt(0))) * 0x100000001b3n & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, "0");
}

test("GET payout-profiles remains byte-identical in this PATCH-only hardening", () => {
  const beforePatch = route.split("export async function PATCH")[0];
  assert.equal(beforePatch.length, 4945);
  assert.equal(fnv64(beforePatch), "4417b941777ae2cd",
    "GET and all its historical authorized read behavior must not change");
  assert.equal(createHash("sha1").update(beforePatch).digest("hex").length, 40);
});

test("Payout profile writes and audit are atomic, scoped, and fail closed", () => {
  const patch = route.slice(route.indexOf("export async function PATCH"));
  for (const required of [
    "enforceSameOriginMutation(request)", "getSessionUser()",
    "publicDemoMutationDenied", "requireCompanyAdmin(user.id, organizationId)",
    "requireSensitiveActionMfa(user)", "enforceSensitiveActionRateLimit(request",
    "eq(legalEntities.id, legalEntityId)",
    "eq(legalEntities.organizationId, organizationId)",
    "const saved = await db.transaction(async (tx) => {",
    "const [persisted] = await tx.insert(payoutProfiles)",
    "await recordAuditEvent({",
    "}, tx);", "return persisted;",
    'return Response.json({ error: "Company payout profile could not be saved." }, { status: 500 });',
  ]) assert.ok(patch.includes(required), "Missing payout profile control: " + required);
  assert.ok(patch.indexOf("const saved = await db.transaction") <
    patch.indexOf("await recordAuditEvent({"),
    "The audit insertion must be inside the transaction boundary");
  assert.ok(patch.indexOf("await recordAuditEvent({") <
    patch.indexOf("}, tx);"),
    "The audit writer must use the same transaction");
  assert.ok(!patch.includes("error instanceof Error ? error.message"),
    "Database exception must not be copied into tenant HTTP output");
});

test("PG16 real HTTP candidate proves two own writes, actual foreign denial and rollback", () => {
  for (const required of [
    '["GITHUB_ACTIONS", "true"]',
    '["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"]',
    'for (const actor of [a, b])',
    'exact(await patch(actor, body(actor, actor.marker + " manual profile")), 200',
    'organizationId: victim.org.id', "legalEntityId: victim.entity.id",
    "CREATE TRIGGER ci_reject_payout_profile_audit",
    'assert.deepEqual(await profileSnapshot(a.org.id), originalProfiles',
    'assert.deepEqual(await auditSnapshot(victim.org.id), victimBefore.audit',
    'methodCredits: 0, independentSecurityReview: "PENDING"',
  ]) assert.ok(script.includes(required), "Missing PG16 payout negative test: " + required);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-payout-profiles-patch-http\.mjs/);
  const methods = manifest.allApiRouteFiles["src/app/api/payout-profiles/route.ts"].methods;
  assert.deepEqual(methods.map(m => [m.name, m.status]), [
    ["GET", "COVERED"], ["PATCH", "GAP"],
  ], "Do not borrow prior GET HTTP proof to certify PATCH without independent review");
});
