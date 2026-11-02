import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { HrTemplateLibrary } from "@/components/marketing/hr-template-library";

export const metadata: Metadata = {
  title: "Free HR Checklist Templates Philippines | Linaw",
  description: "Blank, printable HR checklist templates for onboarding, offboarding, leave handoffs, asset returns, probation check-ins and employee file review.",
  alternates: { canonical: "/templates/hr-checklists" },
};

export default function HrChecklistsPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Templates", path: "/templates" }, { name: "HR checklists", path: "/templates/hr-checklists" }]} />
      <SiteNav />
      <main>
        <header className="hr-template-intro border-b border-[#EDEFF7] bg-white py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <Link href="/templates" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0868dc]"><ArrowLeft size={15} aria-hidden="true" /> All templates</Link>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[#0877ff]">HR template library</p>
            <h1 className="font-display mt-3 max-w-[880px] text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-[55px]">
              Start with a useful checklist. Keep the official record in your HR system.
            </h1>
            <p className="mt-4 max-w-[800px] text-base leading-relaxed text-[#555C76]">
              Choose a checklist, preview the items, print, or download a blank CSV. Nothing you tick here is submitted, saved, or used to change an employee record.
            </p>
          </div>
        </header>
        <HrTemplateLibrary />
      </main>
      <SiteFooter />
    </div>
  );
}
