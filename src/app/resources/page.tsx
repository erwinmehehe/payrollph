import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { resourcePages } from "@/lib/seo-content";
import { resourceWave2 } from "@/lib/seo-content-wave2";
import { resourceWave3 } from "@/lib/seo-content-wave3";
import { resourceWave14 } from "@/lib/seo-content-wave14";
import { resourceWave16 } from "@/lib/seo-content-wave16";

const resources = [...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16];
const bySlug = new Map(resources.map((page) => [page.slug, page]));

const resourceGroups = [
  {
    title: "Choose and compare payroll software",
    description: "Shortlist systems using evidence, operating fit, security, deployment model and total cost instead of a generic feature checklist.",
    slugs: [
      "best-payroll-software-philippines",
      "payroll-system-comparison",
      "payroll-rfp-checklist",
      "payroll-software-vs-excel",
      "cloud-vs-on-premise-payroll",
      "build-vs-buy-payroll-software",
      "hris-vs-payroll-system",
      "payroll-software-roi",
      "payroll-security-checklist",
    ],
  },
  {
    title: "Implement and operate payroll",
    description: "Plan migration, cutoff discipline, reconciliation, payslips, annualization and the recurring controls that keep each cycle stable.",
    slugs: [
      "payroll-migration-checklist",
      "payroll-implementation-guide",
      "payroll-process-philippines",
      "payroll-cutoff",
      "common-payroll-errors",
      "payroll-audit-checklist",
      "payslip-guide",
      "payroll-annualization",
    ],
  },
  {
    title: "Understand pay rules and employee outcomes",
    description: "Go deeper on recurring Philippine payroll topics that affect employee pay and final payroll results.",
    slugs: [
      "13th-month-pay-philippines",
      "overtime-pay-philippines",
      "night-differential-philippines",
      "holiday-pay-philippines",
      "final-pay-philippines",
      "separation-pay-philippines",
    ],
  },
  {
    title: "Evaluate payroll outsourcing",
    description: "Compare managed payroll with an in-house operating model, understand service scope and identify the cost drivers behind outsourcing.",
    slugs: [
      "payroll-software-vs-outsourcing",
      "payroll-outsourcing-guide",
      "payroll-outsourcing-cost",
    ],
  },
] as const;

export const metadata: Metadata = {
  title: "Philippine Payroll Guides & Buyer Resources | Linaw",
  description: "Philippine payroll guides for software buying, migration, compliance, operations, security, outsourcing decisions and payroll teams.",
  alternates: { canonical: "/resources" },
};

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Resources", path: "/resources" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Payroll resources</p>
            <h1 className="font-display mt-4 max-w-[900px] text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              Practical guidance for buying, migrating and operating Philippine payroll.
            </h1>
            <p className="mt-5 max-w-[780px] text-[16px] leading-relaxed text-[#5B6080]">
              Start with the decision you are making. Compare software, plan implementation, understand pay rules, or evaluate whether payroll outsourcing fits your operating model.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/resources/updates" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Regulatory updates</Link>
              <Link href="/glossary" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Payroll glossary</Link>
              <Link href="/calculators" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Calculators</Link>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-[1180px] px-5 py-14 sm:px-8 sm:py-18">
          <nav aria-label="Resource topics" className="flex flex-wrap gap-2 border-b border-[#EDEFF7] pb-8">
            {resourceGroups.map((group, index) => (
              <a key={group.title} href={`#resource-group-${index + 1}`} className="rounded-full bg-[#F4F5FA] px-4 py-2 text-[12px] font-semibold text-[#4F556D] hover:bg-[#ECECFF] hover:text-[#4A4AE0]">
                {group.title}
              </a>
            ))}
          </nav>

          <div className="divide-y divide-[#EDEFF7]">
            {resourceGroups.map((group, index) => {
              const pages = group.slugs.map((slug) => bySlug.get(slug)).filter(Boolean);
              return (
                <section key={group.title} id={`resource-group-${index + 1}`} className="scroll-mt-24 py-12 sm:py-14">
                  <div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr] lg:gap-10">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Topic {index + 1}</p>
                      <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">{group.title}</h2>
                      <p className="mt-3 max-w-[430px] text-[14px] leading-relaxed text-[#5B6080]">{group.description}</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {pages.map((page) => page ? (
                        <Link key={page.slug} href={`/resources/${page.slug}`} className="group rounded-[20px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:-translate-y-0.5 hover:border-[#CFCFFF] hover:bg-white">
                          <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">{page.eyebrow}</p>
                          <h3 className="font-display mt-2 text-[19px] font-semibold leading-snug tracking-[-0.02em]">{page.title}</h3>
                          <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-[#6B718C]">{page.description}</p>
                          <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#4A4AE0]">Read guide <ArrowRight size={13} /></span>
                        </Link>
                      ) : null)}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
