/**
 * WRK-02 demand handoff: pure, fail-closed proof contracts.
 * Source-only. Disposable PostgreSQL 16 + localhost real HTTP; zero credits.
 */
import assert from "node:assert/strict";
import { requireDisposablePlanningEnv } from "./tenant-wfp-allocations-contract.mjs";

export const HANDOFF_PATH = "/api/workforce-planning/demand-handoff";
export const HANDOFF_DATE = "2099-05-20";
export const MANUAL_DATE = "2099-05-22";

export function requireDisposableHandoffEnv(env = process.env) {
  requireDisposablePlanningEnv(env);
  assert.equal(env.REQUIRE_PRIVILEGED_MFA, "true", "HANDOFF_REFUSED: MFA proof required");
  assert.equal(env.TENANT_TABLE_PROFILE, "default", "HANDOFF_REFUSED: isolated default profile required");
  assert.equal(env.XENDIT_BILLING_ENABLED, "false",
    "HANDOFF_REFUSED: connected billing must be disabled in synthetic proof");
  assert.equal(env.HCM_ENTERPRISE_PLAN_GATE_ENABLED, undefined,
    "HANDOFF_REFUSED: never turn on paid planning features in this proof");
  for (const name of ["STRIPE_SECRET_KEY", "BANK_DATA_ENCRYPTION_KEY_PRODUCTION",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY", "SMTP_PASSWORD"]) {
    assert.ok(!env[name], "HANDOFF_REFUSED: provider credential " + name);
  }
}

export function assertDeniedHandoff(response, status, foreignMarkers, label) {
  assert.equal(response.status, status,
    label + ": expected " + status + " got " + response.status + " " +
    String(response.text).slice(0, 180));
  assert.ok(typeof response.text === "string", label + ": real HTTP body is required");
  for (const marker of foreignMarkers) {
    assert.ok(!response.text.includes(marker), label + ": denied response leaked employer marker");
  }
}

export function assertImmutableHandoffState(before, after, label) {
  assert.deepEqual(after, before,
    label + ": protected tenant, staffing, audit, payroll and outbox SQL state changed");
}

export function assertOwnedHandoffWrite({ before, after, actor, response, action,
  headcount, foreignMarkers = [] }) {
  assert.ok(["created", "updated"].includes(action), "Unsupported positive handoff action");
  assert.equal(response.status, 201, actor.marker + ": own real POST must return 201");
  assert.ok(response.json && typeof response.json === "object",
    "Own response must contain parsed real HTTP JSON");
  assert.equal(response.json.plan?.id, actor.planId);
  assert.equal(response.json.plan?.name, actor.planName,
    "Own response must distinguish this employer's real plan");
  assert.equal(response.json.role?.jobProfileId, actor.jobId);
  assert.equal(response.json.role?.title, actor.jobTitle);
  assert.equal(response.json.role?.authorizedHeadcount, 2);
  assert.deepEqual(response.json.role?.positionIds, actor.positionIds);
  assert.equal(response.json.requirements?.length, 1);
  for (const marker of foreignMarkers) {
    assert.ok(!response.text.includes(marker), "Own response must not contain foreign employer data");
  }
  const receipt = response.json.requirements[0];
  assert.equal(receipt.handoffAction, action);
  assert.ok(Number.isSafeInteger(receipt.id) && receipt.id > 0);
  assert.equal(receipt.organizationId, actor.orgId);
  assert.equal(receipt.worksiteId, actor.siteId);
  assert.equal(receipt.jobProfileId, actor.jobId);
  assert.equal(receipt.shiftDefinitionId, actor.shiftId);
  assert.equal(receipt.sourcePlanId, actor.planId);
  assert.equal(receipt.workDate, HANDOFF_DATE);
  assert.equal(receipt.requiredHeadcount, headcount);

  const oldRows = before.staffingRequirements;
  const nextRows = after.staffingRequirements;
  const actual = nextRows.find(row => row.id === receipt.id);
  assert.ok(actual, "HTTP receipt must correspond to the persisted, actual SQL ID");
  assert.equal(actual.organizationId, actor.orgId);
  assert.equal(actual.worksiteId, actor.siteId);
  assert.equal(actual.jobProfileId, actor.jobId);
  assert.equal(actual.shiftDefinitionId, actor.shiftId);
  assert.equal(actual.sourcePlanId, actor.planId);
  assert.equal(actual.sourceType, "hcm_plan");
  assert.equal(actual.workDate, HANDOFF_DATE);
  assert.equal(actual.requiredHeadcount, headcount);
  assert.deepEqual(actual.sourcePositionIds, actor.positionIds);
  assert.equal(actual.notes, "Authorized by workforce plan " + actor.planName);
  assert.equal(actual.sourceHandoffKey,
    ["plan", actor.planId, "site", actor.siteId, "shift", actor.shiftId,
      "role", actor.jobId, "date", HANDOFF_DATE].join(":"));
  assert.equal(receipt.sourceHandoffKey, actual.sourceHandoffKey);
  if (action === "created") {
    assert.equal(nextRows.length, oldRows.length + 1);
    assert.ok(!oldRows.some(row => row.id === actual.id),
      "An existing row cannot count as a newly persisted own insert");
    assert.equal(actual.createdByUserId, actor.ownerId);
    assert.equal(actual.createdBy, actor.ownerName);
  } else {
    assert.equal(nextRows.length, oldRows.length);
    const previous = oldRows.find(row => row.id === actual.id);
    assert.ok(previous, "Update must retain the actual original SQL row ID");
    assert.notEqual(previous.requiredHeadcount, headcount,
      "A no-op cannot count as an update");
    assert.equal(actual.createdByUserId, previous.createdByUserId);
    assert.deepEqual(nextRows.filter(row => row.id !== actual.id),
      oldRows.filter(row => row.id !== actual.id),
      "An update must leave all other real staffing requirements unchanged");
  }

  assert.equal(after.auditEvents.length, before.auditEvents.length + 1);
  assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents,
    "Earlier audit business records cannot change");
  const audit = after.auditEvents.at(-1);
  assert.equal(audit.organizationId, actor.orgId);
  assert.equal(audit.actor, actor.ownerName);
  assert.equal(audit.action, "HCM workforce plan handed to WFM demand");
  const expectedResource = [actor.planName, actor.jobTitle, actor.siteName,
    actor.shiftCode].join(" · ");
  assert.ok(expectedResource.length <= 160,
    "Fictional audit resource must fit the actual audit_events.resource varchar(160)");
  assert.equal(audit.resource, expectedResource,
    "The persisted audit must identify the exact same owned plan/job/site/shift");
  for (const marker of foreignMarkers) {
    assert.ok(!audit.resource.includes(marker),
      "Own audit resource must not include a foreign employer marker");
  }
  assert.equal(audit.metadata?.planId, actor.planId);
  assert.equal(audit.metadata?.jobProfileId, actor.jobId);
  assert.equal(audit.metadata?.worksiteId, actor.siteId);
  assert.equal(audit.metadata?.shiftDefinitionId, actor.shiftId);
  assert.equal(audit.metadata?.requiredHeadcount, headcount);
  assert.deepEqual(audit.metadata?.positionIds, actor.positionIds);
  assert.deepEqual(audit.metadata?.requirementIds, [actual.id]);

  for (const [table, prior] of Object.entries(before)) {
    if (table === "staffingRequirements" || table === "auditEvents") continue;
    assert.deepEqual(after[table], prior,
      actor.marker + ": handoff must not mutate unrelated " + table);
  }
  return actual.id;
}
