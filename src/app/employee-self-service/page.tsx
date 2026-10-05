import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Employee Self-Service Philippines | Payroll Portal | Linaw",
  description: "Employee self-service for Philippine payroll with personal payslips, year-to-date payroll figures and employee-scoped access controls.",
  alternates: { canonical: "/employee-self-service" },
};

export default function EmployeeSelfServicePage() {
  return (
    <SeoLandingPage
      eyebrow="Employee self-service Philippines"
      title="A payroll self-service portal scoped to the employee who signed in."
      intro="Linaw gives employees direct access to their own payroll information while server-side employee scoping prevents the portal from trusting a client-supplied employee ID."
      proof={[
        "Personal payslip history",
        "Downloadable PDF payslips",
        "Year-to-date gross, net and tax figures",
        "Per-period payroll line items",
        "Employee-scoped API access",
        "404 behavior for inaccessible colleague payslips",
      ]}
      sections={[
        {
          title: "Give employees the answers payroll repeatedly gets asked for",
          body: "Employees can review their own payslips and payroll totals without requiring payroll administrators to resend the same information each cutoff.",
        },
        {
          title: "Keep self-service actually self-scoped",
          body: "The employee portal resolves the signed-in employee on the server. It does not accept another employee ID and then rely on the interface to hide the result.",
        },
        {
          title: "Use generated payslips, not screenshots",
          body: "Linaw generates downloadable PDF payslips from payroll entries and exposes them through the employee-specific path.",
        },
        {
          title: "Separate employee access from administrator access",
          body: "Employee linking is guarded so administrator accounts cannot be casually converted into employee accounts and locked out of their workspace.",
        },
      ]}
      related={[
        { label: "HRIS", href: "/hris", description: "See the employee record and lifecycle system behind self-service." },
        { label: "Payroll software", href: "/", description: "Explore the payroll engine that produces employee results." },
        { label: "Security", href: "/security", description: "Review the access and tenant-isolation controls around payroll data." },
      ]}
    />
  );
}
