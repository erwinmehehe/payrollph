/** Public help copy only. Never reads a session, employee record, or tenant state. */
export type HelpAudience = "Employees" | "Managers" | "HR teams" | "Payroll teams";
export type HelpArticle = {
  slug: string;
  title: string;
  audience: HelpAudience;
  category: string;
  summary: string;
  steps: readonly string[];
  note?: string;
  related: { label: string; href: string };
};

export const HELP_AUDIENCES: readonly HelpAudience[] = [
  "Employees", "Managers", "HR teams", "Payroll teams",
];

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "find-released-payslips",
    title: "Find and download a released payslip",
    audience: "Employees",
    category: "Pay",
    summary: "See your own released pay periods and download a PDF when available.",
    steps: [
      "Sign in using your personal employee account.",
      "Open Pay or Payslips from the employee navigation.",
      "Select a released period and choose View payslip or Download PDF.",
      "If a period is missing, ask your payroll or HR contact to confirm its release status.",
    ],
    note: "Draft and in-review payroll amounts are not available in employee self-service.",
    related: { label: "Employee self-service overview", href: "/employee-self-service" },
  },
  {
    slug: "request-leave",
    title: "Request leave and check the decision",
    audience: "Employees",
    category: "Leave",
    summary: "Submit a request under an assigned leave policy and track its status.",
    steps: [
      "Open the Leave section in your employee workspace.",
      "Review your assigned policy and displayed available balance.",
      "Choose Request leave, enter the requested dates and required details, then submit.",
      "Return to Leave to see whether the request is pending, approved, or declined.",
    ],
    note: "Submitting a request does not approve it or change payroll automatically.",
    related: { label: "Explore HRIS workflows", href: "/hris" },
  },
  {
    slug: "review-attendance",
    title: "Review your attendance records",
    audience: "Employees",
    category: "Time",
    summary: "Find recorded punches and identify items that need clarification.",
    steps: [
      "Open Time or Attendance in your employee workspace.",
      "Review your recorded time-in, time-out, and available source information.",
      "Check for missing or incomplete records rather than assuming they were accepted.",
      "Use the available correction or HR request path if a record appears inaccurate.",
    ],
    note: "A visible time record is not proof that every payroll cutoff control has passed.",
    related: { label: "Time and attendance overview", href: "/time-and-attendance" },
  },
  {
    slug: "find-documents",
    title: "Find employee documents",
    audience: "Employees",
    category: "Documents",
    summary: "Open the documents available to your employee account.",
    steps: [
      "Sign in and open Documents in the employee navigation.",
      "Review the documents your employer has made available to you.",
      "Open a document or its status information where the option is offered.",
      "If the document you need is not shown, request it from your HR contact.",
    ],
    note: "Documents are visible only when your employer has made them available to your account.",
    related: { label: "Employee self-service overview", href: "/employee-self-service" },
  },
  {
    slug: "update-personal-info",
    title: "Review your personal contact details",
    audience: "Employees",
    category: "Profile",
    summary: "Review the information available in your profile and edit permitted contact fields.",
    steps: [
      "Open Profile or My info in the employee workspace.",
      "Check the displayed contact and emergency contact details.",
      "Use the edit option for fields your employer allows you to update.",
      "Save and check the result; contact HR for details that are restricted.",
    ],
    note: "Profile updates do not change salary, statutory identifiers, or payout destinations.",
    related: { label: "Employee self-service overview", href: "/employee-self-service" },
  },
  {
    slug: "manager-decisions",
    title: "Find approvals assigned to you",
    audience: "Managers",
    category: "Approvals",
    summary: "Use the authoritative approval screen instead of acting from a summary card.",
    steps: [
      "Select the correct employer and sign in with your assigned manager role.",
      "Open Approvals or the relevant source workflow.",
      "Read the request, supporting information, and any delegation or scope restriction.",
      "Make the decision in the original workflow and confirm its resulting status.",
    ],
    note: "Seeing an informational item does not grant permission to approve it.",
    related: { label: "Connected HCM workflows", href: "/hcm" },
  },
  {
    slug: "employee-directory",
    title: "Find an employee in the right employer",
    audience: "HR teams",
    category: "People",
    summary: "Keep directory work in the employer and role context you can actually access.",
    steps: [
      "Confirm the selected employer in the workspace header.",
      "Open People and use the available directory or scoped search.",
      "Check the employee number and other permitted identifiers before selecting a record.",
      "If data is unavailable or partially loaded, retry rather than treating zero results as proof of no employee.",
    ],
    note: "Search results reflect authorized and loaded records, not necessarily the entire employer workforce.",
    related: { label: "HRIS overview", href: "/hris" },
  },
  {
    slug: "import-recovery",
    title: "Handle an interrupted employee CSV import",
    audience: "HR teams",
    category: "Imports",
    summary: "Use preview results and verify outcomes before repeating an import.",
    steps: [
      "Open the existing employee import flow and review file validation feedback.",
      "Correct invalid rows and confirm the import preview for the selected employer.",
      "Commit only through the existing authorized confirmation flow.",
      "If the connection drops or the outcome is unclear, check the employee directory before submitting again.",
    ],
    note: "Do not blindly retry an import when the previous commit may have succeeded.",
    related: { label: "Implementation and migration", href: "/implementation" },
  },
  {
    slug: "new-employee-checklists",
    title: "Track a new hire's setup tasks",
    audience: "HR teams",
    category: "Onboarding",
    summary: "Use assigned onboarding items and verify completion evidence separately.",
    steps: [
      "Find the newly created employee in the selected employer's People workspace.",
      "Open the available onboarding or lifecycle checklist.",
      "Review task owners, open items, and the available completion state.",
      "Follow your employer's normal approval process for restricted access or employment changes.",
    ],
    note: "Completing an HR checklist does not automatically approve payroll or a bank instruction.",
    related: { label: "Implementation overview", href: "/implementation" },
  },
  {
    slug: "first-payroll-preparation",
    title: "Understand first-payroll setup steps",
    audience: "Payroll teams",
    category: "Preparation",
    summary: "Review the guided workflow without treating a preview as authorization to release pay.",
    steps: [
      "Sign in using the authorized employer and payroll role.",
      "Open the first-payroll setup journey if it is available to your organization.",
      "Review employer details, employee records, pay inputs, and open exceptions.",
      "Hand off each restricted decision to the designated reviewer or checker.",
    ],
    note: "Preview, calculation, approval, release, payout, and government filing each have separate controls and acceptance requirements.",
    related: { label: "Payroll implementation guide", href: "/implementation" },
  },
  {
    slug: "account-help",
    title: "Get help with access or a blocked action",
    audience: "Employees",
    category: "Access",
    summary: "Understand what to do when a page is restricted or unavailable.",
    steps: [
      "Confirm that you are signed in with the correct account.",
      "If a page says you do not have access, ask your employer's authorized administrator about your role.",
      "For a loading or network error, retry once after checking your connection.",
      "Use the contact page for product support when your employer's administrator cannot resolve the issue.",
    ],
    note: "Do not share passwords, one-time codes, bank details, or employee records in support messages.",
    related: { label: "Contact Linaw", href: "/contact" },
  },

  {
    slug: "manager-team-view",
    title: "Confirm your team and employer context",
    audience: "Managers",
    category: "Getting started",
    summary: "Check which workers and decisions your manager role is permitted to see.",
    steps: [
      "Sign in with your assigned manager account and select the correct employer.",
      "Open My Team or the manager view available to your role.",
      "Confirm the employee and team context before following a linked action.",
      "Treat unavailable or incomplete data as unknown, not proof that no workers or tasks exist.",
    ],
    note: "Manager visibility does not give permission to edit salary or release payroll.",
    related: { label: "Connected HCM workflows", href: "/hcm" },
  },
  {
    slug: "manager-handoff",
    title: "Review team requests and handoffs",
    audience: "Managers",
    category: "Getting started",
    summary: "Follow a request to its source before deciding or asking HR to follow up.",
    steps: [
      "Open the assigned request from the authoritative manager or approval workflow.",
      "Confirm the selected employer, worker context and available source evidence.",
      "Use the decision control only if your current role is authorized for that request.",
      "Check the resulting status and direct unresolved questions to the HR owner.",
    ],
    note: "A leave or schedule decision is not a payroll release or bank transfer.",
    related: { label: "HRIS overview", href: "/hris" },
  },
  {
    slug: "payroll-exceptions",
    title: "Review payroll input exceptions",
    audience: "Payroll teams",
    category: "Getting started",
    summary: "Understand the source of open attendance and pay-input exceptions before handoff.",
    steps: [
      "Confirm the employer, pay period and your authorized payroll role.",
      "Review visible attendance, leave and pay-input exceptions for the selected cutoff.",
      "Refer unresolved source changes to the assigned HR or timekeeping approver.",
      "Recheck authoritative input and exception status before handing the period to the checker.",
    ],
    note: "An informational preview does not resolve exceptions or authorize recalculation, release or payout.",
    related: { label: "Payroll implementation guide", href: "/implementation" },
  },
  {
    slug: "payroll-checker-evidence",
    title: "Prepare an independent payroll review handoff",
    audience: "Payroll teams",
    category: "Getting started",
    summary: "Keep calculation evidence, checker decisions and dry-run outputs distinct.",
    steps: [
      "Identify the designated payroll officer, independent checker and owner for the selected employer.",
      "Prepare the available payroll register, payslip and journal evidence in the authorized private workflow.",
      "Have the independent checker inspect and decide through the existing review process.",
      "Keep bank files and government output in preview or dry-run only until separately approved.",
    ],
    note: "A passed synthetic check or signed-in user is not proof of real-employer reconciliation, external acceptance, or authority to move funds.",
    related: { label: "Payroll implementation guide", href: "/implementation" },
  },
];

export function searchHelpArticles(query: string, audience: HelpAudience | "All" = "All") {
  const term = query.trim().toLocaleLowerCase();
  return HELP_ARTICLES.filter((article) =>
    (audience === "All" || article.audience === audience) &&
    (!term || [article.title, article.summary, article.category, ...article.steps]
      .some((value) => value.toLocaleLowerCase().includes(term)))
  );
}
