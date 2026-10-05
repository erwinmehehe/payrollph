import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { InviteAcceptForm } from "@/components/invite-accept-form";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept invitation | Linaw",
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return (
    <div className="marketing-page min-h-screen bg-white text-[#101323]">
      <SiteNav />
      <main className="relative overflow-hidden bg-[#FCFCFD] py-14 sm:py-18">
        <div className="relative mx-auto grid max-w-[960px] gap-8 px-5 sm:px-8 lg:grid-cols-[.88fr_1.12fr] lg:items-center">
          <section>
            <span className="inline-flex items-center gap-2 border-l-2 border-[#444CE7] pl-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#444CE7]">
              <ShieldCheck size={14} /> Secure invitation
            </span>
            <h1 className="font-display mt-6 text-[40px] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[52px]">Join your team on Linaw.</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-[#5B6080]">
              Invitations are single-use, expire in seven days, and carry the role your administrator assigned.
            </p>
          </section>
          <Suspense fallback={<section className="auth-card"><p className="auth-copy">Loading…</p></section>}>
            <InviteAcceptForm />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
