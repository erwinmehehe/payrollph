import assert from "node:assert/strict";
import test from "node:test";
import { draftAutomationFromLanguage } from "../src/lib/automation-language-draft";

const allowed = {
  name: "Employee onboarding review",
  trigger: "employee.hired",
  conditions: { version: 1, all: [], any: [] },
  actions: [{ type: "create_task", title: "Check onboarding documents", owner: "People Ops" }],
};

async function withMockModel(
  output: unknown,
  run: (calls: () => number) => Promise<void>,
) {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevEnabled = process.env.OPENAI_AUTOMATION_DRAFT_ENABLED;
  const prevFetch = globalThis.fetch;
  let count = 0;
  process.env.OPENAI_API_KEY = "sk-fixture-never-used";
  process.env.OPENAI_AUTOMATION_DRAFT_ENABLED = "true";
  globalThis.fetch = async (request, options) => {
    count += 1;
    assert.equal(String(request), "https://api.openai.com/v1/chat/completions");
    assert.equal(options?.method, "POST");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.messages.length, 2);
    assert.equal(body.temperature, 0);
    assert.ok(!JSON.stringify(body).includes("sessionToken"));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(output) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await run(() => count);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.OPENAI_AUTOMATION_DRAFT_ENABLED;
    else process.env.OPENAI_AUTOMATION_DRAFT_ENABLED = prevEnabled;
  }
}

test("external drafting requires an explicit server-side opt-in even with a configured key", async () => {
  const originalEnabled = process.env.OPENAI_AUTOMATION_DRAFT_ENABLED;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let outbound = 0;
  try {
    process.env.OPENAI_API_KEY = "sk-fixture-never-used";
    process.env.OPENAI_AUTOMATION_DRAFT_ENABLED = "false";
    globalThis.fetch = async () => {
      outbound += 1;
      throw new Error("No external request allowed without opt-in");
    };
    const result = await draftAutomationFromLanguage(
      "When a new employee is hired, create an onboarding checklist and send them a welcome email.",
    );
    assert.equal(result.source, "approved-template");
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabled === undefined) delete process.env.OPENAI_AUTOMATION_DRAFT_ENABLED;
    else process.env.OPENAI_AUTOMATION_DRAFT_ENABLED = originalEnabled;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("model-drafted workflow uses JSON-only response and server validation", async () => {
  await withMockModel(allowed, async (calls) => {
    const result = await draftAutomationFromLanguage("When someone is hired, create an onboarding verification task.");
    assert.equal(calls(), 1);
    assert.equal(result.source, "model");
    assert.equal(result.validation.valid, true);
    assert.equal(result.draft.actions[0].type, "create_task");
  });
});

test("model output cannot force unsupported payroll, access, or external side effects", async () => {
  await withMockModel({
    ...allowed,
    actions: [{ type: "request_payroll_adjustment", amount: 100000, reason: "auto-approve" }],
  }, async (calls) => {
    await assert.rejects(
      draftAutomationFromLanguage("When a new employee is hired, create an onboarding checklist and send a welcome email."),
      /failed server validation/,
    );
    assert.equal(calls(), 1);
  });
});

test("privileged pay/access commands never reach the external model", async () => {
  await withMockModel(allowed, async (calls) => {
    await assert.rejects(
      draftAutomationFromLanguage("When payroll is prepared, adjust employee pay."),
      /privileged or unsupported side effect/,
    );
    await assert.rejects(
      draftAutomationFromLanguage("When a new employee is hired, grant admin access."),
      /privileged or unsupported side effect/,
    );
    assert.equal(calls(), 0);
  });
});

test("model output may be well typed but must not omit requested checklist and email", async () => {
  await withMockModel(allowed, async (calls) => {
    await assert.rejects(
      draftAutomationFromLanguage("When a new employee is hired, create an onboarding checklist and send them a welcome email."),
      /does not preserve the request/,
    );
    assert.equal(calls(), 1);
  });
});

test("generated notification must address the requested manager", async () => {
  await withMockModel({
    ...allowed,
    trigger: "employee.promoted",
    actions: [
      { type: "create_task", title: "Verify promotion", owner: "People Ops" },
      { type: "send_email", recipient: "employee", subject: "Promotion", body: "Please review." },
    ],
  }, async (calls) => {
    await assert.rejects(
      draftAutomationFromLanguage("When an employee is promoted, create a people ops verification task and notify their manager."),
      /manager notification/,
    );
    assert.equal(calls(), 1);
  });
});

test("an unrelated IF filter cannot stand in for a requested location scope", async () => {
  await withMockModel({
    ...allowed,
    conditions: { version: 1, all: [{ field: "department", operator: "eq", value: "Sales" }], any: [] },
  }, async (calls) => {
    await assert.rejects(
      draftAutomationFromLanguage("When a new employee is hired only in Manila, create an onboarding verification task."),
      /limited location/,
    );
    assert.equal(calls(), 1);
  });
});

test("scoped request cannot silently become a global no-filter workflow", async () => {
  await withMockModel(allowed, async () => {
    await assert.rejects(
      draftAutomationFromLanguage("When an employee is hired only in Manila, create an onboarding task."),
      /specifies a condition or scope/,
    );
  });
});

test("direct identifiers are blocked before the model receives them", async () => {
  await withMockModel(allowed, async (calls) => {
    for (const request of [
      "When an employee with contact jane@example.com is hired, send a welcome message.",
      "When an employee with phone number 09171234567 is hired, create a reminder.",
      "When employee number 1234567890 joins, create an onboarding task.",
    ]) {
      await assert.rejects(draftAutomationFromLanguage(request), /Remove personal contact details/);
    }
    assert.equal(calls(), 0);
  });
});
