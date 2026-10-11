import assert from "node:assert/strict";
import test from "node:test";
import { resolveScopedOption } from "../src/lib/scoped-option-selection";

test("swap counterpart defaults to a second worker with a safe single-worker fallback", () => {
  assert.equal(resolveScopedOption(null, 1, [], 1), "");
  assert.equal(resolveScopedOption(null, 1, [{ id: 20 }], 1), "20");
  assert.equal(resolveScopedOption(null, 1, [{ id: 20 }, { id: 30 }], 1), "30");
  assert.equal(resolveScopedOption({ organizationId: 1, value: "20" }, 1, [{ id: 20 }, { id: 30 }], 1), "20");
  assert.equal(resolveScopedOption({ organizationId: 1, value: "40" }, 1, [{ id: 20 }, { id: 30 }], 1), "");
});

test("an invalid manager choice never silently becomes a department-wide budget", () => {
  const options = [{ id: 0 }, { id: 20 }];
  assert.equal(resolveScopedOption(null, 1, options), "0");
  assert.equal(resolveScopedOption({ organizationId: 1, value: "30" }, 1, options), "");
  assert.equal(resolveScopedOption({ organizationId: 1, value: "0" }, 1, options), "0");
  assert.equal(resolveScopedOption({ organizationId: 1, value: "30" }, 2, options), "0");
});

test("untouched fields derive defaults only after current options arrive", () => {
  assert.equal(resolveScopedOption(null, 1, []), "");
  assert.equal(resolveScopedOption(null, 1, [{ id: 20 }, { id: 30 }]), "20");
});

test("explicit selections survive refreshes and ordering changes", () => {
  const choice = { organizationId: 1, value: "30" };
  assert.equal(resolveScopedOption(choice, 1, []), "");
  assert.equal(resolveScopedOption(choice, 1, [{ id: 30 }, { id: 20 }]), "30");
});

test("removed or inactive explicit options require a fresh choice", () => {
  assert.equal(resolveScopedOption({ organizationId: 1, value: "30" }, 1, [{ id: 20 }]), "");
  assert.equal(resolveScopedOption({ organizationId: 1, value: "" }, 1, [{ id: 20 }]), "");
});

test("employer changes cannot carry a prior worker or site ID into current options", () => {
  const oldChoice = { organizationId: 1, value: "30" };
  assert.equal(resolveScopedOption(oldChoice, 2, []), "");
  assert.equal(resolveScopedOption(oldChoice, 2, [{ id: 40 }]), "40");
  assert.equal(resolveScopedOption(oldChoice, 2, [{ id: 40 }, { id: 30 }]), "40");
});
