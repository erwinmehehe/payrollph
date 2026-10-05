import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Trust Center | Security, Status & Product Evidence | Linaw",
  description: "Linaw trust center for security controls, capability evidence, product status and rollout transparency.",
  alternates: { canonical: "/trust" },
};

export default function TrustPage() {
  return (
    <SeoLandingPage
      eyebrow="Linaw Trust Center"
      title="Trust payroll claims only when the evidence can be inspected."
      intro="Linaw separates implemented controls, partial capabilities, external dependencies and absent features so buyers can distinguish working product paths from roadmap or validation gaps."
      proof={[
        "Public capability scorecard",
        "Public system status page",
        "Security controls tied to code paths and tests",
        "Government filing outputs labelled by validation status",
        "Production-readiness gates",
        "Role-based product sandbox",
      ]}
      sections={[
        { title: "Capability evidence", body: "The public scorecard classifies product capabilities as verified, partial or absent and attaches specific implementation or test evidence to each claim." },
        { title: "Operational status", body: "The status page is separate from marketing claims and is designed to reflect application health evidence rather than a manually written uptime percentage." },
        { title: "Security controls", body: "Authentication, tenant authorization, role scope, sensitive-data protection and security testing are documented as implementation controls without implying certifications that have not been obtained." },
        { title: "Compliance transparency", body: "Payroll calculation capability and government filing acceptance are deliberately kept separate. Prepared output stays validation-gated until evidence exists." },
      ]}
      related={[
        { label: "Capability scorecard", href: "/scorecard", description: "Inspect verified, partial and absent capabilities." },
        { label: "Security", href: "/security", description: "Review request-path access and authentication controls." },
        { label: "System status", href: "/status", description: "See the public operational status surface." },
      ]}
    />
  );
}
