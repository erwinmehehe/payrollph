export type CustomerStory = {
  slug: string;
  customerName: string;
  industry: string;
  approved: boolean;
  challenge: string;
  implementation: string;
  outcome: string;
  metrics: Array<{ label: string; value: string; evidenceNote: string }>;
  quote?: { text: string; speaker: string; role: string; approved: boolean };
};

/**
 * Public customer stories must be populated only after customer approval and
 * metric verification. Keep this empty rather than manufacturing social proof.
 */
export const CUSTOMER_STORIES: CustomerStory[] = [];
