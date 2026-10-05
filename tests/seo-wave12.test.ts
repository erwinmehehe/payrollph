import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_STORIES,
  PUBLISHABLE_CUSTOMER_STORIES,
  customerStoryPublicationProblems,
  isPublishableCustomerStory,
  type CustomerStory,
} from "../src/lib/customer-stories";

function validStory(): CustomerStory {
  return {
    slug: "sample-customer",
    customerName: "Sample Customer",
    industry: "Professional services",
    approved: true,
    approvalEvidence: "CRM approval record #123",
    approvedAt: "2026-10-05",
    challenge: "Payroll review depended on multiple manual handoffs.",
    implementation: "Linaw payroll review and release workflow.",
    outcome: "The customer approved publication of the implementation story.",
    metrics: [
      {
        label: "Payroll preparation time",
        value: "Reduced from 6 hours to 4 hours",
        evidenceNote: "Approved payroll operations comparison, September 2026.",
      },
    ],
    quote: {
      text: "The review workflow is easier to follow.",
      speaker: "Approved Customer Contact",
      role: "Payroll Manager",
      approved: true,
      approvalEvidence: "Approved quote email dated 2026-10-05.",
      approvedAt: "2026-10-05",
    },
  };
}

test("approved boolean alone is not enough to publish a customer story", () => {
  const story = validStory();
  story.approvalEvidence = "";
  assert.equal(isPublishableCustomerStory(story), false);
  assert.ok(customerStoryPublicationProblems(story).includes("Approved story is missing customer approval evidence."));
});

test("every published metric requires an evidence note", () => {
  const story = validStory();
  story.metrics[0].evidenceNote = "";
  const problems = customerStoryPublicationProblems(story);
  assert.equal(isPublishableCustomerStory(story), false);
  assert.ok(problems.some((problem) => problem.includes("missing evidence for its published value")));
});

test("quotes cannot publish without explicit approval evidence", () => {
  const story = validStory();
  if (!story.quote) throw new Error("test fixture requires quote");
  story.quote.approvalEvidence = "";
  assert.equal(isPublishableCustomerStory(story), false);
  assert.ok(customerStoryPublicationProblems(story).includes("Approved quote is missing approval evidence."));
});

test("unapproved quote blocks publication instead of silently publishing it", () => {
  const story = validStory();
  if (!story.quote) throw new Error("test fixture requires quote");
  story.quote.approved = false;
  assert.equal(isPublishableCustomerStory(story), false);
  assert.ok(customerStoryPublicationProblems(story).includes("Customer quote is not approved for publication."));
});

test("complete evidence-backed story passes the publication gate", () => {
  const story = validStory();
  assert.deepEqual(customerStoryPublicationProblems(story), []);
  assert.equal(isPublishableCustomerStory(story), true);
});

test("invalid or unsafe slugs fail the publication gate", () => {
  const story = validStory();
  story.slug = "../customer?draft=true";
  assert.equal(isPublishableCustomerStory(story), false);
  assert.ok(customerStoryPublicationProblems(story).includes("Story slug must be a lowercase URL-safe slug."));
});

test("production registry remains empty until real proof is entered", () => {
  assert.deepEqual(CUSTOMER_STORIES, []);
  assert.deepEqual(PUBLISHABLE_CUSTOMER_STORIES, []);
});
