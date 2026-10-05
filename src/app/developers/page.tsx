import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll API Philippines | Developer Center | Linaw",
  description: "Linaw developer center covering scoped API keys, employee and payroll-run endpoints, HMAC-signed webhooks and delivery security.",
  alternates: { canonical: "/developers" },
};

export default function DevelopersPage() {
  return (
    <SeoLandingPage
      eyebrow="Payroll API Philippines"
      title="Developer access with explicit scopes and signed payroll events."
      intro="Linaw exposes implemented API and webhook primitives for connected payroll workflows while keeping credential creation and webhook administration behind company-wide administrator access and MFA-sensitive controls."
      proof={[
        "SHA-256 hashed API keys",
        "employees:read / employees:write / payroll:read scopes",
        "Employee endpoints",
        "Payroll-run endpoints",
        "HMAC-SHA256 webhook signatures",
        "Webhook target validation and delivery logging",
      ]}
      sections={[
        { title: "Scoped API keys", body: "API credentials are prefix-identified, revocable and stored only as hashes after the full key is shown once." },
        { title: "Payroll and employee resources", body: "Implemented public API paths include employees and payroll runs with scope checks and pagination rather than an undocumented catch-all interface." },
        { title: "Signed webhooks", body: "Webhook deliveries include an HMAC-SHA256 signature with a timestamp so receivers can verify authenticity and apply replay-tolerance rules." },
        { title: "Administrative controls", body: "Developer credential and webhook changes require organization authorization, company-wide administrator access and sensitive-action MFA checks." },
      ]}
      related={[
        { label: "Integrations", href: "/integrations", description: "See where API, webhook and export capabilities fit into the product." },
        { label: "Security", href: "/security", description: "Review authorization and session controls." },
        { label: "Capability scorecard", href: "/scorecard", description: "See evidence for the public API and webhook capability." },
      ]}
    />
  );
}
