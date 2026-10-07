import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll Software Trial Philippines | Linaw",
  description: "Request controlled trial access to Linaw payroll software in the Philippines, or explore the live role-based demo before requesting a workspace.",
  alternates: { canonical: "/trial" },
};

export default function TrialPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll software trial", path: "/trial" }]} />
      <SiteNav />
      <main>
        <section className="relative overflow-hidden border-b border-[#EDEFF7] py-16 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-40 -top-52 h-[620px] w-[680px] rounded-full bg-gradient-to-br from-[#e5f0ff] via-[#EAF4FF] to-[#e5f8f2] opacity-80 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-[1120px] px-5 sm:px-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#0868dc] shadow-sm">
              <ShieldCheck size={14} />
              Controlled trial access
            </span>
            <h1 className="font-display mt-6 max-w-[850px] text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[60px]">
              Try Linaw payroll software with the right workspace and roles.
            </h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">
              Explore the live role-based demo immediately. If you want a dedicated trial workspace, request access with your company and headcount so Linaw can provision the correct organization structure and permissions.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-full bg-[#0877ff] px-6 py-3.5 text-[14px] font-semibold text-white">
                Request trial access
              </Link>
              <Link href="/demo" className="inline-flex items-center gap-2 rounded-full border border-[#D9DCEC] px-6 py-3.5 text-[14px] font-semibold">
                Explore live demo <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1120px] gap-5 px-5 sm:px-8 md:grid-cols-3">
            {[
              ["Start with the live demo", "Review Owner, HR, Payroll, Checker, Bookkeeper and Employee experiences before requesting a dedicated workspace."],
              ["Use sample data first", "Evaluate workflows without uploading a real payroll file or employee-sensitive production data."],
              ["Provision the right access", "Trial workspaces are invitation-based so company structure, tenant ownership and role access can be set up deliberately."],
            ].map(([title, body]) => (
              <article key={title} className="rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
                  <Check size={16} strokeWidth={2.8} />
                </span>
                <h2 className="font-display mt-4 text-[23px] font-semibold tracking-[-0.03em]">{title}</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[900px] px-5 sm:px-8">
            <h2 className="font-display text-[32px] font-semibold tracking-[-0.035em]">What “trial” means here</h2>
            <div className="mt-5 grid gap-4 text-[14px] leading-relaxed text-[#5B6080]">
              <p>The public demo is available immediately. A dedicated trial workspace is requested and provisioned rather than created anonymously.</p>
              <p>This page does not claim a specific free-trial duration, no-credit-card policy or automatic approval because those terms are not defined by the current product workflow.</p>
              <p>For pricing, use the published pricing page. For a guided evaluation against your own payroll process, book a demo.</p>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/pricing" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13.5px] font-semibold">View pricing</Link>
              <Link href="/book-demo" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13.5px] font-semibold">Book a demo</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
