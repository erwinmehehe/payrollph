import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { SelfServeSignupForm } from "@/components/marketing/self-serve-signup-form";
import { signupMode } from "@/lib/saas-launch-config";
import { deliveryCapable } from "@/lib/mail-provider";
import { privatePilotInviteReady } from "@/lib/private-pilot-invite";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a company account | Linaw Payroll",
  description: "Create one Linaw company owner account, verify your email, and start onboarding your workspace.",
  alternates: { canonical: "/signup" },
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const mode = signupMode();
  const params = await searchParams;
  // The pilot needs no paid plan catalog or subscription checkout.
  const plans = mode === "paid" ? await getPublicPricingPlans() : [];
  const isPilot = mode === "pilot";
  const emailDeliveryAvailable = deliveryCapable();
  const privateInviteEnabled = isPilot && privatePilotInviteReady();

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main className="mx-auto grid max-w-[1120px] gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:py-20">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#DEEAF8] bg-[#F5F9FF] px-3 py-2 text-[12px] font-bold text-[#0868dc]">
            <ShieldCheck size={15} />
            One secure company registration
          </span>
          <h1 className="font-display mt-5 text-[42px] font-semibold leading-[1.05] tracking-tight sm:text-[53px]">Create your Linaw company account.</h1>
          <p className="mt-5 text-[15px] leading-relaxed text-[#5B6080]">
            {isPilot
              ? privateInviteEnabled && !emailDeliveryAvailable
                ? "Create a separate, empty company workspace with your private invitation code. No email confirmation or payment is needed for this test-only 14-day pilot."
                : "Create an owner login and a separate, empty company workspace for a 14-day development pilot. Verify your email to start, or use an authorized private invitation. No card is required."
              : mode === "paid"
                ? "Create your company owner account, verify your email, and authorize billing through secure hosted checkout."
                : "Company registration is temporarily unavailable while email verification and workspace setup are being configured."}
          </p>
          <div className="mt-6 grid gap-3 text-[14px] text-[#2B2F45]">
            {(isPilot
              ? ["One signup form for every new company", "Email verification before owner access", "10 Core employee seats during the pilot", "Use fictional/test data only; no real payroll or bank records"]
              : ["Separate company and employee records", "Verified owner email", "Role-based company permissions", "No card details on this form"]
            ).map((line) => (
              <p key={line} className="flex gap-2"><Check size={17} className="mt-0.5 shrink-0 text-[#13805c]" />{line}</p>
            ))}
          </div>
          <div className="mt-7 rounded-2xl border border-[#DEEAF8] bg-[#F5F9FF] p-4 text-[13px] leading-relaxed text-[#4A5972]">
            <strong className="block text-[#203652]">How it works</strong>
            <p className="mt-1">{isPilot
              ? privateInviteEnabled && !emailDeliveryAvailable
                ? "1. Enter your invitation code and create a company account. 2. Sign in with your new password. 3. Explore with fictional/test data. The pilot expires after 14 days."
                : "1. Create your owner account. 2. Verify your email or use a private invitation. 3. Open your pilot workspace and explore with test data."
              : mode === "paid"
                ? "1. Create your owner account. 2. Verify your email. 3. Authorize your selected plan through hosted checkout."
                : "Registration will reopen when the required services are ready."}</p>
          </div>
          <p className="mt-5 text-[13px] text-[#5B6080]">Already registered? <Link href="/login" className="font-semibold text-[#0868dc]">Sign in</Link></p>
          <Link href="/demo" className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-[#0868dc]">Explore the sample-data demo <ArrowRight size={16} /></Link>
        </div>
        {mode === "disabled" ? (
          <div className="h-fit rounded-[24px] border border-[#D9DCEC] bg-white p-7" role="status">
            <h2 className="font-display text-[26px] font-semibold">Registration is temporarily unavailable</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">Account creation is not accepting submissions right now. Please use the sample-data demo or return after registration services are enabled.</p>
            <Link href="/demo" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#0868dc]">Try the demo <ArrowRight size={16} /></Link>
          </div>
        ) : (
          <SelfServeSignupForm
            mode={mode}
            plans={plans.map((plan) => ({ name: plan.name, monthlyBase: String(plan.monthlyBase), perEmployee: String(plan.perEmployee), active: plan.active }))}
            initialPlan={params?.plan}
            privateInviteEnabled={privateInviteEnabled}
            emailDeliveryAvailable={emailDeliveryAvailable}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
