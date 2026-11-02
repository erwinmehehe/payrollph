import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { FictionalProductTour } from "@/components/marketing/fictional-product-tour";

export const metadata: Metadata = {
  title: "Fictional Product Tour | Linaw",
  description: "Explore read-only fictional HR, payroll, checker, owner, bookkeeper and employee workflows without signing in or changing any records.",
  robots: { index: false, follow: false },
};

export default function ProductTourPage() {
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Product tour", path: "/tour" }]} />
      <SiteNav />
      <main>
        <header className="border-b border-[#E4EAF4] bg-white py-14 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0868dc]"><ArrowLeft size={16} aria-hidden="true" /> Back to Linaw</Link>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.15em] text-[#0877ff]">Interactive product orientation · fictional examples</p>
            <h1 className="font-display mt-4 max-w-[940px] text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-[60px]">See how people work together without touching payroll.</h1>
            <p className="mt-5 max-w-[780px] text-base leading-relaxed text-[#555C76]">Choose a role and move through a three-step illustration. Everything here is sample copy, not a live payroll session, product certification or recorded business action.</p>
          </div>
        </header>
        <FictionalProductTour />
      </main>
      <SiteFooter />
    </div>
  );
}
