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
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Book a payroll demo", path: "/book-demo" }]} />
      <SiteNav />

      <main>
        <section className="relative overflow-hidden py-16 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -left-40 -top-48 h-[560px] w-[620px] rounded-full bg-gradient-to-br from-[#e5f8f2] via-[#EAF4FF] to-[#e5f0ff] opacity-80 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-[1120px] gap-9 px-5 sm:px-8 lg:grid-cols-[.86fr_1.14fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#0868dc] shadow-sm">
                <ShieldCheck size={14} />
                20-minute payroll walkthrough
              </span>

              <h1 className="font-display mt-6 text-balance text-[43px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[58px]">
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
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
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
