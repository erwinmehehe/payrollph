import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import VerifyEmailClient from "./verify-email-client";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Verify email | Linaw",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? "";

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main className="relative overflow-hidden py-16 sm:py-20">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -right-40 -top-48 h-[560px] w-[620px] rounded-full bg-gradient-to-br from-[#e5f0ff] via-[#EAF4FF] to-[#e5f8f2] opacity-75 blur-3xl" />
        </div>
        <section className="relative mx-auto max-w-[620px] px-5 sm:px-8">
          <div className="rounded-[28px] border border-[#E2E4F0] bg-white p-6 shadow-[0_26px_70px_-38px_rgba(30,34,70,.4)] sm:p-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e5f8f2] text-[#00886e]">
              <MailCheck size={19} />
            </span>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Account security</p>
            <h1 className="font-display mt-2 text-[31px] font-semibold tracking-[-0.035em]">Verify your new email.</h1>
            <div className="mt-5">
              <VerifyEmailClient token={token} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
