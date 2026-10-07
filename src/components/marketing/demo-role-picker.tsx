"use client";

import { useMemo, useState, type ElementType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  LoaderCircle,
  Landmark,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { DEMO_ROLES, demoRolePath, type DemoRoleId } from "@/lib/demo-roles";

const ICONS: Record<DemoRoleId, ElementType> = {
  owner: BriefcaseBusiness,
  hr: UsersRound,
  payroll: CircleDollarSign,
  checker: ClipboardCheck,
  bookkeeper: Landmark,
  employee: UserRound,
};

const TONES: Record<DemoRoleId, { bg: string; fg: string }> = {
  owner: { bg: "#e5f0ff", fg: "#0868dc" },
  hr: { bg: "#e5f8f2", fg: "#00886e" },
  payroll: { bg: "#E0F7FA", fg: "#00838F" },
  checker: { bg: "#FFF4D6", fg: "#9A6B00" },
  bookkeeper: { bg: "#E8F2FF", fg: "#3263B8" },
  employee: { bg: "#F1EDFF", fg: "#6D4DE0" },
};

export function DemoRolePicker() {
  const [selectedRole, setSelectedRole] = useState<DemoRoleId>("owner");
  const [launching, setLaunching] = useState<DemoRoleId | null>(null);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => DEMO_ROLES.find((role) => role.id === selectedRole) ?? DEMO_ROLES[0],
    [selectedRole],
  );
  const SelectedIcon = ICONS[selected.id];
  const selectedTone = TONES[selected.id];

  async function openDemo(role: DemoRoleId) {
    setLaunching(role);
    setError("");

    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "This demo is not available on the current deployment.");
        return;
      }

      window.location.assign(demoRolePath(role));
    } catch {
      setError("Could not open the demo workspace. Please try again.");
    } finally {
      setLaunching(null);
    }
  }

  return (
    <main className="bg-white text-[#0B0D1A]">
      <section className="relative overflow-hidden border-b border-[#EDEFF7] pb-16 pt-16 sm:pb-20 sm:pt-20">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -right-32 -top-48 h-[560px] w-[620px] rounded-full bg-gradient-to-br from-[#e5f0ff] via-[#EAF4FF] to-[#e5f8f2] opacity-80 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-[1120px] px-5 text-center sm:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE0EF] bg-white px-3.5 py-2 text-[12px] font-bold text-[#0868dc] shadow-sm">
            <ShieldCheck size={14} aria-hidden />
            Real role boundaries · sample payroll · no setup
          </span>
          <h1 className="font-display mx-auto mt-6 max-w-[850px] text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[64px]">
            See Linaw from the seat you actually use.
          </h1>
          <p className="mx-auto mt-6 max-w-[710px] text-[17px] leading-relaxed text-[#5B6080]">
            Open the populated payroll workspace as Owner, HR Admin, Payroll Officer, Checker, Bookkeeper or Employee.
            Each role lands on the work it actually owns, with the same permission boundaries used by the application.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-[13px] font-semibold text-[#5B6080]">
            <span className="rounded-full bg-[#F4F5FA] px-3 py-2">6 role-specific views</span>
            <span className="rounded-full bg-[#F4F5FA] px-3 py-2">Populated Philippine payroll</span>
            <span className="rounded-full bg-[#F4F5FA] px-3 py-2">Switch roles inside the app</span>
          </div>
        </div>
      </section>

      <section className="py-14 sm:py-18">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
          <div className="mb-7 max-w-[700px]">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Role-based product demo</p>
            <h2 className="font-display mt-2 text-[32px] font-semibold tracking-[-0.035em] sm:text-[40px]">Choose a seat, then do the work.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#5B6080]">
              Pick the question you care about, launch that role, and work through it in the real product shell using sample data.
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-2xl border border-[#FFD5DC] bg-[#FFF6F7] px-4 py-3 text-[14px] font-medium text-[#9E2239]" role="alert">
              {error}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <div className="rounded-[24px] border border-[#E5E7F0] bg-[#FAFBFD] p-2" role="tablist" aria-label="Demo roles">
              {DEMO_ROLES.map((role) => {
                const Icon = ICONS[role.id];
                const tone = TONES[role.id];
                const active = role.id === selected.id;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    key={role.id}
                    onClick={() => setSelectedRole(role.id)}
                    className={`flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3.5 text-left transition-all ${
                      active ? "bg-white shadow-[0_10px_28px_-18px_rgba(30,34,70,.45)] ring-1 ring-[#E2E4F0]" : "hover:bg-white/70"
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: tone.bg, color: tone.fg }}>
                      <Icon size={17} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[14px] font-semibold text-[#11141F]">{role.label}</strong>
                      <small className="mt-0.5 block truncate text-[12px] text-[#7C82A1]">{role.person}</small>
                    </span>
                    {role.id === "owner" && !active && (
                      <span className="rounded-full bg-[#e5f0ff] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#0868dc]">Start</span>
                    )}
                    <ArrowRight size={14} className={active ? "text-[#0868dc]" : "text-[#A0A5B8]"} aria-hidden />
                  </button>
                );
              })}
            </div>

            <article className="overflow-hidden rounded-[28px] border border-[#E2E4F0] bg-white shadow-[0_22px_60px_-38px_rgba(30,34,70,.38)]" role="tabpanel">
              <div className="grid gap-8 p-6 sm:p-8 xl:grid-cols-[1.05fr_.95fr]">
                <div>
                  <div className="flex items-start gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: selectedTone.bg, color: selectedTone.fg }}>
                      <SelectedIcon size={21} aria-hidden />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: selectedTone.fg }}>{selected.label}</p>
                      <h3 className="font-display mt-1 text-[27px] font-semibold tracking-[-0.03em]">{selected.person}</h3>
                    </div>
                  </div>

                  <p className="mt-5 max-w-[600px] text-[15px] leading-[1.75] text-[#5B6080]">{selected.description}</p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-[#F7F8FC] p-4">
                      <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#9298AF]">Starts in</span>
                      <strong className="mt-1 block text-[14px] font-semibold">{selected.landingPage}</strong>
                    </div>
                    <div className="rounded-2xl bg-[#F7F8FC] p-4">
                      <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#9298AF]">Workspace</span>
                      <strong className="mt-1 block text-[14px] font-semibold">Loom &amp; Local demo tenant</strong>
                    </div>
                  </div>

                  <div className="mt-7">
                    <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#9298AF]">What this role can explore</span>
                    <div className="mt-3 grid gap-2">
                      {selected.access.map((item) => (
                        <span key={item} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-[#2B2F45]">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8f2] text-[#00886e]">
                            <Check size={12} strokeWidth={2.8} aria-hidden />
                          </span>
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-[22px] bg-[#11141F] p-5 text-white sm:p-6">
                  <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                    <Sparkles size={13} aria-hidden />
                    Sandbox task
                  </span>
                  <h4 className="font-display mt-3 text-[23px] font-semibold leading-tight">Do something the role actually owns.</h4>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-white/60">
                    Server permissions remain active in the demo. Payroll cannot self-approve. Checker cannot calculate or release.
                    Employee only reaches their own pay and attendance.
                  </p>

                  <div className="mt-5 space-y-2.5">
                    {selected.actions.map((item) => (
                      <div key={item} className="flex gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-[13px] text-white/85">
                        <Check size={14} className="mt-0.5 shrink-0 text-[#50D29D]" aria-hidden />
                        {item}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex items-center gap-2 text-[11px] font-semibold text-white/45">
                    <span>{selected.label}</span><ArrowRight size={12} /><span>{selected.landingPage}</span><ArrowRight size={12} /><span>Workspace</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void openDemo(selected.id)}
                    disabled={Boolean(launching)}
                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-[14px] font-semibold text-[#11141F] transition-transform hover:scale-[1.015] disabled:cursor-wait disabled:opacity-65"
                  >
                    {launching === selected.id ? (
                      <>
                        <LoaderCircle className="animate-spin" size={15} aria-hidden />
                        Opening…
                      </>
                    ) : (
                      <>
                        Open {selected.shortLabel} demo <ArrowRight size={15} aria-hidden />
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-center text-[11px] text-white/38">Sample data only. No real employee information.</p>
                </div>
              </div>
            </article>
          </div>

          <div className="mt-8 grid gap-4 rounded-[24px] border border-[#E5E7F0] bg-[#FAFBFD] p-5 lg:grid-cols-[1fr_auto] lg:items-center sm:p-6">
            <div>
              <strong className="font-display text-[18px] font-semibold">Ready to move beyond sample data?</strong>
              <p className="mt-1 text-[13.5px] text-[#5B6080]">Request a controlled trial workspace, or ask Linaw to handle the payroll cycle as a managed service.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0877ff] px-5 py-3 text-[13.5px] font-semibold text-white">
                Request trial access <ArrowRight size={14} aria-hidden />
              </Link>
              <Link href="/payroll-outsourcing" className="inline-flex items-center justify-center gap-2 rounded-full border border-[#D9DCEC] bg-white px-5 py-3 text-[13.5px] font-semibold text-[#2B2F45]">
                Payroll outsourcing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
