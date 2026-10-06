import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Implementation Philippines | Migration Guide | Linaw",
  description: "Philippine payroll implementation and migration for employee data, opening balances, roles, parallel payroll, reconciliation and controlled go-live planning.",
  alternates: { canonical: "/implementation" },
};

export default function ImplementationPage() {
  return (
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
      ]}
      related={[
        { label: "HRIS", href: "/hris", description: "See the employee-data foundation used during migration." },
        { label: "Security", href: "/security", description: "Review rollout controls for sensitive payroll data." },
        { label: "Live demo", href: "/demo", description: "Walk through the product by payroll role before implementation." },
      ]}
    />
  );
}
