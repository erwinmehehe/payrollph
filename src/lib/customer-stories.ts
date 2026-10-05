export type CustomerMetric = {
  label: string;
  value: string;
  evidenceNote: string;
};

export type CustomerQuote = {
  text: string;
  speaker: string;
  role: string;
  approved: boolean;
  approvalEvidence: string;
  approvedAt: string;
};

export type CustomerStory = {
  slug: string;
  customerName: string;
  industry: string;
  approved: boolean;
  approvalEvidence: string;
  approvedAt: string;
  challenge: string;
  implementation: string;
  outcome: string;
  metrics: CustomerMetric[];
  quote?: CustomerQuote;
};

function present(value: string) {
  return value.trim().length > 0;
}

export function customerStoryPublicationProblems(story: CustomerStory) {
  const problems: string[] = [];

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.slug)) {
    problems.push("Story slug must be a lowercase URL-safe slug.");
  }

  for (const [label, value] of [
    ["customer name", story.customerName],
    ["industry", story.industry],
    ["challenge", story.challenge],
    ["implementation", story.implementation],
    ["outcome", story.outcome],
  ] as const) {
    if (!present(value)) problems.push(`Missing ${label}.`);
  }

  if (!story.approved) {
    problems.push("Customer story is not approved for publication.");
  } else {
    if (!present(story.approvalEvidence)) {
      problems.push("Approved story is missing customer approval evidence.");
    }
    if (!present(story.approvedAt)) {
      problems.push("Approved story is missing an approval date.");
    }
  }

  story.metrics.forEach((metric, index) => {
    if (!present(metric.label)) problems.push(`Metric ${index + 1} is missing a label.`);
    if (!present(metric.value)) problems.push(`Metric ${index + 1} is missing a value.`);
    if (!present(metric.evidenceNote)) {
      problems.push(`Metric ${index + 1} is missing evidence for its published value.`);
    }
  });

  if (story.quote) {
    if (!story.quote.approved) {
      problems.push("Customer quote is not approved for publication.");
    } else {
      if (!present(story.quote.text)) problems.push("Approved quote is missing text.");
      if (!present(story.quote.speaker)) problems.push("Approved quote is missing speaker.");
      if (!present(story.quote.role)) problems.push("Approved quote is missing speaker role.");
      if (!present(story.quote.approvalEvidence)) {
        problems.push("Approved quote is missing approval evidence.");
      }
      if (!present(story.quote.approvedAt)) {
        problems.push("Approved quote is missing an approval date.");
      }
    }
  }

  return problems;
}

export function isPublishableCustomerStory(story: CustomerStory) {
  return customerStoryPublicationProblems(story).length === 0;
}

/**
 * Public customer stories must be populated only after customer approval and
 * metric verification. Keep this empty rather than manufacturing social proof.
 */
export const CUSTOMER_STORIES: CustomerStory[] = [];

export const PUBLISHABLE_CUSTOMER_STORIES = CUSTOMER_STORIES.filter(isPublishableCustomerStory);
