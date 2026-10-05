import assert from "node:assert/strict";
import test from "node:test";
import { classifyAskLinawQuestion } from "../src/lib/ask-linaw";

test("Ask Linaw routes only supported evidence-backed question families", () => {
  assert.equal(classifyAskLinawQuestion("What is blocking this payroll from release?"), "release-blockers");
  assert.equal(classifyAskLinawQuestion("Why did Maria's net pay change?"), "pay-explanation");
  assert.equal(classifyAskLinawQuestion("Are our SSS remittances confirmed?"), "remittance-status");
  assert.equal(classifyAskLinawQuestion("Which filing formats have agency acceptance?"), "filing-status");
  assert.equal(classifyAskLinawQuestion("Which statutory rule version is effective?"), "rule-status");
});

test("Ask Linaw declines generic HR questions instead of hallucinating", () => {
  assert.equal(classifyAskLinawQuestion("Write a performance review for Maria"), "unsupported");
  assert.equal(classifyAskLinawQuestion("How should I motivate my team?"), "unsupported");
});
