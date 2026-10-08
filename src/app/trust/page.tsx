import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Trust Center | Security & Product Evidence | Linaw",
  description: "Inspect Linaw payroll security controls, capability evidence, product status, rollout gates and validation limits before relying on a payroll product claim.",
  alternates: { canonical: "/trust" },
};

export default function TrustPage() {
  return (
    <SeoLandingPage
      directoryTitle="Find the evidence for your buying decision."
      directoryGroups={[{"title":"Product claims","description":"Inspect what is implemented and how capability evidence is classified.","links":[{"label":"Capability scorecard","href":"/scorecard","description":"Review verified, partial and absent capabilities."},{"label":"Evidence methodology","href":"/methodology","description":"Understand the limits of the evidence."}]},{"title":"Access and operation","description":"Review security implementation and the public status surface separately.","links":[{"label":"Security controls","href":"/security","description":"Authentication, authorization and sensitive-data protection."},{"label":"System status","href":"/status","description":"Inspect reported operational health."}]},{"title":"Payroll rollout","description":"Review implementation requirements and supported compliance workflows.","links":[{"label":"Implementation","href":"/implementation","description":"Prepare data, reconcile payroll and assign sign-off owners."},{"label":"Compliance","href":"/compliance","description":"Distinguish calculations and prepared outputs from filing acceptance."}]}]}
      eyebrow="Linaw Trust Center"
      title="Inspect the evidence behind your payroll decision."
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
        { title: "External dependencies remain visible", body: "Email delivery, billing proof, bank-template acceptance and government filing validation are tracked as operational dependencies instead of being hidden behind a generic production-ready badge." },
        { title: "The sandbox is proof of workflow, not certification", body: "The role-based demo lets buyers inspect how work moves between payroll, checker, owner and employee views, while the trust center separately documents what still requires external validation." },
      ]}
      faq={[
        { question: "What does verified, partial or absent mean in the capability scorecard?", answer: "Verified means the capability has implementation and supporting evidence in the product. Partial means an important part is present but a dependency or validation gap remains. Absent means the product does not currently claim that capability." },
        { question: "Does a green CI run mean payroll is certified for production?", answer: "No. Automated tests prove code behavior under the tested scenarios. Independent payroll reconciliation, operational evidence and external acceptance checks remain separate launch gates." },
        { question: "Does Linaw claim ISO or SOC 2 certification?", answer: "No. The trust and security pages describe implemented controls and test evidence without implying certifications the project has not independently obtained." },
        { question: "How are government filing claims handled?", answer: "Payroll calculations and generated government outputs are kept separate from agency acceptance. Outputs remain validation-gated until appropriate evidence exists." },
      ]}
      related={[
        { label: "Capability scorecard", href: "/scorecard", description: "Inspect verified, partial and absent capabilities." },
        { label: "Security", href: "/security", description: "Review request-path access and authentication controls." },
        { label: "System status", href: "/status", description: "See the public operational status surface." },
      ]}
    />
  );
}
