"use client";

import Link from "next/link";
import {
  ArrowUpRight, CalendarClock, ClipboardCheck, Clock3, UsersRound,
} from "lucide-react";
import type { MyTeamResponse } from "@/lib/hcm-my-team-contract";
import { myTeamWorkflowHref, type MyTeamWorkflowPage } from "@/lib/hcm-my-team-navigation";

/** Read-only handoff: all decisions occur inside existing governed workflows. */
export function HcmMyTeamActionCenter({
  organizationId,
  summary,
}: {
  organizationId: number;
  summary: MyTeamResponse["summary"];
}) {
  const actions: Array<{
    page: MyTeamWorkflowPage;
    title: string;
    detail: string;
    note: string;
    icon: typeof CalendarClock;
  }> = [
    {
      page: "Leave",
      title: "Review team leave",
      detail: summary.pendingLeaveRecordsThisPage + " pending request(s) on this roster page",
      note: "Requests are not necessarily assigned to you.",
      icon: CalendarClock,
    },
    {
      page: "Time & attendance",
      title: "Review attendance",
      detail: summary.pendingAttendanceCorrectionsThisPage + " pending correction(s) · " +
        summary.incompletePunchRecordsThisPage + " incomplete punch record(s)",
      note: "Incomplete records can include in-progress shifts.",
      icon: Clock3,
    },
    {
      page: "Workforce",
      title: "Review overtime and schedules",
      detail: summary.pendingOvertimeRecordsThisPage + " pending overtime request(s) on this page",
      note: "Use the workforce source to see who can approve.",
      icon: UsersRound,
    },
    {
      page: "Approvals",
      title: "My assigned approvals",
      detail: "Open the governed decision queue",
      note: "Only actually assigned requests can be approved or declined.",
      icon: ClipboardCheck,
    },
  ];
  return (
    <section aria-labelledby="hcm-manager-action-heading"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Manager self-service</p>
        <h2 id="hcm-manager-action-heading" className="mt-1 text-xl font-bold">
          Team action center
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Find issues in your authorized team and go straight to the owning HR or workforce workflow.
          All counts are limited to this directory page, not the full team or your approval inbox.
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const href = myTeamWorkflowHref(organizationId, action.page);
          if (!href) return null;
          return (
            <Link key={action.page} href={href}
              className="group flex min-h-36 flex-col rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-900 outline-offset-2 hover:border-emerald-500 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-700">
              <span className="flex items-center justify-between gap-3 text-emerald-800">
                <Icon aria-hidden="true" size={20} />
                <ArrowUpRight aria-hidden="true" size={16} className="transition-transform group-hover:translate-x-0.5"/>
              </span>
              <span className="mt-3 text-sm font-semibold">{action.title}</span>
              <span className="mt-1 text-xs text-slate-700">{action.detail}</span>
              <span className="mt-auto pt-2 text-xs text-slate-500">{action.note}</span>
            </Link>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-600">
        This is a review and navigation surface only. Approvals, leave decisions,
        punch corrections, and overtime authorization remain governed by their existing endpoints.
      </p>
    </section>
  );
}
