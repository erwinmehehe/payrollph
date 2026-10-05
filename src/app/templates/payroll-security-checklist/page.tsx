import type { Metadata } from "next";
import { ProcurementChecklist } from "@/components/marketing/procurement-checklist";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll Software Security Checklist Philippines | Linaw",
  description: "Interactive security review checklist for payroll software authentication, authorization, sensitive data, API security, auditability and operations.",
  alternates: { canonical: "/templates/payroll-security-checklist" },
};

const sections = [
  {
    title: "Authentication and sessions",
    items: [
      { id: "auth-1", label: "Passwords use a modern one-way password hashing function." },
      { id: "auth-2", label: "Multi-factor authentication is available for sensitive access." },
      { id: "auth-3", label: "Login rate limiting and lockout controls exist." },
      { id: "auth-4", label: "Sessions can be revoked server-side." },
      { id: "auth-5", label: "Password-reset and invitation tokens are stored safely and expire." },
    ],
  },
  {
    title: "Authorization and tenant isolation",
    items: [
      { id: "access-1", label: "Organization membership is verified on the server for sensitive requests." },
      { id: "access-2", label: "Department or employee-level scope is enforced where required." },
      { id: "access-3", label: "The browser cannot gain access simply by changing an organization or employee ID." },
      { id: "access-4", label: "Critical actions can require stronger roles or independent review." },
    ],
  },
  {
    title: "Sensitive payroll data",
    items: [
      { id: "data-1", label: "Bank and government-identifier protection is documented." },
      { id: "data-2", label: "Encryption claims identify what is encrypted and where." },
      { id: "data-3", label: "Data-retention and deletion behavior is documented." },
      { id: "data-4", label: "Audit logs cover sensitive payroll and administration actions." },
    ],
  },
  {
    title: "API and webhook security",
    items: [
      { id: "api-1", label: "API keys are scoped, revocable and not stored in plaintext after creation." },
      { id: "api-2", label: "API endpoints enforce organization scope and rate limits." },
      { id: "api-3", label: "Webhook endpoints are validated against unsafe/private destinations." },
      { id: "api-4", label: "Webhook payloads are signed and receivers can verify signatures." },
      { id: "api-5", label: "Retries and delivery failures are logged." },
    ],
  },
  {
    title: "Operational evidence",
    items: [
      { id: "ops-1", label: "CI or automated security checks run before release." },
      { id: "ops-2", label: "Production-readiness gates exist for sensitive migrations or controls." },
      { id: "ops-3", label: "Certifications are distinguished from internal controls." },
      { id: "ops-4", label: "Incident response, backup and recovery claims can be evidenced." },
    ],
  },
];

export default function PayrollSecurityChecklistPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Templates", path: "/templates/payroll-security-checklist" }, { name: "Payroll security checklist", path: "/templates/payroll-security-checklist" }]} />
      <SiteNav />
      <main className="py-12 sm:py-16">
        <div className="mx-auto max-w-[1100px] px-5 sm:px-8">
          <ProcurementChecklist
            title="Payroll Software Security Checklist"
            description="Use these questions to evaluate enforceable payroll security controls. A vendor should be able to explain which controls are implemented, which are externally audited and which remain planned."
            sections={sections}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
