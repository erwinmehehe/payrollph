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
    <div className="marketing-page min-h-screen bg-white text-[#101323]">
      <SiteNav />
      <main className="relative overflow-hidden bg-[#FCFCFD] py-16 sm:py-20">
        <section className="relative mx-auto max-w-[620px] px-5 sm:px-8">
          <div className="rounded-[16px] border border-[#EAECF0] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04)] sm:p-8">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E3FAF0] text-[#0A8A53]">
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
