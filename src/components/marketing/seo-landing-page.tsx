import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export type SeoSection = {
  title: string;
  body: string;
  bullets?: string[];
};

export type SeoRelatedLink = {
  label: string;
  href: string;
  description: string;
};

type Props = {
  eyebrow: string;
  title: string;
  intro: string;
  proof: string[];
  sections: SeoSection[];
  related: SeoRelatedLink[];
  ctaTitle?: string;
  ctaBody?: string;
};

export function SeoLandingPage({
  eyebrow,
  title,
  intro,
  proof,
  sections,
  related,
  ctaTitle = "See the workflow before you commit.",
  ctaBody = "Open the role-based product demo or book a walkthrough with your own payroll questions.",
}: Props) {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="relative overflow-hidden border-b border-[#EDEFF7] py-16 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-40 -top-56 h-[650px] w-[760px] rounded-full bg-gradient-to-br from-[#ECECFF] via-[#EAF4FF] to-[#E3FAF0] opacity-80 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">{eyebrow}</p>
            <h1 className="font-display mt-4 max-w-[900px] text-balance text-[42px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              {title}
            </h1>
            <p className="mt-6 max-w-[780px] text-[17px] leading-relaxed text-[#5B6080]">{intro}</p>
            <div className="mt-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {proof.map((item) => (
                <div key={item} className="flex gap-2.5 rounded-2xl border border-[#E6E8F2] bg-white/90 p-4 text-[13px] font-medium leading-relaxed text-[#34394F] shadow-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3FAF0] text-[#0A8A53]">
                    <Check size={12} strokeWidth={2.8} />
                  </span>
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="inline-flex items-center gap-2 rounded-full bg-[#6161FF] px-6 py-3.5 text-[14px] font-semibold text-white">
                Try live demo <ArrowRight size={14} />
              </Link>
              <Link href="/book-demo" className="rounded-full border border-[#D9DCEC] bg-white px-6 py-3.5 text-[14px] font-semibold text-[#2B2F45]">
                Book a walkthrough
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1180px] gap-5 px-5 sm:px-8 lg:grid-cols-2">
            {sections.map((section) => (
              <article key={section.title} className="rounded-[24px] border border-[#E5E7F0] bg-[#FAFBFD] p-6 sm:p-7">
                <h2 className="font-display text-[25px] font-semibold tracking-[-0.03em]">{section.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">{section.body}</p>
                {section.bullets ? (
                  <ul className="mt-5 grid gap-2.5">
                    {section.bullets.map((item) => (
                      <li key={item} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#34394F]">
                        <Check size={14} className="mt-1 shrink-0 text-[#0A8A53]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Explore related workflows</p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <Link key={item.href} href={item.href} className="group rounded-[22px] border border-[#E2E4F0] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#CFCFFF] hover:shadow-sm">
                  <strong className="font-display text-[18px] font-semibold">{item.label}</strong>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{item.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#4A4AE0]">
                    Learn more <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="flex flex-col gap-5 rounded-[28px] bg-[#11141F] p-7 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div>
                <h2 className="font-display text-[28px] font-semibold tracking-[-0.035em]">{ctaTitle}</h2>
                <p className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-white/60">{ctaBody}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <Link href="/demo" className="rounded-full bg-white px-5 py-3 text-[13.5px] font-semibold text-[#11141F]">Open live demo</Link>
                <Link href="/book-demo" className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-[13.5px] font-semibold text-white">Book walkthrough</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
