import type { TypedAutomationLanguageDraft } from "@/lib/automation-language-draft";

/**
 * Conservative, deterministic checks for explicit, high-confidence intent.
 * This does NOT claim to prove full semantic equivalence to a prompt.
 * Ambiguous requests must still be rejected or reviewed by a human.
 */
const TRIGGER_HINTS: ReadonlyArray<{ phrase: RegExp; trigger: string }> = [
  { phrase: /\b(?:new employee is hired|new hire|employee is hired|employee gets hired)\b/i, trigger: "employee.hired" },
  { phrase: /\b(?:employee is promoted|employee gets promoted|employee promotion)\b/i, trigger: "employee.promoted" },
  { phrase: /\b(?:contribution discrepancy|contribution mismatch)\b/i, trigger: "contribution.discrepancy_detected" },
  { phrase: /\bgovernment remittance is due\b/i, trigger: "government.remittance_due" },
  { phrase: /\btimesheet cutoff\b/i, trigger: "timesheet.cutoff_approaching" },
  { phrase: /\b(?:missing timesheet|timesheet is missing)\b/i, trigger: "timesheet.missing_approaching" },
  { phrase: /\bpayroll pay date\b/i, trigger: "payroll.pay_date_approaching" },
];

const TASK_REQUEST = /\b(?:create|open|assign|add|make)\b[^.!?]{0,85}\b(?:task|ticket)\b/i;
const CHECKLIST_REQUEST = /\b(?:create|prepare|generate|set up|build|start)\b[^.!?]{0,85}\bchecklist\b/i;
const EMAIL_REQUEST = /\b(?:email|notify|alert|remind)\b|\bsend\b[^.!?]{0,85}\b(?:email|message|reminder|notification)\b/i;
const APPROVAL_REQUEST = /\b(?:request|require|obtain|seek)\b[^.!?]{0,65}\b(?:approval|sign[- ]?off|authorization)\b/i;
const GATE_REQUEST = /\b(?:pause|hold|stop|block)\b[^.!?]{0,65}\b(?:until|for)\b[^.!?]{0,45}\b(?:approval|sign[- ]?off)\b/i;
const DELAY_REQUEST = /\b(?:wait|delay)\s+(?:for\s+)?\d+\s*(?:minute|minutes|hour|hours|day|days)\b/i;
const REVIEW_REQUEST = /\bprepare\b[^.!?]{0,65}\b(?:review|escalation)\b/i;

const UNSUPPORTED_EFFECTS: ReadonlyArray<RegExp> = [
  /\b(?:grant|revoke|remove|provision|assign)\b[^.!?]{0,35}\b(?:admin access|permissions|user access|system access|privileges|roles)\b/i,
  /\b(?:change|adjust|increase|decrease|set|update)\b[^.!?]{0,25}\b(?:salary|pay rate|employee pay|compensation amount|bank account|bank details)\b/i,
  /\b(?:disburse|transfer|release|pay out)\b[^.!?]{0,35}\b(?:money|funds|payout|wages|salary|payroll)\b/i,
  /\b(?:call a webhook|post to an? external|make an? (?:http|api) request)\b/i,
];

/** Recognize clearly requested side-effects that language drafting cannot implement safely. */
export function containsUnsupportedLanguageEffect(request: string): boolean {
  return UNSUPPORTED_EFFECTS.some((pattern) => pattern.test(request));
}

function hasAction(draft: TypedAutomationLanguageDraft, ...types: string[]): boolean {
  return draft.actions.some((step) => types.includes(step.type));
}

function simpleScopeMatches(
  draft: TypedAutomationLanguageDraft,
  field: "location" | "department",
  value: string,
): boolean {
  const conditions = [...(draft.conditions.all ?? []), ...(draft.conditions.any ?? [])];
  return conditions.some((condition) => (
    condition.field === field
    && (condition.operator === "eq" || condition.operator === "in")
    && (
      typeof condition.value === "string"
        ? condition.value.trim().toLowerCase() === value.toLowerCase()
        : Array.isArray(condition.value) && condition.value.some((item) =>
          typeof item === "string" && item.trim().toLowerCase() === value.toLowerCase()
        )
    )
  ));
}

