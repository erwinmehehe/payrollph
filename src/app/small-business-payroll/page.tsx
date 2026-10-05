import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

const faq = [
  {
    question: "What should a small business payroll system in the Philippines handle?",
    answer:
      "At minimum, it should keep employee payroll data organized, calculate recurring payroll consistently, surface attendance or deduction exceptions, separate review from release, issue payslips and keep statutory payroll outputs clearly labelled by their validation status.",
  },
  {
    question: "Is payroll software still useful with only a small payroll team?",
    answer:
      "Yes, especially when payroll depends on spreadsheets, manual attendance adjustments or one person remembering every exception. The value is less about company size and more about making the recurring payroll process repeatable and reviewable.",
  },
  {
    question: "Do I need to upload real employee data before trying Linaw?",
    answer:
      "No. The role-based live demo uses sample data so you can inspect the payroll workflow before requesting a controlled workspace or moving a real payroll file.",
  },
  {
    question: "Can a small business keep final payroll approval with the owner?",
    answer:
      "Yes. Linaw separates preparation, checker review and release so the owner or another authorized approver can keep the final release decision instead of giving one payroll operator every critical action.",
  },
  {
    question: "What should we validate before moving off Excel?",
    answer:
      "Reconcile employee master data, pay settings, year-to-date balances, recurring deductions, schedules and expected payroll totals. Run a controlled comparison before treating the new system as the production source of truth.",
  },
];

export const metadata: Metadata = {
  title: "Small Business Payroll Software Philippines | Linaw",
  description:
    "Payroll software for Philippine small businesses and SMEs with payroll calculations, attendance inputs, approvals, payslips, statutory workflows and controlled release.",
  alternates: { canonical: "/small-business-payroll" },
};

export default function SmallBusinessPayrollPage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Small business payroll", path: "/small-business-payroll" },
        ]}
        service={{
          name: "Small Business Payroll Software Philippines",
          description:
            "Payroll software for Philippine small businesses and SMEs with controlled payroll preparation, review, release and employee payslips.",
          path: "/small-business-payroll",
        }}
        faq={faq}
      />

      <SeoLandingPage
        eyebrow="Small business payroll software Philippines"
        title="A clearer payroll process for Philippine small businesses."
        intro="Linaw is built for teams that have outgrown payroll-by-spreadsheet but do not want enterprise software overhead. Keep employee records, attendance inputs, payroll calculations, exceptions, checker review, release and payslips in one controlled workflow."
        proof={[
          "Philippine statutory payroll calculations",
          "Maker-checker payroll controls",
          "Attendance and schedule inputs",
          "Employee payslips and payroll history",
          "CSV employee import",
          "Role-based access for small teams",
        ]}
        sections={[
          {
            title: "Move the recurring payroll work out of scattered spreadsheets",
            body:
              "Small-business payroll becomes risky when employee data, time records, deductions, review notes and final totals live in separate files. Linaw keeps those inputs connected to one payroll run so the team can see what changed and what still needs attention.",
            bullets: [
              "Employee records connected to payroll",
              "Attendance and payroll exceptions in the same workflow",
              "Recurring deductions and benefits represented in payroll data",
              "One payroll run with an explicit review state",
            ],
          },
          {
            title: "Keep one-person payroll knowledge from becoming a business risk",
            body:
              "A small company may still have only one payroll operator, but the release decision does not have to live entirely with that person. Linaw supports distinct payroll, checker and owner responsibilities so another authorized person can review the run before money moves.",
            bullets: [
              "Payroll preparation role",
              "Independent checker approval",
              "Owner or authorized release control",
              "Audit evidence for sensitive actions",
            ],
          },
          {
            title: "Use Philippine payroll rules without turning filing status into a marketing claim",
            body:
              "Linaw calculates supported SSS, PhilHealth, Pag-IBIG and compensation-withholding amounts inside the payroll workflow. Government outputs remain clearly distinguished from agency acceptance so a prepared worksheet is not presented as automatically filed or certified.",
            bullets: [
              "Employee and employer statutory shares",
              "Withholding-tax calculation path",
              "13th-month and year-end payroll workflows",
              "Government outputs labelled by validation status",
            ],
          },
          {
            title: "Start with the payroll you already have",
            body:
              "You do not need to redesign the company before evaluating payroll software. Existing employee rosters can be imported, roles can be kept simple, and the first production decision should come only after opening balances and expected payroll totals have been reconciled.",
            bullets: [
              "CSV roster import with validation",
              "Opening-balance and YTD review",
              "Controlled first payroll",
              "Independent reconciliation before go-live",
            ],
          },
          {
            title: "Give employees access without giving them payroll-team access",
            body:
              "After release, employees can use self-service for their own payslips and payroll history while server-side authorization keeps other employees' payroll data outside their scope.",
            bullets: [
              "Employee-scoped self-service",
              "Payslip access after release",
              "Year-to-date payroll visibility",
              "Role boundaries enforced by the application",
            ],
          },
          {
            title: "Keep the option to outsource the repetitive cycle later",
            body:
              "If payroll processing itself becomes the constraint, the same product can support a managed payroll operating model. The employer still keeps approved inputs, exception decisions and final release authority.",
          },
        ]}
        faq={faq}
        related={[
          {
            label: "Payroll software pricing",
            href: "/pricing",
            description: "See the current Linaw plan structure and controlled trial-access path.",
          },
          {
            label: "Payroll implementation",
            href: "/implementation",
            description: "Plan employee-data migration, reconciliation and controlled go-live.",
          },
          {
            label: "Payroll outsourcing",
            href: "/payroll-outsourcing",
            description: "Compare self-operated payroll with a managed processing model.",
          },
          {
            label: "Payroll software vs Excel",
            href: "/resources/payroll-software-vs-excel",
            description: "Compare spreadsheets with a controlled payroll workflow.",
          },
        ]}
        ctaTitle="See the small-team payroll workflow before moving real data."
        ctaBody="Open the live demo with sample payroll, or book a walkthrough around your current cutoff, headcount and approval process."
      />
    </>
  );
}
