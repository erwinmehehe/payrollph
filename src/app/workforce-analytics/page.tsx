import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Workforce Analytics Philippines | Payroll Reports | Linaw",
  description: "Workforce analytics and payroll reporting for Philippine teams, including headcount movement, payroll cost, compliance exceptions, CSV exports and payroll variance review.",
  alternates: { canonical: "/workforce-analytics" },
};

export default function WorkforceAnalyticsPage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Workforce analytics", path: "/workforce-analytics" }]}
        service={{
          name: "Workforce Analytics and Payroll Reporting",
          description: "Operational workforce and payroll reporting for Philippine employers.",
          path: "/workforce-analytics",
        }}
      />
      <SeoLandingPage
      workflow={{"title":"Explain a payroll change before the next decision.","steps":[{"title":"Choose the comparison","owner":"Payroll or finance","detail":"Review recorded payroll periods and the organization scope relevant to your question."},{"title":"Investigate the movement","owner":"Authorized reviewer","detail":"Inspect cost totals, headcount and payroll variance categories rather than relying on a single headline number."},{"title":"Prepare the handoff","owner":"Finance team","detail":"Export supported report results as CSV and retain the audit record of the export."}]}}
      simulationArea="reports"
        eyebrow="Workforce analytics Philippines"
        title="What changed in payroll—and what needs a closer look?"
        intro="Linaw's analytics layer focuses on operational reporting: headcount movement, payroll cost history, workforce-status indicators, compliance exceptions and payroll variance. The reports come from organization-scoped application data rather than a separate predictive analytics product."
        proof={[
          "Headcount movement report",
          "Payroll cost history",
          "Workforce-status indicators",
          "Compliance exception report",
          "CSV report export",
          "Payroll variance analysis",
        ]}
        sections={[
          {
            title: "Review headcount movement by employment type and status",
            body: "The headcount report groups workforce records by employment type and current status so People and payroll teams can review active, leave, disciplinary and separating populations without rebuilding the same view in a spreadsheet.",
          },
          {
            title: "Track payroll cost by released or stored run",
            body: "Payroll cost reporting uses recorded payroll runs to show employee count, gross pay, deductions and net pay by period and scope. The workspace also visualizes gross, net and deductions across stored runs.",
          },
          {
            title: "Use workforce-status indicators without pretending they are predictive AI",
            body: "The turnover report expresses separating and disciplinary headcount as a share of the workforce. It is an operational indicator derived from current employee statuses, not a predictive attrition model or machine-learning forecast.",
          },
          {
            title: "Surface compliance and payroll exceptions",
            body: "The compliance report counts incomplete punches, missing clock-outs, flagged payroll entries and payroll runs on record so teams can identify operational exceptions that need review.",
          },
          {
            title: "Compare payroll runs with variance categories",
            body: "Payroll variance analysis compares a current run with a prior released run and can classify changes such as salary changes, overtime spikes, retro pay, new hires, separations, bank-detail changes, statutory changes and net-pay variance.",
          },
          {
            title: "Export report results with an audit trail",
            body: "Supported reports can be exported as CSV. Report export activity records an audit event so the handoff remains traceable rather than becoming an undocumented spreadsheet download.",
          },
          {
            title: "Keep company-wide analytics role-controlled",
            body: "Company analytics require authenticated People or payroll roles with company-wide access. Unit-scoped roles cannot use the company-wide reporting endpoint, and employee self-service accounts cannot access the company dashboard.",
          },
        ]}
        faq={[
          {
            question: "What workforce analytics reports are available in Linaw?",
            answer: "The implemented reporting layer includes headcount movement, payroll cost, workforce-status/turnover indicators and compliance exception reports, plus payroll-run variance analysis.",
          },
          {
            question: "Can payroll reports be exported to CSV?",
            answer: "Yes. The report endpoint supports CSV output for the implemented report types, and the export action records an audit event.",
          },
          {
            question: "Does Linaw use predictive AI for turnover risk?",
            answer: "No predictive attrition model is claimed. The current turnover view is an operational indicator calculated from employee statuses such as separating and disciplinary populations.",
          },
          {
            question: "Who can access company-wide analytics?",
            answer: "The reporting API requires authenticated People or payroll administration access and company-wide scope. Unit-scoped roles are blocked from company-wide analytics.",
          },
          {
            question: "What does payroll variance analysis look for?",
            answer: "Variance analysis can flag categories including exceptions, salary changes, overtime spikes, retro pay, new hires, missing employees, separations, bank-detail changes, statutory changes and net-pay variance.",
          },
        ]}
        related={[
          { label: "Payroll software", href: "/", description: "See the payroll workflow that generates the underlying payroll-run data." },
          { label: "Time & attendance", href: "/time-and-attendance", description: "Review the attendance inputs behind payroll and compliance exceptions." },
          { label: "Payroll compliance audit", href: "/compliance/payroll-audit", description: "Use reconciliation and exception evidence after payroll release." },
          { label: "Security", href: "/security", description: "Review role, tenant and sensitive-data controls around workforce reporting." },
        ]}
      />
    </>
  );
}
