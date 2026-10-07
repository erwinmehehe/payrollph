"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CheckCircle2, ClipboardCheck, FileText, ShieldCheck, Users, Wallet } from "lucide-react";

const roles = [
  { id: "payroll", name: "Payroll Officer", sub: "Prepare & calculate", icon: Wallet, heading: "Make every payroll run reviewable.", body: "Inspect approved inputs, calculations and exceptions before handing the run to a checker.", metricLabel: "Illustrative net payroll", metric: "₱462,500", rows: [["Approved inputs", "Ready", "ok"], ["Statutory calculations", "Calculated", "ok"], ["Attendance adjustment", "Review", "warn"]], next: "Resolve exceptions, then submit for independent review." },
  { id: "checker", name: "Checker", sub: "Review differences", icon: ClipboardCheck, heading: "Review the changes, not just totals.", body: "Compare this run with the previous period and investigate salary, overtime or banking changes.", metricLabel: "Sample review items", metric: "2", rows: [["Overtime variance", "Review", "warn"], ["New hire adjustment", "Review", "warn"], ["Bank information", "No change", "ok"]], next: "Approve the reviewed run or return it to Payroll." },
  { id: "owner", name: "Owner", sub: "Authorize release", icon: ShieldCheck, heading: "Know whether payroll is ready to release.", body: "Make the funding decision with clear checker approval, exception and payout context.", metricLabel: "Illustrative release state", metric: "On hold", rows: [["Checker approval", "Pending", "warn"], ["Open exceptions", "2 remaining", "warn"], ["Funding confirmation", "To confirm", "neutral"]], next: "Release stays conditional on approval and payment checks." },
  { id: "hr", name: "HR Admin", sub: "Prepare people data", icon: Users, heading: "Know what changed before payroll starts.", body: "Review employee records, effective dates and authorized attendance inputs for the cutoff.", metricLabel: "Sample input handoff", metric: "In progress", rows: [["Employee changes", "Recorded", "ok"], ["Attendance exceptions", "2 to review", "warn"], ["Pay inputs", "Pending", "neutral"]], next: "Hand verified workforce inputs to the Payroll Officer." },
  { id: "employee", name: "Employee", sub: "See your payslip", icon: FileText, heading: "A simpler view of payday.", body: "Employees see their own payslips and details without access to anyone else's payroll information.", metricLabel: "Illustrative net pay", metric: "₱28,450", rows: [["Gross pay", "₱32,000", "neutral"], ["Deductions", "₱3,550", "neutral"], ["Payslip", "Available", "ok"]], next: "Only the signed-in employee can access their own payroll record." },
] as const;

