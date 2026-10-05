export type AskLinawIntent =
  | "release-blockers"
  | "pay-explanation"
  | "remittance-status"
  | "filing-status"
  | "rule-status"
  | "unsupported";

export function classifyAskLinawQuestion(question: string): AskLinawIntent {
  const q = question.trim().toLowerCase();
  if (!q) return "unsupported";
  if (/\b(block|blocking|release|ready to release|cannot release|can't release|why.*release)\b/.test(q)) return "release-blockers";
  if (/\b(remit|remittance|sss posted|philhealth posted|pag-?ibig posted|contribution status)\b/.test(q)) return "remittance-status";
  if (/\b(filing|filed|alphalist|2316|1604|1601|r-?3|rf-?1|mcrf|agency acceptance)\b/.test(q)) return "filing-status";
  if (/\b(rule|rule version|statutory source|effective rule|compliance source)\b/.test(q)) return "rule-status";
  if (/\b(net pay|payslip|deduction|withholding|why.*pay|why.*salary|pay changed|salary changed)\b/.test(q)) return "pay-explanation";
  return "unsupported";
}

export const ASK_LINAW_SUPPORTED_PROMPTS = [
  "What is blocking this payroll from release?",
  "Why did this employee's net pay change?",
  "Are our SSS, PhilHealth and Pag-IBIG remittances confirmed?",
  "Which government filing formats have accepted evidence?",
  "Which approved compliance rules are effective today?",
] as const;
