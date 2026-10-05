import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Integrations Philippines | API, Webhooks & Exports | Linaw",
  description: "Payroll integration options including API access, signed webhooks, biometrics, accounting exports and supported payout outputs.",
  alternates: { canonical: "/integrations" },
};

export default function IntegrationsPage() {
  return (
    <SeoLandingPage
      eyebrow="Payroll integrations Philippines"
      title="Connect payroll without pretending every logo is an integration."
      intro="Linaw's integration story is based on implemented interfaces: scoped API keys, employee and payroll-run APIs, signed webhooks, biometric synchronization, accounting exports and supported payout outputs."
      proof={[
        "Scoped API keys",
        "Employee API",
        "Payroll-run API",
        "HMAC-signed webhooks",
        "Biometric sync endpoint",
        "Accounting and payout exports",
      ]}
      sections={[
        { title: "API access", body: "Company-wide administrators can create scoped API keys that are stored as hashes and shown only once at creation." },
        { title: "Webhooks", body: "Webhook endpoints use generated signing secrets, HMAC signatures and delivery-attempt logging so downstream systems can verify events." },
        { title: "Biometric and attendance input", body: "The application includes a biometric synchronization route and attendance workflows that can feed payroll-relevant time data." },
        { title: "Finance outputs", body: "Supported accounting and payout exports provide controlled handoff points without claiming a native integration where the product only produces a file." },
      ]}
      related={[
        { label: "Developer center", href: "/developers", description: "Review API scopes, webhooks and security behavior." },
        { label: "Time & attendance", href: "/time-and-attendance", description: "See attendance data flow into payroll." },
        { label: "Payroll software", href: "/", description: "Explore the complete payroll workflow." },
      ]}
    />
  );
}
