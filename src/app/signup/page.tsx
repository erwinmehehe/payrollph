import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { needsSetup } from "@/app/api/setup/route";
import { SetupWizard } from "@/components/setup-wizard";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create your Linaw workspace",
  description: "First-run setup creates your organization and its owner account with a policy-checked password.",
  alternates: { canonical: "/signup" },
};

export default async function SignupPage() {
  const empty = await needsSetup();

  if (empty) {
    return (
      <div className="min-h-screen bg-white text-[#0B0D1A]">
        <SiteNav />
        <SetupWizard needsSetup />
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
            <div className="absolute -right-36 -top-48 h-[560px] w-[620px] rounded-full bg-gradient-to-br from-[#ECECFF] via-[#EAF4FF] to-[#E3FAF0] opacity-80 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-[1080px] gap-8 px-5 sm:px-8 lg:grid-cols-[1fr_.92fr] lg:items-start">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#4A4AE0] shadow-sm">
                <ShieldCheck size={14} />
                Secure account provisioning
              </span>
              <h1 className="font-display mt-6 text-balance text-[42px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[56px]">
                This workspace already has an owner.
              </h1>
              <p className="mt-5 max-w-[680px] text-[15px] leading-relaxed text-[#5B6080]">
                Linaw creates one owner through first-run setup. After that, new users are invited from inside the workspace
                with a single-use, time-limited token. A public sign-up form cannot create another owner on an existing payroll instance.
              </p>

              <div className="mt-7 flex gap-3 rounded-2xl border border-[#C8DBF8] bg-[#F3F7FF] p-4 text-[13px] leading-relaxed text-[#315781]">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <span>
                  The API returns <span className="mono font-semibold">409</span> once a user already exists, so this is enforced server-side.
                </span>
              </div>

              <div className="mt-7 grid gap-3">
                {[
                  {
                    icon: Check,
                    title: "Try the role-based demo",
                    copy: "Open Owner, HR, Payroll, Checker or Employee against populated sample data.",
                    href: "/demo",
                    tone: "bg-[#E3FAF0] text-[#0A8A53]",
                  },
                  {
                    icon: Mail,
                    title: "Book a demo",
                    copy: "Tell us your headcount and entity structure and we will walk through your actual workflow.",
                    href: "/book-demo",
                    tone: "bg-[#ECECFF] text-[#4A4AE0]",
                  },
                  {
                    icon: LockKeyhole,
                    title: "Sign in",
                    copy: "Already have an account or received an invitation? Continue to the secure sign-in page.",
                    href: "/login",
                    tone: "bg-[#F1F2F8] text-[#5B6080]",
                  },
                ].map(({ icon: Icon, title, copy, href, tone }) => (
                  <Link key={href} href={href} className="group flex items-center gap-4 rounded-[20px] border border-[#E2E4F0] bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-24px_rgba(30,34,70,.42)]">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
                      <Icon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong className="block text-[14px] font-semibold">{title}</strong>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B718C]">{copy}</p>
                    </div>
                    <ArrowRight size={15} className="shrink-0 text-[#A0A5B8] transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </div>

            <article className="rounded-[26px] border border-[#E2E4F0] bg-[#FAFBFD] p-6 sm:p-7">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">How accounts get created</p>
              <h2 className="font-display mt-2 text-[28px] font-semibold tracking-[-0.035em]">Three steps, all server-enforced.</h2>

              <div className="mt-6 grid gap-4">
                {[
                  ["01", "First-run setup", "An empty instance creates the organization and its single owner. Password rules are checked on the server."],
                  ["02", "Invitation", "The owner invites colleagues with a role. The invitation token is hashed, expires and cannot be reused."],
                  ["03", "Employee linking", "Employee accounts are linked to one employee record and land in self-service rather than the admin workspace."],
                ].map(([n, title, copy]) => (
                  <div key={n} className="rounded-2xl border border-[#E5E7F0] bg-white p-4">
                    <span className="mono text-[10px] font-bold text-[#6161FF]">{n}</span>
                    <strong className="mt-2 block text-[14px] font-semibold">{title}</strong>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#6B718C]">{copy}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-[#F4D79C] bg-[#FFF9EA] p-4 text-[12.5px] leading-relaxed text-[#72520A]">
                Invitation and reset emails require an active mail provider. If delivery is unavailable, Linaw reports the queued state instead of claiming the message was sent.
              </div>
            </article>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
