import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "HRIS Philippines | Employee Records & Payroll | Linaw",
  description: "Philippine HRIS software for employee records, payroll-ready data, onboarding, lifecycle tasks, approvals and role-based workforce administration.",
  alternates: { canonical: "/hris" },
};

const faq = [
  {
    question: "What is the difference between HRIS and payroll software?",
    answer: "HRIS manages employee and workforce records, while payroll calculates pay and deductions. Linaw connects the two so employee setup, access, schedules and payroll-relevant data do not have to be maintained in separate systems.",
  },
  {
    question: "Can Linaw import an existing employee roster?",
    answer: "Yes. The employee import workflow supports CSV input, row-level validation and updates by employee number so an existing roster can be migrated without blindly duplicating employees.",
  },
  {
    question: "Can HR users be limited to a department or organization unit?",
    answer: "Yes. Linaw applies organization membership and scoped access on the server so workforce administration can be limited instead of relying only on hidden interface controls.",
  },
  {
    question: "How do employee record changes affect payroll?",
    answer: "Payroll-relevant employee data is used by downstream payroll, attendance, benefits, payslip and separation workflows. Sensitive changes remain auditable rather than becoming untracked spreadsheet edits.",
  },
  {
    question: "Do employees get their own self-service access?",
    answer: "Yes. Employee self-service is linked to the employee record and is scoped to the signed-in employee's own payroll information.",
  },
];

export default function HrisPage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "HRIS Philippines", path: "/hris" }]}
        service={{
          name: "HRIS Philippines",
          description: "Philippine HRIS software connected to payroll-ready employee records, workforce administration and employee self-service.",
          path: "/hris",
        }}
        faq={faq}
      />
      <SeoLandingPage
      eyebrow="HRIS Philippines"
      title="HRIS software connected to the payroll work that follows."
      intro="Linaw keeps employee records, organizational access, onboarding and payroll workflows in one Philippine HR and payroll workspace instead of making HR maintain disconnected records."
      proof={[
        "Employee records with payroll-relevant fields and organization scope",
        "CSV employee import with row-level validation and update-by-employee-number behavior",
        "Onboarding and offboarding lifecycle tasks",
        "Department-scoped access and role-based permissions",
        "Employee self-service connected to each employee record",
        "Audit coverage for sensitive workforce changes",
      ]}
      sections={[
        {
          title: "A payroll-ready employee system of record",
          body: "Employee data is not a decorative directory. Linaw uses employee records throughout payroll, statutory computation, bank output, self-service and lifecycle workflows.",
          bullets: ["Employee number and employment details", "Pay configuration and rest-day history", "Government IDs with protected storage paths", "Optional email and employee self-service linkage"],
        },
        {
          title: "Bring existing employee data in without rebuilding everything",
          body: "The import workflow accepts existing CSV rosters, tolerates extra columns, reports row-level errors and updates matching employees instead of blindly duplicating them.",
          bullets: ["CSV starter template", "Quoted and formatted numeric values", "Specific validation messages", "Idempotent updates by employee number"],
        },
        {
          title: "Control who can see and change workforce data",
          body: "The application enforces organization membership and department scope on the server, not only in the interface.",
          bullets: ["Tenant isolation", "Department-scoped RBAC", "Owner, HR, payroll, checker and employee role boundaries", "Audit trail for sensitive operations"],
        },
        {
          title: "Move naturally from HR administration into payroll",
          body: "Employee setup flows into time, payroll, benefits, leave, approvals, payslips and separation rather than ending in an isolated HR database.",
        },
        {
          title: "Keep lifecycle changes traceable",
          body: "Onboarding, role changes, separation and payroll-relevant employee updates should have an accountable system of record instead of being reconstructed from chat messages and spreadsheet versions.",
        },
      ]}
      faq={faq}
      related={[
        { label: "Time & attendance", href: "/time-and-attendance", description: "Connect raw time data, scheduling and exceptions to payroll." },
        { label: "Employee self-service", href: "/employee-self-service", description: "Give employees access to their own payslips and payroll information." },
        { label: "Implementation", href: "/implementation", description: "See how existing employee and payroll data can be migrated into Linaw." },
      ]}
    />
    </>
  );
}
