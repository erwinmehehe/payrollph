import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Payroll Software Security Philippines | Controls | Linaw",
  description: "Philippine payroll software security covering tenant isolation, RBAC, TOTP MFA, encrypted sensitive fields, audit trails, sessions and security checks.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  return (
    <SeoLandingPage
      eyebrow="Payroll software security"
      title="Payroll security controls that are enforced on the request path."
      intro="Linaw's security story is built around concrete application controls such as tenant isolation, role checks, MFA, revocable sessions, protected sensitive fields and security-focused rollout gates."
      proof={[
        "TOTP multi-factor authentication before session creation",
        "Server-side revocable sessions with hashed tokens",
        "Cross-tenant membership enforcement",
        "Department-scoped RBAC",
        "Encrypted bank-account and government-ID storage paths",
        "CI, CodeQL and HTTP security smoke workflows",
      ]}
      sections={[
        {
          title: "Tenant isolation is enforced on the server",
          body: "Session-authenticated routes resolve organization membership instead of trusting an organization ID supplied by the browser.",
        },
        {
          title: "Authentication includes more than a password form",
          body: "The authentication implementation includes scrypt password hashing, durable lockout, distributed login rate limiting, TOTP MFA, backup codes, revocable sessions and hashed password-reset tokens.",
        },
        {
          title: "Sensitive payroll fields have dedicated protection paths",
          body: "Bank-account and government-ID encryption migrations exist, and production readiness can block rollout when payout-data encryption has not been proven.",
        },
        {
          title: "Security readiness is not the same as security certification",
          body: "This page describes controls evidenced in the repository. It does not claim ISO, SOC 2 or another certification that the project has not independently obtained.",
        },
      ]}
      related={[
        { label: "Capability scorecard", href: "/scorecard", description: "Inspect evidence attached to product and security claims." },
        { label: "Implementation", href: "/implementation", description: "See the rollout gates around production payroll." },
        { label: "Compliance", href: "/compliance", description: "Review privacy and statutory workflow controls." },
      ]}
    />
  );
}
