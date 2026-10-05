import type { Metadata } from "next";
import { Check, ShieldCheck } from "lucide-react";
import { BookDemoForm } from "@/components/marketing/book-demo-form";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book Payroll Software Demo Philippines | Linaw",
  description: "Book a guided Linaw payroll software demo for your Philippine payroll workflow, headcount, entity structure, approvals, exceptions and exports.",
  alternates: { canonical: "/book-demo" },
};

export default function BookDemoPage() {
  return (
    <div className="marketing-page min-h-screen bg-white text-[#101323]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Book a payroll demo", path: "/book-demo" }]} />
      <SiteNav />

      <main>
        <section className="relative overflow-hidden bg-[#FCFCFD] py-16 sm:py-20">
          <div className="relative mx-auto grid max-w-[1120px] gap-9 px-5 sm:px-8 lg:grid-cols-[.86fr_1.14fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <span className="inline-flex items-center gap-2 border-l-2 border-[#444CE7] pl-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#444CE7]">
                <ShieldCheck size={14} />
                20-minute payroll walkthrough
              </span>

              <h1 className="font-display mt-6 text-balance text-[42px] font-semibold leading-[1.04] tracking-[-0.05em] sm:text-[56px]">
                Bring your actual payroll questions.
              </h1>
              <p className="mt-5 text-[16px] leading-relaxed text-[#5B6080]">
                The useful version of this call is not a slide deck. Share your headcount, entity structure and the part of cutoff that creates rework, and we will walk through that flow in Linaw.
              </p>

              <div className="mt-7 grid gap-3">
                {[
                  "A semi-monthly run from prepare to approval, release and export",
                  "How attendance exceptions reach payroll without inventing hours",
                  "How Owner, HR, Payroll, Checker and Employee permissions differ",
                  "What government worksheets contain and why they remain DRAFT until validated",
                ].map((line) => (
                  <span key={line} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#3E435B]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3FAF0] text-[#0A8A53]">
                      <Check size={12} strokeWidth={2.8} />
                    </span>
                    {line}
                  </span>
                ))}
              </div>

            </div>

            <BookDemoForm />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
