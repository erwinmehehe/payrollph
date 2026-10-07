import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyRound } from "lucide-react";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password | Linaw",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main className="relative overflow-hidden py-14 sm:py-18">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-48 h-[580px] w-[640px] rounded-full bg-gradient-to-br from-[#e5f8f2] via-[#EAF4FF] to-[#e5f0ff] opacity-75 blur-3xl" />
        </div>
        <div className="relative mx-auto grid max-w-[960px] gap-8 px-5 sm:px-8 lg:grid-cols-[.88fr_1.12fr] lg:items-center">
          <section>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#0868dc] shadow-sm">
              <KeyRound size={14} /> Password security
            </span>
            <h1 className="font-display mt-6 text-[40px] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[52px]">Set a new password.</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-[#5B6080]">
              Reset tokens are single-use, expire in 30 minutes, and are stored only as a hash.
            </p>
          </section>
          <Suspense fallback={<section className="auth-card"><p className="auth-copy">Loading…</p></section>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
