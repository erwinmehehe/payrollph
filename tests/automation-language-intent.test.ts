import assert from "node:assert/strict";
import test from "node:test";
import {
  containsUnsupportedLanguageEffect,
  validateRequestedLanguageIntent,
} from "../src/lib/automation-language-intent";
import type { TypedAutomationLanguageDraft } from "../src/lib/automation-language-draft";

const onboarding: TypedAutomationLanguageDraft = {
  name: "New hire welcome",
  trigger: "employee.hired",
  conditions: { version: 1, all: [], any: [] },
  actions: [
    { type: "create_onboarding_checklist", items: [{ title: "Check documents", owner: "People Ops", kind: "automation" }] },
    { type: "send_email", recipient: "employee", subject: "Welcome", body: "Your onboarding steps are ready." },
  ],
};
const newHirePrompt = "When a new employee is hired, create an onboarding checklist and send them a welcome email.";

test("preserves multiple requested steps and exact recipient instead of trusting typed JSON alone", () => {
  assert.deepEqual(validateRequestedLanguageIntent(newHirePrompt, onboarding), []);

  const missingEmail = { ...onboarding, actions: [onboarding.actions[0]] };
  assert.match(validateRequestedLanguageIntent(newHirePrompt, missingEmail).join(" "), /notification/);
  const missingChecklist = { ...onboarding, actions: [onboarding.actions[1]] };
  assert.match(validateRequestedLanguageIntent(newHirePrompt, missingChecklist).join(" "), /checklist/);

  const wrongRecipient: TypedAutomationLanguageDraft = {
    ...onboarding,
    actions: [
      onboarding.actions[0],
      { type: "send_email", recipient: "manager", subject: "Welcome", body: "Your onboarding steps are ready." },
    ],
  };
  assert.match(validateRequestedLanguageIntent(newHirePrompt, wrongRecipient).join(" "), /employee welcome notification/);
});

test("valid trigger and action types cannot silently change the event or omit manager notification", () => {
  const promotionPrompt = "When an employee is promoted, create a people ops verification task and notify their manager.";
  const promotion: TypedAutomationLanguageDraft = {
    ...onboarding,
    trigger: "employee.promoted",
    actions: [
      { type: "create_task", title: "Verify promotion", owner: "People Ops" },
      { type: "send_email", recipient: "manager", subject: "Promotion", body: "Please review." },
    ],
  };
  assert.deepEqual(validateRequestedLanguageIntent(promotionPrompt, promotion), []);
  assert.match(
    validateRequestedLanguageIntent(promotionPrompt, { ...promotion, trigger: "employee.hired" }).join(" "),
    /trigger differs/,
  );
  assert.match(
    validateRequestedLanguageIntent(promotionPrompt, {
      ...promotion,
      actions: [{ type: "create_task", title: "Verify promotion", owner: "People Ops" }],
    }).join(" "),
    /notification/,
  );
  assert.match(
    validateRequestedLanguageIntent(promotionPrompt, {
      ...promotion,
      actions: [
        { type: "create_task", title: "Verify promotion", owner: "People Ops" },
        { type: "send_email", recipient: "employee", subject: "Promotion", body: "Please review." },
      ],
    }).join(" "),
    /manager notification/,
  );
});

test("protects precise location/department conditions even when another IF condition exists", () => {
  const locationPrompt = "When a new employee is hired only in Manila, create an onboarding checklist and send a welcome email.";
  const incorrectCondition: TypedAutomationLanguageDraft = {
    ...onboarding,
    conditions: { version: 1, all: [{ field: "department", operator: "eq", value: "Sales" }], any: [] },
  };
  assert.match(
    validateRequestedLanguageIntent(locationPrompt, incorrectCondition).join(" "),
    /limited location/,
  );
  assert.deepEqual(validateRequestedLanguageIntent(locationPrompt, {
    ...onboarding,
    conditions: { version: 1, all: [{ field: "location", operator: "eq", value: "Manila" }], any: [] },
  }), []);
  const deptPrompt = "When a new employee is hired only for Finance department, create an onboarding checklist and send a welcome email.";
  assert.match(validateRequestedLanguageIntent(deptPrompt, incorrectCondition).join(" "), /limited department/);
  assert.deepEqual(validateRequestedLanguageIntent(deptPrompt, {
    ...onboarding,
    conditions: { version: 1, all: [{ field: "department", operator: "eq", value: "Finance" }], any: [] },
  }), []);
});

test("blocking approval gates cannot be replaced by a mere approval request", () => {
  const input = "When an employee is hired, create a task and pause until approval.";
  const taskAndRequest: TypedAutomationLanguageDraft = {
    ...onboarding,
    actions: [
      { type: "create_task", title: "Review documents", owner: "People Ops" },
      { type: "request_approval", title: "Approve", detail: "Review", approver: "People Ops" },
    ],
  };
  assert.match(
    validateRequestedLanguageIntent(input, taskAndRequest).join(" "),
    /blocking approval gate/,
  );
});

test("explicit unsupported effects are rejected before involving a live AI provider", () => {
  for (const prompt of [
    "When a new employee is hired, grant admin access.",
    "When payroll is prepared, adjust employee pay.",
    "When an employee is hired, revoke user access.",
    "When a timesheet is approved, transfer funds.",
    "When payroll is finished, make an API request to an external service.",
  ]) {
    assert.equal(containsUnsupportedLanguageEffect(prompt), true, prompt);
  }
  assert.equal(containsUnsupportedLanguageEffect(newHirePrompt), false);
});

test("fabricated hard-coded identifiers or contacts are rejected from generated actions", () => {
  const unsafe: TypedAutomationLanguageDraft = {
    ...onboarding,
    actions: [
      onboarding.actions[0],
      { type: "send_email", recipient: "employee", subject: "Welcome", body: "Contact jane@example.com about record 12345678." },
    ],
  };
  assert.match(validateRequestedLanguageIntent(newHirePrompt, unsafe).join(" "), /hard-coded contact/);
});
