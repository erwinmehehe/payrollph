import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HCM_LIFECYCLE_POLICY,
  parseHcmLifecyclePolicyInput,
} from "../src/lib/hcm-lifecycle-policy";
import { buildEmploymentLifecycleRow } from "../src/lib/hcm-lifecycle-readiness";
import { lifecycleSignalForRow } from "../src/lib/hcm-lifecycle-notifications";

const read = (path: string) => readFileSync(path, "utf8");

function baseLifecycleInput(daysFromToday: number) {
  const today = new Date("2026-10-06T00:00:00Z");
  const due = new Date(today);
  due.setUTCDate(due.getUTCDate() + daysFromToday);
  return {
    employeeId: 10,
    employeeNo: "EMP-010",
    employeeName: "Ana Santos",
    employeeStatus: "Active",
    term: {
      id: 44,
      termKind: "probationary",
      employmentType: "Probationary",
      effectiveFrom: "2026-05-01",
      probationReviewDate: due.toISOString().slice(0, 10),
      status: "active",
    },
    decision: null,
    separation: null,
    today: "2026-10-06",
  } as any;
}

test("Core 3.7 defaults preserve the existing 30-day lifecycle behavior", () => {
  assert.deepEqual(DEFAULT_HCM_LIFECYCLE_POLICY, {
    actionWindowDays: 30,
    reminderDays: [30, 14, 7, 1, 0],
    overdueEscalationDays: [1, 5],
    requireManagerReviewForProbation: false,
    requireDecisionRationaleNote: false,
    requireNonRenewalAttachment: false,
  });

  const within = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(30),
    actionWindowDays: DEFAULT_HCM_LIFECYCLE_POLICY.actionWindowDays,
  });
  const outside = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(31),
    actionWindowDays: DEFAULT_HCM_LIFECYCLE_POLICY.actionWindowDays,
  });
  assert.equal(within.state, "upcoming");
  assert.equal(outside.state, "clear");
});

test("custom action windows change when lifecycle dates enter the action center", () => {
  const fortyFive = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(40),
    actionWindowDays: 45,
  });
  const thirty = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(40),
    actionWindowDays: 30,
  });
  assert.equal(fortyFive.state, "upcoming");
  assert.equal(thirty.state, "clear");
  assert.match(thirty.detail, /30-day action window/);
});

test("custom reminder milestones and overdue thresholds drive notification stages", () => {
  const row = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(20),
    actionWindowDays: 45,
  }) as any;
  const policy = {
    ...DEFAULT_HCM_LIFECYCLE_POLICY,
    actionWindowDays: 45,
    reminderDays: [45, 10, 2, 0],
    overdueEscalationDays: [2, 8] as [number, number],
  };
  assert.equal(lifecycleSignalForRow(row, policy)?.stage, "t45");

  const near = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(9),
    actionWindowDays: 45,
  }) as any;
  assert.equal(lifecycleSignalForRow(near, policy)?.stage, "t10");

  const tooEarly = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(50),
    actionWindowDays: 60,
  }) as any;
  assert.equal(lifecycleSignalForRow(tooEarly, policy), null);

  const overdueOne = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(-1),
    actionWindowDays: 45,
  }) as any;
  assert.equal(lifecycleSignalForRow(overdueOne, policy)?.escalationStage, 1);

  const overdueThree = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(-3),
    actionWindowDays: 45,
  }) as any;
  assert.equal(lifecycleSignalForRow(overdueThree, policy)?.escalationStage, 2);

  const overdueNine = buildEmploymentLifecycleRow({
    ...baseLifecycleInput(-9),
    actionWindowDays: 45,
  }) as any;
  assert.equal(lifecycleSignalForRow(overdueNine, policy)?.escalationStage, 3);
});

test("policy parser enforces bounded windows, due-date reminders, and ordered escalation thresholds", () => {
  const valid = parseHcmLifecyclePolicyInput({
    actionWindowDays: 45,
    reminderDays: [45, 14, 7, 1, 0],
    overdueEscalationDays: [2, 8],
    requireManagerReviewForProbation: true,
    requireDecisionRationaleNote: true,
    requireNonRenewalAttachment: false,
  });
  assert.equal(valid.actionWindowDays, 45);
  assert.deepEqual(valid.reminderDays, [45, 14, 7, 1, 0]);
  assert.deepEqual(valid.overdueEscalationDays, [2, 8]);

  assert.throws(() => parseHcmLifecyclePolicyInput({ ...valid, actionWindowDays: 5 }), /between 7 and 90 days/);
  assert.throws(() => parseHcmLifecyclePolicyInput({ ...valid, reminderDays: [45, 14, 7, 1] }), /must include 0/);
  assert.throws(() => parseHcmLifecyclePolicyInput({ ...valid, reminderDays: [60, 14, 7, 1, 0] }), /between 0 and the lifecycle action window/);
  assert.throws(() => parseHcmLifecyclePolicyInput({ ...valid, overdueEscalationDays: [5, 5] }), /two increasing values/);
});

