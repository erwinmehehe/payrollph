import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, FileCheck2, ShieldCheck } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

const groups = [
  {
    title: "HR checklists",
    description: "Six blank checklists for onboarding, offboarding, leave coverage, equipment, probation check-ins and records review.",
    href: "/templates/hr-checklists",
    label: "Browse HR templates",
    icon: ClipboardCheck,
  },
  {
    title: "Payroll RFP checklist",
    description: "A buyer's checklist for evaluating payroll vendors, implementation responsibilities and operational fit.",
    href: "/templates/payroll-rfp-checklist",
    label: "Open RFP checklist",
    icon: FileCheck2,
  },
  {
    title: "Payroll security checklist",
    description: "Review access controls, audit records, payroll-data handling and evidence when evaluating vendors.",
    href: "/templates/payroll-security-checklist",
    label: "Open security checklist",
    icon: ShieldCheck,
  },
];

export const metadata: Metadata = {
  title: "Payroll & HR Templates Philippines | Linaw",
  description: "Browse practical blank HR checklists and payroll buyer templates for Philippine teams. Download, print and adapt them to your own policies.",
  alternates: { canonical: "/templates" },
};

export default function TemplatesIndexPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Templates", path: "/templates" }]} />
      <SiteNav />
      <main>
        <header className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#0877ff]">Practical templates</p>
            <h1 className="font-display mt-4 max-w-[850px] text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-[58px]">
              Useful HR and payroll checklists. Without the blank-page problem.
            </h1>
            <p className="mt-5 max-w-[760px] text-base leading-relaxed text-[#555C76]">
              Plan handovers, organize employee lifecycle tasks, and evaluate software with editable checklists.
              Templates are guides, not completed compliance checks, approvals or employee records.
            </p>
          </div>
        </header>
        <div className="mx-auto grid max-w-[1180px] gap-4 px-5 py-12 sm:px-8 sm:py-16 md:grid-cols-3">
          {groups.map(({ title, description, href, label, icon: Icon }) => (
            <article key={href} className="rounded-[22px] border border-[#E4E6F0] bg-[#FAFBFD] p-6">
              <span className="inline-flex rounded-xl bg-[#E9F2FF] p-3 text-[#0868dc]"><Icon size={22} aria-hidden="true" /></span>
              <h2 className="font-display mt-5 text-xl font-semibold">{title}</h2>
              <p className="mt-3 min-h-20 text-sm leading-relaxed text-[#5B6080]">{description}</p>
              <Link href={href} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#0868dc]">{label}<ArrowRight size={15} aria-hidden="true" /></Link>
            </article>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