export default function Demo() {
  const [active, setActive] = useState(0);
  const selected = roles[active];
  const SelectedIcon = selected.icon;
  return (
    <section id="demo" className="scroll-mt-24 border-y border-[#e7edf5] bg-[#f7faff] py-20 sm:py-24">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
          <div className="max-w-[720px]">
            <p className="text-[11px] font-bold uppercase tracking-[.17em] text-[#3779b7]">Explore the workflow</p>
            <h2 className="font-display mt-3 text-balance text-[36px] font-semibold leading-[1.13] tracking-[-.04em] text-[#14263d] sm:text-[48px]">A clearer view for every decision-maker.</h2>
            <p className="mt-4 max-w-[640px] text-[15px] leading-[1.8] text-[#62758c]">Explore the role-specific handoffs from payroll preparation to employee payslips, using a consistent sample interface.</p>
          </div>
          <Link href="/demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#cfdef2] bg-white px-6 py-3 text-[13px] font-bold text-[#1766c6] hover:bg-[#edf5ff]">
            Open real role-based sandbox <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-10 overflow-hidden rounded-[28px] border border-[#dfe9f5] bg-white shadow-[0_30px_70px_-44px_rgba(26,70,122,.28)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf1f6] px-5 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf2ff] text-[#1767d0]"><ShieldCheck size={18} aria-hidden="true" /></span>
              <div><p className="text-[13px] font-bold text-[#1b3048]">Linaw · workflow preview</p><p className="text-[11px] text-[#8191a8]">Choose a role to explore its next decision</p></div>
            </div>
            <span className="rounded-full border border-[#e4eaf4] bg-[#f8fbff] px-3 py-1.5 text-[11px] font-semibold text-[#71859e]">Illustrative · sample data</span>
          </div>
          <div className="grid lg:grid-cols-[290px_minmax(0,1fr)]">
            <div className="border-b border-[#edf1f6] bg-[#fbfcff] p-3 sm:p-5 lg:border-b-0 lg:border-r">
              <p className="px-3 pb-3 pt-2 text-[10px] font-bold uppercase tracking-[.17em] text-[#91a1b5]">Workspaces</p>
              <div role="tablist" aria-label="Sample payroll roles" className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {roles.map((role, index) => (
                  <button key={role.id} type="button" id={"sample-role-" + role.id} role="tab" aria-controls="sample-role-panel" aria-selected={active === index} onClick={() => setActive(index)}
                    className={"flex min-h-[64px] items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition-colors sm:px-4 " + (active === index ? "border-[#cbdff9] bg-[#edf5ff] text-[#155fc6]" : "border-transparent bg-white text-[#53677e] hover:border-[#e5ebf5] hover:bg-[#f5f9ff]")}>
                    <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + (active === index ? "bg-[#dcecff]" : "bg-[#f1f4f9]")}><role.icon size={17} aria-hidden="true" /></span>
                    <span className="min-w-0"><span className="block text-[12px] font-bold leading-snug">{role.name}</span><span className="mt-0.5 block text-[10px] leading-snug opacity-75">{role.sub}</span></span>
                  </button>
                ))}
              </div>
              <p className="mt-5 hidden rounded-xl border border-[#e5ebf4] bg-white p-3 text-[11px] leading-[1.7] text-[#73849d] lg:block">This is a conceptual role walkthrough. Use the sandbox for working application controls.</p>
            </div>
            <div id="sample-role-panel" role="tabpanel" tabIndex={0} aria-labelledby={"sample-role-" + selected.id} className="min-w-0 p-5 sm:p-7 lg:p-8">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="max-w-[525px]">
                  <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf3ff] text-[#2368bf]"><SelectedIcon size={18} aria-hidden="true" /></span><span className="text-[11px] font-bold text-[#4175b5]">{selected.name} · example view</span></div>
                  <h3 className="font-display mt-4 text-balance text-[24px] font-semibold leading-snug tracking-[-.03em] text-[#182d47] sm:text-[30px]">{selected.heading}</h3>
                  <p className="mt-3 text-[13px] leading-[1.75] text-[#667990]">{selected.body}</p>
                </div>
                <div className="w-full rounded-[18px] border border-[#deebfa] bg-[#f3f8ff] p-4 sm:w-[210px]"><p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#6985a5]">{selected.metricLabel}</p><p className="mt-2 break-words text-[26px] font-bold tracking-[-.035em] text-[#1468d3]">{selected.metric}</p><p className="mt-1 text-[10px] text-[#8b9db1]">Sample, not a real transaction</p></div>
              </div>
              <div className="mt-7 overflow-hidden rounded-[16px] border border-[#e5ebf4]">
                <div className="flex items-center justify-between border-b border-[#eaf0f5] bg-[#f9fbfe] px-4 py-3"><strong className="text-[12px] text-[#28415d]">Review details</strong><span className="text-[10px] text-[#879ab0]">Illustrative status</span></div>
                {selected.rows.map(([name,value,tone]) => (
                  <div key={name} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eff2f6] px-4 py-4 last:border-0">
                    <span className="flex items-center gap-2 text-[12px] font-semibold text-[#496078]">{tone === "warn" ? <CircleAlert size={16} className="shrink-0 text-[#bd8a3d]" aria-hidden="true" /> : <CheckCircle2 size={16} className="shrink-0 text-[#3d9c77]" aria-hidden="true" />}{name}</span>
                    <span className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + (tone === "warn" ? "bg-[#fff2e0] text-[#a27125]" : tone === "ok" ? "bg-[#e7f7ee] text-[#217b59]" : "bg-[#f0f3fa] text-[#6a7d94]")}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[15px] border border-[#dceaf9] bg-[#edf5ff] p-4"><p className="flex max-w-[530px] items-start gap-2 text-[12px] font-medium leading-[1.65] text-[#426b95]"><ClipboardCheck size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{selected.next}</p><Link href="/demo" className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] font-bold text-[#1362c9] hover:underline">Try in sandbox <ArrowRight size={15} aria-hidden="true" /></Link></div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-[1.7] text-[#8192a9]">This role preview is a visual explanation, not a second interactive payroll application or proof of a real transaction. It shows no customer data or government certification.</p>
      </div>
    </section>
  );
}
