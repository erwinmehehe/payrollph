import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Core 3.2 stores an authoritative one-to-one Separation link", () => {
  const migration = read("drizzle/0059_hcm_term_separation_linkage.sql");
  assert.ok(migration.includes('"separation_record_id" integer REFERENCES "separation_records"("id") ON DELETE restrict'));
  assert.ok(migration.includes("hcm_employment_term_decisions_separation_unique"));
  assert.ok(migration.includes("hcm_employment_term_decision_separation_link_valid"));
  assert.ok(migration.includes('"separation_handoff_started_at" timestamptz'));
  assert.ok(migration.includes('"separation_handoff_completed_at" timestamptz'));
});

test("legacy manual started/completed markers are revalidated back to ready", () => {
  const migration = read("drizzle/0059_hcm_term_separation_linkage.sql");
  assert.ok(migration.includes('"separation_handoff_status" = \'ready\''));
  assert.ok(migration.includes('"separation_handoff_status" IN (\'started\',\'completed\')'));
  assert.ok(migration.includes('"separation_record_id" IS NULL'));
});

test("term decision API no longer allows manual separation handoff state changes", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/route.ts");
  assert.equal(route.includes('"mark_handoff_started"'), false);
  assert.equal(route.includes('"mark_handoff_completed"'), false);
  assert.ok(route.includes('["approve", "cancel", "retry"]'));
  assert.ok(route.includes("handoff state is authoritative evidence from the Separation workflow"));
});

test("Separation POST requires the governed non-renewal handoff when one is ready", () => {
  const route = read("src/app/api/separation/route.ts");
  assert.ok(route.includes("employmentTermDecisionId"));
  assert.ok(route.includes('eq(hcmEmploymentTermDecisions.decisionKind, "non_renew")'));
  assert.ok(route.includes('eq(hcmEmploymentTermDecisions.status, "applied")'));
  assert.ok(route.includes('inArray(hcmEmploymentTermDecisions.separationHandoffStatus, ["ready", "started"])'));
  assert.ok(route.includes("This worker has a ready non-renewal handoff"));
  assert.ok(route.includes("Separation last day must match the approved non-renewal decision"));
  assert.ok(route.includes('separationType !== "end_of_contract"'));
});

test("creating or recomputing the linked Separation package starts the handoff atomically", () => {
  const route = read("src/app/api/separation/route.ts");
  assert.ok(route.includes("separationRecordId: record.id"));
  assert.ok(route.includes('separationHandoffStatus: "started"'));
  assert.ok(route.includes("separationHandoffStartedAt"));
  assert.ok(route.includes("The non-renewal handoff changed before Separation could start."));
  assert.ok(route.includes("employmentTermDecisionId: handoffDecision?.id ?? null"));
});

test("final-pay release completes the exact linked non-renewal handoff", () => {
  const route = read("src/app/api/separation/route.ts");
  assert.ok(route.includes("eq(hcmEmploymentTermDecisions.separationRecordId, fresh.id)"));
  assert.ok(route.includes('linkedTermDecision.separationHandoffStatus !== "started"'));
  assert.ok(route.includes('separationHandoffStatus: "completed"'));
  assert.ok(route.includes("separationHandoffCompletedAt: new Date()"));
  assert.ok(route.includes("The linked non-renewal handoff changed before final-pay release."));
});

test("Core 3.2 does not bypass final-pay approval/release controls", () => {
  const route = read("src/app/api/separation/route.ts");
  assert.ok(route.includes('if (sep.status !== "approved")'));
  assert.ok(route.includes("Final pay must be approved before release."));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("PAYROLL_RELEASE_ROLES"));
  assert.ok(route.includes('status: "Separated"'));
});

test("worker profile exposes ready, started, and completed handoff states", () => {
  const profile = read("src/app/api/hcm/worker-profile/route.ts");
  assert.ok(profile.includes("separationHandoffReady:"));
  assert.ok(profile.includes("separationHandoffStarted:"));
  assert.ok(profile.includes("separationHandoffCompleted:"));
  assert.ok(profile.includes("row.separationRecordId != null"));
});
