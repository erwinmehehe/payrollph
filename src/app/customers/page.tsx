import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { PUBLISHABLE_CUSTOMER_STORIES } from "@/lib/customer-stories";

const approvedStories = PUBLISHABLE_CUSTOMER_STORIES;

export const metadata: Metadata = {
  title: "Payroll Customer Stories Philippines | Linaw",
  description: "Approved Linaw customer stories with documented implementation context, evidence-backed outcomes and customer-approved quotes.",
  alternates: { canonical: "/customers" },
  robots: approvedStories.length > 0
    ? { index: true, follow: true }
    : { index: false, follow: true },
};

export default function CustomersPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Customer evidence</p>
            <h1 className="font-display mt-4 max-w-[820px] text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              Customer stories are published only after approval and evidence review.
            </h1>
            <p className="mt-5 max-w-[760px] text-[15px] leading-relaxed text-[#5B6080]">
              Linaw does not publish placeholder logos, invented percentages or unapproved testimonials. Every public story must have customer approval and documented support for any quantified outcome.
            </p>
          </div>
        </section>

        <section className="py-14 sm:py-18">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            {approvedStories.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {approvedStories.map((story) => (
                  <Link
                    key={story.slug}
                    href={`/customers/${story.slug}`}
                    className="rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6 transition hover:-translate-y-0.5 hover:border-[#b7d6ff]"
                  >
                    <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#7C82A1]">{story.industry}</p>
                    <h2 className="font-display mt-3 text-[26px] font-semibold tracking-[-0.03em]">{story.customerName}</h2>
                    <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{story.challenge}</p>
                    <span className="mt-5 inline-block text-[13px] font-semibold text-[#0868dc]">Read approved story</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-[28px] border border-[#E4E6F0] bg-[#FAFBFD] p-7 sm:p-9">
                <h2 className="font-display text-[28px] font-semibold tracking-[-0.03em]">No public customer stories yet.</h2>
                <p className="mt-4 max-w-[760px] text-[14px] leading-relaxed text-[#5B6080]">
                  The public collection stays empty until a customer approves publication and any metrics have evidence notes. This page remains out of the search index until at least one approved story is available.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/methodology" className="rounded-full border border-[#D9DCEF] px-4 py-2 text-[13px] font-semibold text-[#3F4563]">
                    Evidence methodology
                  </Link>
                  <Link href="/trust" className="rounded-full border border-[#D9DCEF] px-4 py-2 text-[13px] font-semibold text-[#3F4563]">
                    Trust center
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
