import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll Compliance Philippines | Statutory Payroll | Linaw",
  description: "Philippine payroll compliance workflows for SSS, PhilHealth, Pag-IBIG, BIR tax, rule governance, privacy requests and validation-gated filing outputs.",
  alternates: { canonical: "/compliance" },
};

export default function CompliancePage() {
  return (
    <>
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll compliance", path: "/compliance" }]} />
      <SeoLandingPage
        eyebrow="Payroll compliance Philippines"
        title="Compliance support with evidence, validation states and fewer hidden assumptions."
        intro="Linaw separates payroll calculation from filing readiness. Statutory calculations can be tested and traced while government output remains clearly labelled until it has been validated in the relevant official workflow."
        proof={[
          "SSS, PhilHealth, Pag-IBIG and TRAIN computation paths",
          "Compliance rules registry",
          "Government filing validation evidence records",
          "Data-subject request workflows",
          "Year-end tax settlement support",
          "Government worksheets labelled DRAFT until validated",
        ]}
        sections={[
          {
            title: "Calculate statutory payroll figures without pretending that calculation equals filing",
            body: "Payroll computation covers Philippine statutory deductions and tax logic, while government submission formats carry their own explicit validation status.",
          },
          {
            title: "Keep filing readiness evidence-based",
            body: "The application records validation evidence for government filing outputs instead of using a marketing flag to declare them ready.",
            bullets: ["BIR Alphalist / 2316 validation gate", "SSS R-3 validation gate", "PhilHealth RF-1 validation gate", "Pag-IBIG MCRF validation gate"],
          },
          {
            title: "Track rules and operational compliance separately",
            body: "A compliance rules registry and operational compliance records make it possible to distinguish legal-rule configuration from an individual payroll run or filing artifact.",
          },
          {
            title: "Support privacy obligations as an operational workflow",
            body: "Data requests include access, correction, deletion, portability and objection types with audit coverage, an internal response deadline and legal-retention review where required.",
          },
        ]}
        related={[
          { label: "BIR payroll compliance", href: "/compliance/bir", description: "Withholding, annualization and government reporting workflows." },
          { label: "BIR Form 2316", href: "/compliance/bir-2316", description: "Employee compensation and tax certificate data." },
          { label: "BIR Form 1601-C", href: "/compliance/1601-c", description: "Monthly withholding remittance context." },
          { label: "Compliance calendar", href: "/compliance/calendar", description: "Manage deadlines using current official sources." },
          { label: "Regulatory updates", href: "/resources/updates", description: "Track dated government payroll changes." },
          { label: "Payroll compliance audit", href: "/compliance/payroll-audit", description: "Reconcile payroll liabilities and evidence after release." },
        ]}
        ctaTitle="Verify the compliance workflow instead of trusting a blanket claim."
        ctaBody="Use the capability scorecard and role-based demo to inspect what is implemented, what is partial and what still requires external validation."
      />
    </>
  );
}
