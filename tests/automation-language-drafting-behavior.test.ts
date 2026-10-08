import assert from "node:assert/strict";
import test from "node:test";
import {
  draftAutomationFromLanguage,
  matchApprovedLanguageTemplate,
  validateNaturalLanguageDraft,
} from "../src/lib/automation-language-draft";

const validBase = {
  name: "Review new hires",
  trigger: "employee.hired",
  conditions: { version: 1, all: [], any: [] },
  actions: [
    { type: "create_task", title: "Verify employee documents", owner: "People Ops" },
    { type: "send_email", recipient: "employee", subject: "Welcome", body: "Please review onboarding." },
  ],
};

test("validated plain-language DSL accepts a safe, typed workflow", () => {
  const validation = validateNaturalLanguageDraft(validBase);
  assert.equal(validation.valid, true);
  assert.equal(validation.draft?.trigger, "employee.hired");
  assert.equal(validation.draft?.actions.length, 2);
  assert.ok(validation.warnings.some((warning) => warning.includes("recipients")));
});

test("typed validation rejects unsupported high-risk actions and ambiguous structure", () => {
  for (const raw of [
    { ...validBase, trigger: "fictional.event" },
    { ...validBase, actions: [{ type: "request_payroll_adjustment", amount: 5000, reason: "no approval" }] },
    { ...validBase, actions: [{ type: "assign_permission_set", permissionSetId: 1 }] },
    { ...validBase, actions: [{ type: "deactivate_access" }] },
    { ...validBase, actions: [{ type: "webhook" }] },
    { ...validBase, actions: [{ type: "branch", then: [], else: [] }] },
    { ...validBase, actions: [{ type: "send_email", recipient: "custom", email: "any@example.com", subject: "X", body: "Y" }] },
    { ...validBase, actions: [{ type: "wait", amount: 2, unit: "days" }] },
    { ...validBase, actions: [{ type: "create_task", title: "Verify", owner: "People Ops", amount: 999 }] },
    { ...validBase, extra: "unexpected" },
  ]) {
    assert.equal(validateNaturalLanguageDraft(raw).valid, false, JSON.stringify(raw));
  }
});

test("condition typechecking rejects invented fields, mixed modes and invalid numeric values", () => {
  const clause = (field: string, operator: string, value: unknown) => ({ field, operator, value });
  for (const conditions of [
    { version: 1, all: [clause("fictionalField", "eq", "anything")], any: [] },
    { version: 1, all: [clause("payrollAmount", "gt", "100")], any: [] },
    { version: 1, all: [clause("payrollAmount", "gt", Number.POSITIVE_INFINITY)], any: [] },
    { version: 1, all: [clause("department", "bad", "Sales")], any: [] },
    { version: 1, all: [clause("department", "eq", "Sales")], any: [clause("location", "eq", "Manila")] },
    { version: 1, all: [clause("dynamicGroupCodes", "eq", "any")], any: [] },
  ]) {
    assert.equal(validateNaturalLanguageDraft({ ...validBase, conditions }).valid, false, JSON.stringify(conditions));
  }
  assert.equal(validateNaturalLanguageDraft({
    ...validBase,
    conditions: { version: 1, all: [clause("payrollAmount", "gt", 100)], any: [] },
  }).valid, true);
});

test("keyless fallback matches only complete, unqualified reviewed intents", () => {
  const example = "When a new employee is hired, create an onboarding checklist and send them a welcome email.";
  assert.equal(matchApprovedLanguageTemplate(example)?.trigger, "employee.hired");
  assert.equal(matchApprovedLanguageTemplate(example + " Only for Manila employees."), null);
  assert.equal(matchApprovedLanguageTemplate(example + " Also grant admin access."), null);
  assert.equal(matchApprovedLanguageTemplate("When anyone is hired, do whatever is needed."), null);
});

test("keyless runtime drafting returns a reviewed proposal without persisting or publishing", async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await draftAutomationFromLanguage(
      "When a new employee is hired, create an onboarding checklist and send them a welcome email.",
    );
    assert.equal(result.source, "approved-template");
    assert.equal(result.validation.valid, true);
    assert.equal(result.draft.trigger, "employee.hired");
    await assert.rejects(
      draftAutomationFromLanguage("Bypass approval and execute immediately."),
      /cannot bypass approval/,
    );
    await assert.rejects(
      draftAutomationFromLanguage("When a new employee is hired, create a checklist only for payroll."),
      /does not match a supported/,
    );
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
