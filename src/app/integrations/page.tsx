import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Integrations Philippines | API & Webhooks | Linaw",
  description: "Connect Philippine payroll through scoped APIs, signed webhooks, biometric attendance input, accounting exports and supported payout handoffs for teams.",
  alternates: { canonical: "/integrations" },
};

export default function IntegrationsPage() {
  return (
    <SeoLandingPage
      eyebrow="Payroll integrations Philippines"
      title="Connect payroll to the systems around it."
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
        { title: "Know the difference between an API and an export", body: "Use APIs and webhooks when another system needs programmatic access or event delivery. Use controlled exports when the downstream workflow still expects a reviewed file or portal upload." },
        { title: "Keep integration claims evidence-based", body: "Linaw distinguishes implemented interfaces from future or vendor-specific connectors so buyers can see what is available now and what still depends on an external system or accepted file format." },
      ]}
      faq={[
        { question: "What payroll integrations does Linaw currently support?", answer: "The implemented connection surfaces include scoped API keys, employee and payroll-run APIs, HMAC-signed webhooks, a biometric synchronization route, accounting exports and supported payout outputs." },
        { question: "Does an export file count as a native integration?", answer: "No. Linaw treats file-based handoffs as exports and only describes an integration as native when there is an implemented programmatic connection or supported interface." },
        { question: "When should I use a webhook instead of polling the API?", answer: "Use webhooks when a downstream system needs event-driven notification. Use the API when it needs to request or update supported resources on demand." },
        { question: "Are all banks and government portals directly integrated?", answer: "No. Some workflows use controlled files or validation-gated outputs rather than direct portal integrations, and the product copy keeps those distinctions explicit." },
      ]}
      related={[
        { label: "Biometric attendance", href: "/integrations/biometrics", description: "Review authenticated device ingestion and punch matching." },
        { label: "Accounting exports", href: "/integrations/accounting-exports", description: "See released-payroll journal output and finance handoff." },
        { label: "Bank & payout files", href: "/integrations/bank-payout-exports", description: "Review dry runs, release gates and bank-template validation." },
        { label: "Developer center", href: "/developers", description: "Review API scopes, webhooks and security behavior." },
        { label: "Time & attendance", href: "/time-and-attendance", description: "See attendance data flow into payroll." },
        { label: "Payroll software", href: "/", description: "Explore the complete payroll workflow." },
      ]}
    />
  );
}
