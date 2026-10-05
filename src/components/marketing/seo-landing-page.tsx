import Link from "next/link";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
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
  faq?: Array<{ question: string; answer: string }>;
  related: SeoRelatedLink[];
  ctaTitle?: string;
  ctaBody?: string;
  lastReviewed?: string;
  sources?: Array<{ label: string; href: string }>;
};

export function SeoLandingPage({
  eyebrow,
  title,
  intro,
  proof,
  sections,
  faq = [],
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
    <div className="marketing-page min-h-screen bg-white text-[#101323]">
      {faqSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }}
        />
      ) : null}
      <SiteNav />
      <main>
        <section className="relative overflow-hidden border-b border-[#EAECF0] bg-[#FCFCFD] py-16 sm:py-20 lg:py-24">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-40 -top-56 h-[650px] w-[760px] rounded-full bg-gradient-to-br from-[#ECECFF] via-[#EAF4FF] to-[#E3FAF0] opacity-80 blur-3xl" />
          </div>
          <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#444CE7]">{eyebrow}</p>
            <h1 className="font-display mt-4 max-w-[900px] text-balance text-[40px] font-semibold leading-[1.05] tracking-[-0.05em] sm:text-[56px]">
              {title}
            </h1>
            <p className="mt-6 max-w-[780px] text-[17px] leading-relaxed text-[#5B6080]">{intro}</p>
            {lastReviewed ? <p className="mt-3 text-[11.5px] font-medium text-[#8B90AA]">Last reviewed: {lastReviewed}</p> : null}
            <div className="mt-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {proof.map((item) => (
                <div key={item} className="flex gap-2.5 rounded-[12px] border border-[#EAECF0] bg-white p-4 text-[13px] font-medium leading-relaxed text-[#344054]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E3FAF0] text-[#0A8A53]">
                    <Check size={12} strokeWidth={2.8} />
                  </span>
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="inline-flex items-center gap-2 rounded-[10px] bg-[#444CE7] px-6 py-3.5 text-[14px] font-semibold text-white">
                Try live demo <ArrowRight size={14} />
              </Link>
              <Link href="/book-demo" className="rounded-[10px] border border-[#D0D5DD] bg-white px-6 py-3.5 text-[14px] font-semibold text-[#2B2F45]">
                Book a walkthrough
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1180px] gap-5 px-5 sm:px-8 lg:grid-cols-2">
            {sections.map((section) => (
              <article key={section.title} className="rounded-[16px] border border-[#EAECF0] bg-white p-6 sm:p-7">
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

        {faq.length ? (
          <section className="border-t border-[#EAECF0] py-16 sm:py-20">
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
          <section className="border-y border-[#EAECF0] bg-white py-12">
            <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Official references</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-[#DFE2EC] bg-[#FCFCFD] px-4 py-2.5 text-[12px] font-semibold text-[#34394F]"
                  >
                    {source.label} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="border-y border-[#EAECF0] bg-[#FCFCFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Explore related workflows</p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <Link key={item.href} href={item.href} className="group rounded-[14px] border border-[#EAECF0] bg-white p-5 transition hover:border-[#C7D0FF] hover:bg-[#FCFCFF]">
                  <strong className="font-display text-[18px] font-semibold">{item.label}</strong>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{item.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#444CE7]">
                    Learn more <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="flex flex-col gap-5 rounded-[18px] bg-[#101323] p-7 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div>
                <h2 className="font-display text-[28px] font-semibold tracking-[-0.035em]">{ctaTitle}</h2>
                <p className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-white/60">{ctaBody}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <Link href="/demo" className="rounded-[10px] bg-white px-5 py-3 text-[13.5px] font-semibold text-[#11141F]">Open live demo</Link>
                <Link href="/book-demo" className="rounded-[10px] border border-white/20 bg-white/10 px-5 py-3 text-[13.5px] font-semibold text-white">Book walkthrough</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
