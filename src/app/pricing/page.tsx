import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Payroll Software Pricing Philippines | Linaw",
  description: "See Linaw payroll software pricing for Philippine businesses, loaded from the current product catalog, with controlled trial access and demo options.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const plans = await getPublicPricingPlans();
  return (
    <div className="marketing-page min-h-screen bg-white text-[#101323]">
      <SiteNav />
      <main>
        <section className="border-b border-[#EAECF0] bg-[#FCFCFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#444CE7]">Payroll software pricing Philippines</p>
            <h1 className="font-display mt-4 text-[42px] font-semibold tracking-[-0.05em] sm:text-[56px]">Published pricing from the live product catalog.</h1>
            <p className="mt-5 max-w-[720px] text-[16px] leading-relaxed text-[#5B6080]">Plan values below come directly from the persisted product catalog rather than duplicated marketing constants.</p>
          </div>
        </section>
        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1180px] gap-4 px-5 sm:px-8 lg:grid-cols-3">
            {plans.map((plan) => (
              <article key={plan.id} className="rounded-[16px] border border-[#EAECF0] bg-white p-6">
                <h2 className="font-display text-[25px] font-semibold">{plan.name}</h2>
                <p className="mt-3 text-[32px] font-semibold">₱{Number(plan.monthlyBase).toLocaleString("en-PH")}<span className="text-[13px] font-medium text-[#7C82A1]"> / month base</span></p>
                <p className="mt-2 text-[13.5px] text-[#5B6080]">₱{Number(plan.perEmployee).toLocaleString("en-PH")} per employee where applicable.</p>
              </article>
            ))}
          </div>
          <div className="mx-auto mt-8 flex max-w-[1180px] gap-3 px-5 sm:px-8">
            <Link href="/trial" className="rounded-[10px] bg-[#444CE7] px-6 py-3.5 text-[14px] font-semibold text-white">Request trial access</Link>
            <Link href="/book-demo" className="inline-flex items-center gap-2 rounded-[10px] border border-[#D0D5DD] px-6 py-3.5 text-[14px] font-semibold">Book a demo <ArrowRight size={14}/></Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
