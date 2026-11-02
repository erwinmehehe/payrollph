/** Blank, public HR templates. These are not employer records, approvals or payroll instructions. */
export type HrChecklistTemplate = {
  slug: string;
  title: string;
  category: string;
  audience: string;
  description: string;
  sections: readonly { title: string; items: readonly string[] }[];
};

export const HR_CHECKLIST_TEMPLATES: readonly HrChecklistTemplate[] = [
  {
    slug: "new-hire-onboarding",
    title: "New-hire onboarding",
    category: "Joiners",
    audience: "HR and hiring managers",
    description: "Coordinate the first days of employment without treating a checklist as payroll authorization.",
    sections: [
      { title: "Before the start date", items: [
        "Confirm the approved offer and employer of record.",
        "Confirm the start date, position, worksite and reporting manager.",
        "Share the first-day schedule and named contact.",
        "Prepare workplace access and equipment requests under the normal approval process.",
      ] },
      { title: "First-day setup", items: [
        "Confirm identity documents using the employer's approved private process.",
        "Provide required workplace policies and acknowledgements.",
        "Explain attendance, leave and employee self-service procedures.",
        "Record questions and assign an owner for unresolved items.",
      ] },
      { title: "Follow-up", items: [
        "Confirm outstanding documents with the employee.",
        "Check equipment and access requests for completion.",
        "Review probation check-in dates if applicable.",
        "Confirm who owns each remaining setup item.",
      ] },
    ],
  },
  {
    slug: "employee-offboarding",
    title: "Employee offboarding",
    category: "Leavers",
    audience: "HR, managers and IT",
    description: "Track non-financial exit tasks, access, handover and record stewardship.",
    sections: [
      { title: "Handover and communication", items: [
        "Confirm an authorized separation decision and effective date.",
        "Assign the work handover owner and documentation due date.",
        "Communicate the exit process and contact point.",
        "Confirm the agreed return plan for company property.",
      ] },
      { title: "Access and records", items: [
        "Record the IT access removal request for the approved effective time.",
        "Review outstanding asset return evidence.",
        "Confirm HR record retention and privacy requirements.",
        "Route final-pay matters to the separate authorized payroll workflow.",
      ] },
    ],
  },
  {
    slug: "leave-handoff",
    title: "Leave handoff checklist",
    category: "Time away",
    audience: "Employees and managers",
    description: "Prepare coverage and a clear return plan without substituting for the leave approval flow.",
    sections: [
      { title: "Before leave", items: [
        "Submit the leave request through the approved workflow.",
        "Identify the team coverage contact and any critical handovers.",
        "Review meeting ownership and customer communication where relevant.",
        "Confirm how urgent questions will be handled in the employee's absence.",
      ] },
      { title: "Return to work", items: [
        "Confirm the expected return date with the team.",
        "Review open handover items and key updates.",
        "Close outstanding follow-up tasks.",
      ] },
    ],
  },
  {
    slug: "asset-return",
    title: "Company asset return",
    category: "Equipment",
    audience: "HR and IT",
    description: "Document the return and inspection of assigned property without storing private identifiers in this public tool.",
    sections: [
      { title: "Collect and inspect", items: [
        "List assigned equipment in the employer's protected asset system.",
        "Arrange a safe return location and responsible receiver.",
        "Inspect returned items and note any issues in the approved record.",
        "Acknowledge receipt through the authorized internal process.",
      ] },
      { title: "Close the task", items: [
        "Update the protected asset register with the received condition.",
        "Escalate missing or damaged items through the employer's policy.",
        "Confirm any related access tokens or devices were deactivated.",
      ] },
    ],
  },
  {
    slug: "probation-check-in",
    title: "Probation check-in",
    category: "People development",
    audience: "Managers and HR",
    description: "Prepare a structured, documented conversation using role expectations and observed evidence.",
    sections: [
      { title: "Prepare", items: [
        "Confirm the review period and applicable employer policy.",
        "Review agreed responsibilities and documented goals.",
        "Collect specific, work-related examples and completed assignments.",
        "Allow the employee to prepare questions and observations.",
      ] },
      { title: "During and after the meeting", items: [
        "Discuss progress, support needs and role expectations.",
        "Record agreed follow-up actions and due dates.",
        "Route any formal employment decision to the authorized review process.",
        "Share the next check-in date through an approved channel.",
      ] },
    ],
  },
  {
    slug: "employee-file-review",
    title: "Employee file review",
    category: "Records",
    audience: "HR operations",
    description: "Check completeness without copying employee personal data into an external spreadsheet.",
    sections: [
      { title: "Record quality", items: [
        "Confirm the employee record has the correct authorized employer.",
        "Review worksite, manager and job details in the official HRIS record.",
        "Check that required documents are stored in approved private systems.",
        "Confirm outstanding policy acknowledgements are assigned to an owner.",
      ] },
      { title: "Privacy and follow-up", items: [
        "Check whether retention or correction requests need action.",
        "Record missing items in the employer's protected task system.",
        "Limit access to people with a legitimate role need.",
        "Set a follow-up date for outstanding tasks.",
      ] },
    ],
  },
];

function csvCell(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function hrChecklistCsv(template: HrChecklistTemplate): string {
  const rows = [["Section", "Checklist item", "Owner", "Target date", "Status", "Notes"]];
  for (const section of template.sections) {
    for (const item of section.items) rows.push([section.title, item, "", "", "", ""]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
