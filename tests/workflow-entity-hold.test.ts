import assert from "node:assert/strict";
import test from "node:test";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { workflowEntityHold } from "../src/lib/workflow-entity-hold";
import { resolveWorkflowUiFlags } from "../src/lib/workflow-ui-flags";

test("legacy workflow hold is strict flag-on, fail-closed, private and never grants access", async () => {
  for (const value of [undefined, "", "false", "TRUE", "true ", "1"]) {
    assert.equal(workflowEntityHold({ MULTI_ENTITY_ENABLED: value }), null);
  }
  const hold = workflowEntityHold({ MULTI_ENTITY_ENABLED: "true" });
  assert.ok(hold);
  assert.equal(hold.status, 403);
  assert.equal(hold.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await hold.json()).code, "ENTITY_WORKFLOW_DEFERRED");
});

test("advisory workflow flag never accidentally enables canonical first-payroll engine UI", () => {
  const canonical = { FIRST_PAYROLL_INLINE_ENABLED: "true" };
  assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", canonical), true);
  assert.equal(criticalReleaseFlagEnabled("workflowFirstPayrollAdvisory", canonical), false);
  const draft = { FIRST_PAYROLL_INLINE_UI_ENABLED: "true" };
  assert.equal(criticalReleaseFlagEnabled("workflowFirstPayrollAdvisory", draft), true);
  assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", draft), false);
  const both = { ...canonical, ...draft };
  assert.equal(criticalReleaseFlagEnabled("firstPayrollInline", both), true);
  assert.equal(criticalReleaseFlagEnabled("workflowFirstPayrollAdvisory", both), true);
});

test("all new unscoped draft APIs deny multi-entity reads and writes before DB/user/agency access", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const previous = Object.fromEntries([
    "MULTI_ENTITY_ENABLED",
    "FIRST_PAYROLL_INLINE_UI_ENABLED",
    "FACE_OFFLINE_PUNCH_UI_ENABLED",
    "RECRUITMENT_JOURNEY_UI_ENABLED",
    "REPORT_BUILDER_UI_ENABLED",
  ].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    MULTI_ENTITY_ENABLED: "true",
    FIRST_PAYROLL_INLINE_UI_ENABLED: "true",
    FACE_OFFLINE_PUNCH_UI_ENABLED: "true",
    RECRUITMENT_JOURNEY_UI_ENABLED: "true",
    REPORT_BUILDER_UI_ENABLED: "true",
  });
  try {
    const [handoff, attendance, publicCareers, adminCareers, saved] = await Promise.all([
      import("../src/app/api/first-payroll/handoffs/route"),
      import("../src/app/api/attendance/offline-claims/route"),
      import("../src/app/api/careers/route"),
      import("../src/app/api/careers/admin/route"),
      import("../src/app/api/report-builder/saved/route"),
    ]);
    const all = [
      ["handoff POST", handoff.POST],
      ["attendance GET", attendance.GET],
      ["attendance POST", attendance.POST],
      ["attendance PATCH", attendance.PATCH],
      ["public careers GET", publicCareers.GET],
      ["public careers POST", publicCareers.POST],
      ["admin careers PATCH", adminCareers.PATCH],
      ["saved reports GET", saved.GET],
      ["saved reports POST", saved.POST],
      ["saved reports PATCH", saved.PATCH],
      ["saved reports DELETE", saved.DELETE],
    ] as const;
    for (const [name, action] of all) {
      const method = name.split(" ").at(-1)!;
      const response = await action(new Request("https://example.test/api/draft?organizationId=1", {
        method,
        ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }),
      }));
      assert.equal(response.status, 403, name);
      const json = await response.json();
      assert.equal(json.code, "ENTITY_WORKFLOW_DEFERRED", name);
      assert.ok(!JSON.stringify(json).includes("TIN"), name);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test("all nine remaining draft UI controls disappear in multi-entity mode", () => {
  const flags = {
    FIRST_PAYROLL_INLINE_UI_ENABLED: "true", IMPORT_REVIEW_UI_ENABLED: "true",
    CORE_ONLY_NAV_UI_ENABLED: "true", FACE_OFFLINE_PUNCH_UI_ENABLED: "true",
    ROSTER_PUBLISH_UI_ENABLED: "true", APPROVAL_BUILDER_UI_ENABLED: "true",
    REPORT_BUILDER_UI_ENABLED: "true", BENEFITS_LOANS_UI_ENABLED: "true",
    RECRUITMENT_JOURNEY_UI_ENABLED: "true",
  };
  const legacy = resolveWorkflowUiFlags({ ...flags, MULTI_ENTITY_ENABLED: "false" });
  assert.ok(Object.values(legacy).every(Boolean));
  const entityScoped = resolveWorkflowUiFlags({ ...flags, MULTI_ENTITY_ENABLED: "true" });
  assert.ok(Object.values(entityScoped).every(value => value === false));
  assert.equal(Object.keys(entityScoped).length, 9);
});
