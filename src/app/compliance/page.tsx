import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Compliance Philippines | SSS, PhilHealth, BIR | Linaw",
  description: "Philippine payroll compliance workflows for statutory calculations, validation evidence, data requests, tax settlement and clearly labelled government output drafts.",
  alternates: { canonical: "/compliance" },
};

export default function CompliancePage() {
  return (
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
        { label: "Security", href: "/security", description: "Review security, access and protected-data controls." },
        { label: "Capability scorecard", href: "/scorecard", description: "Inspect verified, partial and absent capabilities with evidence." },
        { label: "Payroll outsourcing", href: "/payroll-outsourcing", description: "See how managed payroll keeps approval responsibility visible." },
      ]}
      ctaTitle="Verify the compliance workflow instead of trusting a blanket claim."
      ctaBody="Use the capability scorecard and role-based demo to inspect what is implemented, what is partial and what still requires external validation."
    />
  );
}