test("Core 3.7 migration creates one versioned organization policy and immutable change events", () => {
  const migration = read("drizzle/0063_hcm_lifecycle_policy.sql");
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_lifecycle_policies"'));
  assert.ok(migration.includes('"action_window_days" integer NOT NULL DEFAULT 30'));
  assert.ok(migration.includes('"reminder_days" jsonb NOT NULL DEFAULT'));
  assert.ok(migration.includes("[30,14,7,1,0]"));
  assert.ok(migration.includes('"overdue_escalation_days" jsonb NOT NULL DEFAULT'));
  assert.ok(migration.includes("[1,5]"));
  assert.ok(migration.includes('"require_manager_review_for_probation" boolean NOT NULL DEFAULT false'));
  assert.ok(migration.includes('"require_decision_rationale_note" boolean NOT NULL DEFAULT false'));
  assert.ok(migration.includes('"require_non_renewal_attachment" boolean NOT NULL DEFAULT false'));
  assert.ok(migration.includes("hcm_lifecycle_policies_org_unique"));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "hcm_lifecycle_policy_events"'));
  assert.ok(migration.includes('"before_snapshot" jsonb'));
  assert.ok(migration.includes('"after_snapshot" jsonb NOT NULL'));
});

test("policy persistence uses optimistic version checks and append-only snapshots", () => {
  const source = read("src/lib/hcm-lifecycle-policy.ts");
  assert.ok(source.includes("expectedVersion"));
  assert.ok(source.includes("existing.version !== input.expectedVersion"));
  assert.ok(source.includes("eq(hcmLifecyclePolicies.version, input.expectedVersion)"));
  assert.ok(source.includes("HcmLifecyclePolicyConflictError"));
  assert.ok(source.includes('eventType: "created"'));
  assert.ok(source.includes('eventType: "updated"'));
  assert.ok(source.includes("beforeSnapshot"));
  assert.ok(source.includes("afterSnapshot"));
});

test("policy API is company-wide, MFA-protected, same-origin, rate-limited, and audited", () => {
  const route = read("src/app/api/hcm/lifecycle-policy/route.ts");
  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("access?.companyWide"));
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("requireSensitiveActionMfa"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit"));
  assert.ok(route.includes("POLICY_VERSION_CONFLICT"));
  assert.ok(route.includes('action: "HCM lifecycle policy updated"'));
});

test("readiness and notification engines consume the persisted organization policy", () => {
  const readiness = read("src/lib/hcm-lifecycle-readiness-server.ts");
  const notifications = read("src/lib/hcm-lifecycle-notifications.ts");
  assert.ok(readiness.includes("loadHcmLifecyclePolicy"));
  assert.ok(readiness.includes("actionWindowDays: policy.actionWindowDays"));
  assert.ok(readiness.includes("policy,"));
  assert.ok(notifications.includes("readiness.policy"));
  assert.ok(notifications.includes("policy.reminderDays"));
  assert.ok(notifications.includes("policy.overdueEscalationDays"));
});

test("optional evidence controls are enforced inside the existing sealed approval transaction", () => {
  const evidence = read("src/lib/hcm-employment-decision-evidence.ts");
  assert.ok(evidence.includes("hcmLifecyclePolicies"));
  assert.ok(evidence.includes("requireManagerReviewForProbation"));
  assert.ok(evidence.includes('note.noteKind === "manager_review"'));
  assert.ok(evidence.includes("requireDecisionRationaleNote"));
  assert.ok(evidence.includes('note.noteKind === "decision_rationale"'));
  assert.ok(evidence.includes("requireNonRenewalAttachment"));
  assert.ok(evidence.includes('decision.decisionKind === "non_renew"'));
  assert.ok(evidence.includes("attachments.length === 0"));
  assert.ok(evidence.includes("lifecyclePolicyVersion"));
});

test("People UI exposes policy controls and removes fixed 30-day reminder copy", () => {
  const people = read("src/components/workspace/people.tsx");
  const panel = read("src/components/hcm-lifecycle-policy-panel.tsx");
  const actionCenter = read("src/components/hcm-employment-lifecycle-action-center.tsx");
  const inbox = read("src/components/hcm-lifecycle-notification-inbox.tsx");

  assert.ok(people.includes("HcmLifecyclePolicyPanel"));
  assert.ok(panel.includes("Employment lifecycle governance policy"));
  assert.ok(panel.includes("Action window (days)"));
  assert.ok(panel.includes("Reminder milestones"));
  assert.ok(panel.includes("Overdue escalation thresholds"));
  assert.ok(panel.includes("organization-defined workflow controls"));
  assert.ok(actionCenter.includes("payload.policy.actionWindowDays"));
  assert.equal(inbox.includes("T-30, T-14, T-7, T-1"), false);
});

test("Core 3.7 policy does not create automatic employment-state authority", () => {
  const source = read("src/lib/hcm-lifecycle-policy.ts");
  const route = read("src/app/api/hcm/lifecycle-policy/route.ts");
  assert.equal(source.includes('status: "Separated"'), false);
  assert.equal(source.includes("activateEmploymentTerm"), false);
  assert.equal(source.includes("applyEmploymentTermDecision"), false);
  assert.equal(route.includes('status: "Separated"'), false);
  assert.equal(route.includes("activateEmploymentTerm"), false);
});
