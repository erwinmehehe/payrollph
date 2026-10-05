import type { Metadata } from "next";
import { ProcurementChecklist } from "@/components/marketing/procurement-checklist";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll Software RFP Checklist Template Philippines | Linaw",
  description: "Interactive payroll software RFP checklist covering calculations, implementation, security, integrations, controls and vendor evidence.",
  alternates: { canonical: "/templates/payroll-rfp-checklist" },
};

const sections = [
  {
    title: "Payroll calculations",
    items: [
      { id: "calc-1", label: "Vendor demonstrates statutory payroll using realistic Philippine employee scenarios." },
      { id: "calc-2", label: "Overtime, night differential, holidays and rest-day combinations are demonstrated." },
      { id: "calc-3", label: "Taxable compensation and withholding logic are traceable." },
      { id: "calc-4", label: "Government contribution employee and employer shares are separately visible." },
      { id: "calc-5", label: "Historical rule versions or effective dates can be explained." },
    ],
  },
  {
    title: "Controls and approvals",
    items: [
      { id: "ctrl-1", label: "Payroll preparation and release can be assigned to different roles." },
      { id: "ctrl-2", label: "Exceptions remain visible until reviewed or resolved." },
      { id: "ctrl-3", label: "Audit records identify who changed, approved and released payroll." },
      { id: "ctrl-4", label: "Employee, department and organization access boundaries are enforced server-side." },
    ],
  },
  {
    title: "Implementation",
    items: [
      { id: "impl-1", label: "Vendor provides a documented employee/payroll data migration process." },
      { id: "impl-2", label: "Opening balances and year-to-date payroll values are reconciled." },
      { id: "impl-3", label: "A parallel or controlled payroll is completed before broad go-live." },
      { id: "impl-4", label: "Go-live blockers and sign-off owners are explicitly defined." },
    ],
  },
  {
    title: "Integrations and outputs",
    items: [
      { id: "int-1", label: "API capabilities are documented by endpoint and scope, not by a generic integrations claim." },
      { id: "int-2", label: "Webhook events and signature verification are documented where supported." },
      { id: "int-3", label: "Accounting, payout and government outputs are identified as native integrations or file exports accurately." },
    ],
  },
  {
    title: "Evidence and commercial terms",
    items: [
      { id: "evi-1", label: "Vendor distinguishes live capabilities, partial capabilities and roadmap items." },
      { id: "evi-2", label: "Pricing, implementation fees and recurring service costs are documented." },
      { id: "evi-3", label: "Security certifications are supported by actual evidence rather than marketing language." },
      { id: "evi-4", label: "Customer references or case studies use approved and verifiable outcomes." },
    ],
  },
];

export default function PayrollRfpChecklistPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Templates", path: "/templates/payroll-rfp-checklist" }, { name: "Payroll RFP checklist", path: "/templates/payroll-rfp-checklist" }]} />
      <SiteNav />
      <main className="py-12 sm:py-16">
        <div className="mx-auto max-w-[1100px] px-5 sm:px-8">
          <ProcurementChecklist
            title="Payroll Software RFP Checklist"
            description="Use this checklist during payroll software procurement to force concrete demonstrations of calculation depth, controls, implementation, integrations and evidence."
            sections={sections}
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