export function validateRequestedLanguageIntent(
  request: string,
  draft: TypedAutomationLanguageDraft,
): string[] {
  const errors: string[] = [];
  const expectedTriggers = [...new Set(TRIGGER_HINTS
    .filter((hint) => hint.phrase.test(request))
    .map((hint) => hint.trigger))];
  if (expectedTriggers.length > 1) {
    errors.push("The request mentions multiple distinct event triggers. Separate it into workflows.");
  } else if (expectedTriggers.length === 1 && draft.trigger !== expectedTriggers[0]) {
    errors.push("The generated trigger differs from the event clearly requested.");
  }

  if (CHECKLIST_REQUEST.test(request) && !hasAction(draft, "create_onboarding_checklist")) {
    errors.push("The generated steps omit the requested onboarding checklist.");
  }
  if (TASK_REQUEST.test(request) && !hasAction(draft, "create_task")) {
    errors.push("The generated steps omit a requested task.");
  }
  if (EMAIL_REQUEST.test(request) && !hasAction(draft, "send_email")) {
    errors.push("The generated steps omit a requested notification.");
  }
  if (APPROVAL_REQUEST.test(request) && !hasAction(draft, "request_approval", "approval_gate")) {
    errors.push("The generated steps omit the requested approval.");
  }
  if (GATE_REQUEST.test(request) && !hasAction(draft, "approval_gate")) {
    errors.push("The generated steps omit the requested blocking approval gate.");
  }
  if (DELAY_REQUEST.test(request) && !hasAction(draft, "wait")) {
    errors.push("The generated steps omit the requested delay.");
  }
  if (REVIEW_REQUEST.test(request) && !hasAction(draft, "prepare_operational_review", "create_task")) {
    errors.push("The generated steps omit the requested operational review.");
  }

  const managerNotification = /\bnotify\b[^.!?]{0,40}\bmanager\b|\bemail\b[^.!?]{0,40}\bmanager\b/i;
  const employeeWelcomeEmail = /\bwelcome\s+(?:email|message|notification)\b/i;
  if (managerNotification.test(request) && !draft.actions.some((step) =>
    step.type === "send_email" && step.recipient === "manager"
  )) {
    errors.push("A manager notification was requested, but the generated recipient differs.");
  }
  if (employeeWelcomeEmail.test(request) && !draft.actions.some((step) =>
    step.type === "send_email" && step.recipient === "employee"
  )) {
    errors.push("An employee welcome notification was requested, but the generated recipient differs.");
  }

  // Only use scope checks when the request names a single, unambiguous value.
  // For compound or unclear scopes, model/UI review remains mandatory.
  const locationMatch = request.match(/\bonly\s+(?:in|at)\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z-]+){0,2})\s*(?=[,.;!?]|$)/i);
  if (locationMatch && !simpleScopeMatches(draft, "location", locationMatch[1].trim())) {
    errors.push("The generated IF conditions do not preserve the explicitly limited location.");
  }
  const departmentMatch = request.match(/\bonly\s+for\s+(?:the\s+)?([A-Za-z][A-Za-z-]*)\s+department\b/i);
  if (departmentMatch && !simpleScopeMatches(draft, "department", departmentMatch[1].trim())) {
    errors.push("The generated IF conditions do not preserve the explicitly limited department.");
  }

  // Block copied or invented hard-coded identifiers/contacts in proposed actions.
  // This is deliberately heuristic; never use it as the sole PII/DLP policy.
  const actionText = JSON.stringify(draft.actions);
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{8,}\b/i.test(actionText)) {
    errors.push("The generated workflow contains a hard-coded contact or long account/ID number.");
  }
  return errors;
}
