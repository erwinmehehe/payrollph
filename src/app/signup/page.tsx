import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { AccessRequestForm } from "@/components/marketing/access-request-form";
import { SelfServeSignupForm } from "@/components/marketing/self-serve-signup-form";
import { publicSelfServeReady } from "@/lib/saas-launch-config";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request Linaw Trial Access | Philippine Payroll Software",
  description:
    "Request access to a Linaw trial workspace for Philippine payroll. Explore the live role-based demo immediately or send your company and headcount for controlled workspace access.",
  alternates: { canonical: "/signup" },
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  if (publicSelfServeReady()) {
    const params = await searchParams;
    const plans = await getPublicPricingPlans();
    return (
      <div className="min-h-screen bg-white text-[#0B0D1A]">
        <SiteNav />
        <main className="mx-auto grid max-w-[1120px] gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:py-20">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <span className="text-[11px] font-bold uppercase tracking-[.15em] text-[#0877ff]">Linaw payroll subscriptions</span>
            <h1 className="font-display mt-5 text-[42px] font-semibold leading-[1.05] tracking-tight sm:text-[53px]">Start payroll in your own workspace.</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-[#5B6080]">Create an empty, private company workspace. Verify your email, authorize monthly billing, then invite your payroll team and add employees.</p>
            <div className="mt-6 grid gap-3 text-[14px] text-[#2B2F45]">
              {["Separate company and employee records","Secure recurring payments and billing history","Government ID numbers protected and access-controlled","Cancel automatic renewal from your account"].map((line) => (
                <p key={line} className="flex gap-2"><Check size={17} className="mt-0.5 shrink-0 text-[#13805c]" />{line}</p>
              ))}
            </div>
            <Link href="/demo" className="mt-7 inline-flex items-center gap-2 text-[13px] font-semibold text-[#0868dc]">Try the sample-data demo first <ArrowRight size={16} /></Link>
          </div>
          <SelfServeSignupForm
            plans={plans.map((plan) => ({ name: plan.name, monthlyBase: String(plan.monthlyBase), perEmployee: String(plan.perEmployee), active: plan.active }))}
            initialPlan={params?.plan}
          />
        </main>
        <SiteFooter />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="relative overflow-hidden py-16 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-36 -top-48 h-[560px] w-[620px] rounded-full bg-gradient-to-br from-[#e5f0ff] via-[#EAF4FF] to-[#e5f8f2] opacity-80 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-[1120px] gap-9 px-5 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#0868dc] shadow-sm">
                <ShieldCheck size={14} />
                Controlled trial access
              </span>
              <h1 className="font-display mt-6 text-balance text-[43px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[58px]">
                Request access to a Linaw trial workspace.
              </h1>
              <p className="mt-5 max-w-[680px] text-[16px] leading-relaxed text-[#5B6080]">
                The live demo is available immediately. Trial workspaces are invitation-based while rollout stays controlled,
                so we can provision the right company structure and roles without opening a second owner on an existing tenant.
              </p>

              <div className="mt-7 grid gap-3">
                {[
                  "Explore Owner, HR, Payroll, Checker, Bookkeeper and Employee before requesting access",
                  "Start with sample data instead of uploading a real payroll file",
                  "Invite your team only after the workspace and roles are ready",
                ].map((line) => (
                  <span key={line} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#3E435B]">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
                      <Check size={12} strokeWidth={2.8} />
                    </span>
                    {line}
                  </span>
                ))}
              </div>

              <Link href="/demo" className="mt-7 inline-flex items-center gap-2 text-[13.5px] font-semibold text-[#0868dc]">
                Prefer to look around first? Try the live demo <ArrowRight size={14} />
              </Link>
            </div>

            <AccessRequestForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
