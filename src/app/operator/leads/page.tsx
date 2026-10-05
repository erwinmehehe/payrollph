import type { Metadata } from "next";
import Link from "next/link";
import { Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { activeMailProvider, deliveryCapable, recentPublicLeadOutbox } from "@/lib/mailer";
import { isPlatformOperator, platformOperatorConfigured } from "@/lib/platform-operator";
import { SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public lead queue | Linaw",
  robots: { index: false, follow: false },
};

function leadMetadata(row: Awaited<ReturnType<typeof recentPublicLeadOutbox>>[number]) {
  return row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {};
}

function value(meta: Record<string, unknown>, key: string) {
  const result = meta[key];
  return typeof result === "string" && result.trim() ? result.trim() : null;
}

function leadLabel(purpose: string) {
  if (purpose === "trial-access-request") return "Trial access";
  if (purpose === "payroll-outsourcing-enquiry") return "Payroll outsourcing";
  return "Demo";
}

function statusClasses(status: string) {
  if (status === "sent") return "bg-[#E3FAF0] text-[#0A8A53]";
  if (status === "failed") return "bg-[#FFE8EC] text-[#C83250]";
  return "bg-[#FFF4D6] text-[#8A6300]";
}

export default async function PlatformLeadQueuePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (!platformOperatorConfigured() || !isPlatformOperator(user.email)) {
    notFound();
  }

  const leads = await recentPublicLeadOutbox(100);
  const provider = activeMailProvider();
  const canDeliver = deliveryCapable();

  return (
    <div className="min-h-screen bg-[#F7F8FC] text-[#0B0D1A]">
      <SiteNav />
      <main className="mx-auto max-w-[1180px] px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <div className="flex flex-col gap-5 border-b border-[#E2E4F0] pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#4A4AE0]">
              <ShieldCheck size={13} aria-hidden />
              Platform operator only
            </span>
            <h1 className="font-display mt-4 text-[38px] font-semibold tracking-[-0.04em] sm:text-[48px]">Public lead queue</h1>
            <p className="mt-3 max-w-[720px] text-[14px] leading-relaxed text-[#5B6080]">
              Demo, trial-access and payroll-outsourcing enquiries are stored here even when transactional email is unavailable.
              Tenant owners cannot access this queue.
            </p>
          </div>

          <div className="rounded-[18px] border border-[#E2E4F0] bg-white px-4 py-3 text-[12px]">
            <span className="font-semibold text-[#2B2F45]">Mail provider:</span>{" "}
            <span className={canDeliver ? "font-semibold text-[#0A8A53]" : "font-semibold text-[#9A6B00]"}>
              {canDeliver ? provider : "not configured"}
            </span>
          </div>
        </div>

        {!canDeliver && (
          <div className="mt-6 flex gap-3 rounded-[20px] border border-[#F0D89D] bg-[#FFF9EA] p-4 text-[13px] leading-relaxed text-[#72520A]">
            <TriangleAlert size={17} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Email delivery is not configured. New enquiries remain durable in this queue, but operators must review them here
              until a Linaw sending domain and transactional provider are connected.
            </span>
          </div>
        )}

        <div className="mt-7 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">Newest first</p>
            <p className="mt-1 text-[13px] text-[#5B6080]">{leads.length} lead{leads.length === 1 ? "" : "s"} shown</p>
          </div>
          <Link href="/app" className="rounded-full border border-[#D9DCEC] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#2B2F45]">
            Back to workspace
          </Link>
        </div>

        {leads.length === 0 ? (
          <div className="mt-5 rounded-[24px] border border-dashed border-[#D9DCEC] bg-white p-10 text-center">
            <Mail className="mx-auto h-8 w-8 text-[#A0A5B8]" aria-hidden />
            <h2 className="font-display mt-4 text-[22px] font-semibold">No public enquiries yet.</h2>
            <p className="mt-2 text-[13px] text-[#7C82A1]">New demo, trial and outsourcing requests will appear here.</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {leads.map((row) => {
              const meta = leadMetadata(row);
              const email = value(meta, "email");
              const company = value(meta, "company");
              const name = value(meta, "name");
              const headcount = value(meta, "headcount");
              const frequency = value(meta, "frequency");
              const entities = value(meta, "entities");
              const notes = value(meta, "notes");

              return (
                <article key={row.id} className="rounded-[24px] border border-[#E2E4F0] bg-white p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#ECECFF] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#4A4AE0]">
                          {leadLabel(row.purpose)}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClasses(row.status)}`}>
                          {row.status}
                        </span>
                      </div>
                      <h2 className="font-display mt-3 text-[22px] font-semibold">{company ?? row.subject}</h2>
                      <p className="mt-1 text-[13px] text-[#5B6080]">
                        {[name, email].filter(Boolean).join(" · ") || "Legacy lead record"}
                      </p>
                    </div>
                    <time className="shrink-0 text-[11px] text-[#8B90AA]" dateTime={row.createdAt.toISOString()}>
                      {row.createdAt.toLocaleString("en-PH")}
                    </time>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                      ["People", headcount],
                      ["Frequency", frequency],
                      ["Entities", entities],
                    ].map(([label, data]) => (
                      <div key={label} className="rounded-2xl bg-[#F7F8FC] p-3.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">{label}</p>
                        <p className="mt-1 text-[13px] font-semibold text-[#2B2F45]">{data ?? "Not stated"}</p>
                      </div>
                    ))}
                  </div>

                  {notes && <p className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-[#5B6080]">{notes}</p>}

                  <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-[#EDEFF7] pt-4">
                    {email && (
                      <a href={`mailto:${email}`} className="rounded-full bg-[#11141F] px-4 py-2.5 text-[12.5px] font-semibold text-white">
                        Reply by email
                      </a>
                    )}
                    <span className="text-[11px] text-[#8B90AA]">
                      Outbox #{row.id} · {row.deliveryStatus ?? row.status}
                    </span>
                  </div>

                  {!value(meta, "leadType") && (
                    <details className="mt-4 rounded-2xl border border-[#EDEFF7] bg-[#FAFBFD] p-4">
                      <summary className="cursor-pointer text-[12px] font-semibold text-[#4A4AE0]">Show legacy submission</summary>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#5B6080]">{row.body}</pre>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
