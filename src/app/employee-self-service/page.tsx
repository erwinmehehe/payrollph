import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Employee Self-Service Philippines | Payroll Portal | Linaw",
  description: "Employee self-service for Philippine payroll with personal payslips, year-to-date figures, payroll history, PDF downloads and employee-scoped access controls.",
  alternates: { canonical: "/employee-self-service" },
};

const faq = [
  {
    question: "What can employees see in Linaw self-service?",
    answer: "Employees can access their own payroll information such as payslip history, year-to-date figures and per-period payroll details through the employee-scoped portal.",
  },
  {
    question: "Can one employee view another employee's payslip?",
    answer: "No. The employee identity is resolved on the server, and inaccessible colleague payslips return a not-found response rather than trusting a client-supplied employee ID.",
  },
  {
    question: "When do employees get access to a payslip?",
    answer: "Payslip access is tied to the payroll workflow and release state so employee self-service does not become a separate uncontrolled copy of draft payroll data.",
  },
  {
    question: "Can employees download PDF payslips?",
    answer: "Yes. Linaw generates downloadable PDF payslips from payroll entries and exposes them through the employee-specific self-service path.",
  },
  {
    question: "Does employee self-service give users HR or payroll administrator access?",
    answer: "No. Employee access is a separate role boundary and is limited to the employee's own permitted data and actions.",
  },
];

export default function EmployeeSelfServicePage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Employee self-service", path: "/employee-self-service" }]}
        service={{
          name: "Employee Self-Service Philippines",
          description: "Employee payroll portal for personal payslips, payroll history, year-to-date figures and employee-scoped access.",
          path: "/employee-self-service",
        }}
        faq={faq}
      />
      <SeoLandingPage
      workflow={{"title":"Answer “what was I paid?” without another email.","steps":[{"title":"Open your own portal","owner":"Employee","detail":"Sign in to the personal view linked to your employee record."},{"title":"Inspect the pay period","owner":"Employee","detail":"Review released payslip details, deductions and available year-to-date figures."},{"title":"Keep your copy","owner":"Employee","detail":"Download the PDF payslip for your records. Company-wide payroll stays with authorized staff."}]}}
      simulationArea="employee"
      eyebrow="Employee self-service Philippines"
      title="Your payslip. Your pay history. Your own view."
      intro="Give employees a clear place to review their released payslips, deductions and year-to-date figures. Personal access keeps company-wide payroll information with the authorized team."
      proof={[
        "Personal payslip history",
        "Downloadable PDF payslips",
        "Year-to-date gross, net and tax figures",
        "Per-period payroll line items",
        "Personal employee access",
        "Company payroll access stays separate",
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
        {
          title: "Reduce recurring payroll support questions",
          body: "When released payroll history and payslips are available directly to the employee, payroll teams spend less time resending documents or manually looking up the same period totals.",
        },
      ]}
      faq={faq}
      related={[
        { label: "HRIS", href: "/hris", description: "See the employee record and lifecycle system behind self-service." },
        { label: "Payroll software", href: "/", description: "Explore the payroll engine that produces employee results." },
        { label: "Security", href: "/security", description: "Review the access and tenant-isolation controls around payroll data." },
      ]}
    />
    </>
  );
}
