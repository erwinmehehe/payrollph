import Link from "next/link";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

import { ProductSimulation, type ProductSimulationArea } from "./product-simulation";

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

export type SeoDirectoryGroup = {
  title: string;
  description: string;
  links: SeoRelatedLink[];
};

type Props = {
  workflow?: { title: string; steps: Array<{ title: string; owner: string; detail: string }> };
  directoryTitle?: string;
  simulationArea?: ProductSimulationArea;
  eyebrow: string;
  title: string;
  intro: string;
  proof: string[];
  sections: SeoSection[];
  faq?: Array<{ question: string; answer: string }>;
  directoryGroups?: SeoDirectoryGroup[];
  related: SeoRelatedLink[];
  ctaTitle?: string;
  ctaBody?: string;
  lastReviewed?: string;
  sources?: Array<{ label: string; href: string }>;
};

export function SeoLandingPage({
  workflow,
  directoryTitle = "Find the compliance workflow you actually need.",
  simulationArea,
  eyebrow,
  title,
  intro,
  proof,
  sections,
  faq = [],
  directoryGroups = [],
  related,
  ctaTitle = "See the workflow before you commit.",
  ctaBody = "Open the role-based product demo or book a walkthrough with your own payroll questions.",
  lastReviewed,
  sources,
}: Props) {
  const faqSchema = faq.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : null;

  return (
    <div className="linaw-editorial min-h-screen bg-white text-[#0B0D1A]">
      {faqSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }}
        />
      ) : null}
      <SiteNav />
      <main>
        <section className="le-hero">
          <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">{eyebrow}</p>
            <h1 className="font-display mt-4 max-w-[900px] text-balance text-[42px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              {title}
            </h1>
            <p className="mt-6 max-w-[780px] text-[17px] leading-relaxed text-[#5B6080]">{intro}</p>
            {lastReviewed ? <p className="mt-3 text-[11.5px] font-medium text-[#8B90AA]">Last reviewed: {lastReviewed}</p> : null}
            <div className="le-proof">
              {proof.map((item) => (
                <div key={item} className="le-proof-item">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
                    <Check size={12} strokeWidth={2.8} />
                  </span>
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="inline-flex items-center gap-2 rounded-full bg-[#0877ff] px-6 py-3.5 text-[14px] font-semibold text-white">
                Try live demo <ArrowRight size={14} />
              </Link>
              <Link href="/book-demo" className="rounded-full border border-[#D9DCEC] bg-white px-6 py-3.5 text-[14px] font-semibold text-[#2B2F45]">
                Book a walkthrough
              </Link>
            </div>
          </div>
        </section>

        {workflow ? <section className="le-workflow" aria-label={workflow.title}><p className="le-workflow-eyebrow">A workflow to try</p><h2>{workflow.title}</h2><ol>{workflow.steps.map((step, index) => <li key={step.title}><span className="le-workflow-step">{String(index + 1).padStart(2, "0")}</span><p className="le-workflow-owner">{step.owner}</p><h3>{step.title}</h3><p>{step.detail}</p></li>)}</ol></section> : null}
        {simulationArea ? <ProductSimulation area={simulationArea} /> : null}

        <section className="le-capabilities">
          {sections.map((section,index)=><article className="le-capability" key={section.title}><span className="le-number">{String(index+1).padStart(2,"0")}</span><h2>{section.title}</h2><div><p>{section.body}</p>{section.bullets?<ul>{section.bullets.map(item=><li className="flex gap-2" key={item}><Check size={14} className="mt-1 shrink-0 text-[#00886e]"/>{item}</li>)}</ul>:null}</div></article>)}
        </section>

        {directoryGroups.length ? (
          <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
            <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Browse this topic</p>
              <h2 className="font-display mt-2 max-w-[760px] text-[32px] font-semibold tracking-[-0.035em] sm:text-[40px]">
                {directoryTitle}
              </h2>
              <div className="mt-8 divide-y divide-[#E3E5EE] border-y border-[#E3E5EE]">
                {directoryGroups.map((group) => (
                  <div key={group.title} className="grid gap-5 py-7 lg:grid-cols-[.72fr_1.28fr] lg:gap-10">
                    <div>
                      <h3 className="font-display text-[22px] font-semibold tracking-[-0.025em]">{group.title}</h3>
                      <p className="mt-2 max-w-[430px] text-[13.5px] leading-relaxed text-[#5B6080]">{group.description}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.links.map((item) => (
                        <Link key={item.href} href={item.href} className="group rounded-[18px] border border-[#E2E4F0] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#b7d6ff]">
                          <strong className="font-display text-[16px] font-semibold">{item.label}</strong>
                          <p className="mt-1.5 text-[12px] leading-relaxed text-[#6B718C]">{item.description}</p>
                          <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0868dc]">
                            Open guide <ArrowRight size={12} />
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {faq.length ? (
          <section className="border-t border-[#EDEFF7] py-16 sm:py-20">
            <div className="mx-auto max-w-[920px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Common questions</p>
              <h2 className="font-display mt-2 text-[32px] font-semibold tracking-[-0.035em] sm:text-[40px]">
                Questions buyers usually ask before the next step.
              </h2>
              <div className="mt-8 divide-y divide-[#E6E8F0] border-y border-[#E6E8F0]">
                {faq.map((item) => (
                  <article key={item.question} className="py-6">
                    <h3 className="font-display text-[19px] font-semibold tracking-[-0.02em]">{item.question}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-[#5B6080]">{item.answer}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {sources?.length ? (
          <section className="border-y border-[#EDEFF7] bg-white py-12">
            <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Official references</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-[#DFE2EC] bg-[#FAFBFD] px-4 py-2.5 text-[12px] font-semibold text-[#34394F]"
                  >
                    {source.label} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Explore related workflows</p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <Link key={item.href} href={item.href} className="group rounded-[22px] border border-[#E2E4F0] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#b7d6ff] hover:shadow-sm">
                  <strong className="font-display text-[18px] font-semibold">{item.label}</strong>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{item.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0868dc]">
                    Learn more <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="linaw-dark-callout flex flex-col gap-5 rounded-[28px] bg-[#11141F] p-7 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div>
                <h2 className="font-display text-[28px] font-semibold tracking-[-0.035em]">{ctaTitle}</h2>
                <p className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-white/60">{ctaBody}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <Link href="/demo" className="linaw-light-button rounded-full bg-white px-5 py-3 text-[13.5px] font-semibold text-[#11141F]">Open live demo</Link>
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
