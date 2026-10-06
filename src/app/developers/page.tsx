import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll API Philippines | Developer Tools & Webhooks | Linaw",
  description: "Linaw payroll API documentation for scoped keys, employee and payroll-run endpoints, HMAC-signed webhooks, delivery security and administrator controls.",
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
        { title: "Design integrations around explicit scopes", body: "A key should receive only the permissions required by the connected workflow. The current scope model separates employee read/write access from payroll-run read access instead of issuing an unrestricted application token." },
        { title: "Treat webhook verification as part of the integration", body: "Receivers should verify the signature and timestamp before trusting a payroll event, then handle retries and duplicate delivery safely on their side." },
      ]}
      faq={[
        { question: "How are Linaw API keys stored?", answer: "The full key is shown at creation, while the persisted credential is stored as a SHA-256 hash with an identifying prefix so it can be revoked without retaining the secret value." },
        { question: "What API scopes are available today?", answer: "The current implementation exposes explicit employee read, employee write and payroll read scopes rather than one unrestricted API permission." },
        { question: "How are payroll webhooks authenticated?", answer: "Webhook deliveries use HMAC-SHA256 signatures with a timestamp so the receiving system can verify that the event was sent with the configured signing secret." },
        { question: "Who can create API keys or change webhook settings?", answer: "Those mutations are restricted to authorized company-wide administrators and protected by sensitive-action controls, including MFA-sensitive checks in production workflows." },
      ]}
      related={[
        { label: "Authentication & scopes", href: "/developers/authentication", description: "Create, scope and revoke API credentials safely." },
        { label: "Employees API", href: "/developers/employees", description: "Read and create employee records with idempotency support." },
        { label: "Payroll Runs API", href: "/developers/payroll-runs", description: "Read payroll run summaries with payroll:read scope." },
        { label: "Webhooks", href: "/developers/webhooks", description: "Verify signed events and understand delivery retries." },
        { label: "Integrations", href: "/integrations", description: "See where API, webhook and export capabilities fit into the product." },
        { label: "Security", href: "/security", description: "Review authorization and session controls." },
      ]}
    />
  );
}
