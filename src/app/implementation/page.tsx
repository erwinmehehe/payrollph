import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll System Implementation Philippines | Guide | Linaw",
  description: "Philippine payroll implementation and migration for employee data, opening balances, roles, parallel payroll, reconciliation and controlled go-live planning.",
  alternates: { canonical: "/implementation" },
};

const faq = [
  {
    question: "What data should be prepared for a payroll system migration?",
    answer: "Prepare employee master data, pay setup, year-to-date balances, schedules and rest days, recurring deductions, benefits, government identifiers, bank details where needed, and the approval roles that own each payroll handoff.",
  },
  {
    question: "Should we run parallel payroll before going live?",
    answer: "A controlled comparison is one of the strongest ways to validate a migration. Reconcile gross pay, deductions, statutory contributions, tax, net pay, payout totals, payslips and accounting outputs before broad rollout.",
  },
  {
    question: "How long does payroll implementation take?",
    answer: "There is no universal duration. Timing depends on data quality, workforce complexity, integrations, approval design, reconciliation effort and how quickly open differences can be resolved.",
  },
  {
    question: "Who should approve payroll go-live?",
    answer: "Go-live should be an explicit business decision based on reconciled evidence, resolved blockers and assigned ownership rather than an automatic result of completing a software setup checklist.",
  },
  {
    question: "Can we evaluate Linaw before uploading production payroll data?",
    answer: "Yes. The public demo uses sample data, and controlled trial access can be requested before production payroll information is migrated.",
  },
];

export default function ImplementationPage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll implementation", path: "/implementation" }]}
        service={{
          name: "Payroll System Implementation Philippines",
          description: "Payroll migration and implementation workflow covering employee data, roles, reconciliation and controlled go-live.",
          path: "/implementation",
        }}
        faq={faq}
      />
      <SeoLandingPage
      eyebrow="Payroll implementation Philippines"
      title="Move payroll systems with visible validation at every handoff."
      intro="Linaw includes migration and rollout workflows designed to make payroll implementation reviewable: import existing employee data, configure payroll rules and roles, validate outputs, run controlled payroll and keep launch gates explicit."
      proof={[
        "CSV employee migration with validation",
        "Migration center workflow",
        "Role-based payroll handoffs",
        "Readiness endpoint with launch blockers",
        "Independent production payroll sign-off gate",
        "Controlled trial and demo access paths",
      ]}
      sections={[
        {
          title: "1. Map the current payroll operation",
          body: "Start with pay frequency, employee structure, schedules, approval roles, benefits, deductions, payroll outputs and the data that must move.",
        },
        {
          title: "2. Import and validate employee data",
          body: "Use the employee import workflow to map existing roster data, identify row-level issues and avoid accidental duplicate employees.",
        },
        {
          title: "3. Configure roles and payroll controls",
          body: "Set up the operating chain around HR, payroll processing, checker review, owner release and employee self-service rather than giving every user broad access.",
        },
        {
          title: "4. Reconcile a real payroll before broad rollout",
          body: "The repository's launch process explicitly requires independent comparison of gross pay, deductions, statutory contributions, tax, net pay, payout totals, payslips and accounting outputs before declaring a production payroll proven.",
        },
        {
          title: "5. Make go-live an explicit evidence-based decision",
          body: "A configured workspace is not the same as a proven payroll operation. Record remaining blockers, assign owners and approve go-live only after the required reconciliation and external dependencies are understood.",
        },
      ]}
      faq={faq}
      related={[
        { label: "HRIS", href: "/hris", description: "See the employee-data foundation used during migration." },
        { label: "Security", href: "/security", description: "Review rollout controls for sensitive payroll data." },
        { label: "Live demo", href: "/demo", description: "Walk through the product by payroll role before implementation." },
      ]}
    />
    </>
  );
}
