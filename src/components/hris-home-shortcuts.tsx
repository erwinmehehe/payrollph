"use client";

import Link from "next/link";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  Clock3,
  FileText,
  Search,
  Target,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { HrisHomeShortcut } from "@/lib/hris-home-shortcuts";
import { findAuthorizedHrisEmployees, type HrisQuickFindEmployee } from "@/lib/hris-quick-find";

const ICONS: Record<HrisHomeShortcut["icon"], LucideIcon> = {
  people: UsersRound,
  hire: UserPlus,
  documents: FileText,
  leave: CalendarDays,
  time: Clock3,
  approvals: ClipboardCheck,
  performance: Target,
  reports: ChartNoAxesCombined,
};

/** Shortcuts only; all mutations and permission checks remain in source pages. */
export function HrisHomeShortcuts({
  actions,
  onPage,
  reviewTeamHref,
  employees = [],
  onOpenEmployee,
}: {
  actions: readonly HrisHomeShortcut[];
  onPage: (page: string) => void;
  reviewTeamHref?: string | null;
  /** Authorized roster for the currently selected employer; never cross-employer search. */
  employees?: readonly HrisQuickFindEmployee[];
  onOpenEmployee?: (employeeId: number) => void;
}) {
  const [employeeQuery, setEmployeeQuery] = useState("");
  const canQuickFind = actions.some((action) => action.page === "People") && Boolean(onOpenEmployee);
  const matches = useMemo(
    () => canQuickFind ? findAuthorizedHrisEmployees(employees, employeeQuery) : [],
    [canQuickFind, employees, employeeQuery],
  );
  if (actions.length === 0) return null;
  const dailyIds = new Set(["directory", "hiring", "leave", "approvals"]);
  const dailyActions = actions.filter((action) => dailyIds.has(action.id));
  const additionalActions = actions.filter((action) => !dailyIds.has(action.id));

  return (
    <section aria-labelledby="hris-home-actions-heading"
      className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">HR workspace</p>
          <h2 id="hris-home-actions-heading" className="mt-1 text-xl font-semibold tracking-tight">
            Everyday HR
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Find an employee, onboard a hire, manage leave, review your team or handle approvals for this employer.
          </p>
        </div>
        <span className="text-xs text-slate-500">Available to your role</span>
      </div>
      {canQuickFind && (
        <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
          <label htmlFor="hris-employee-quick-find"
            className="mb-2 block text-sm font-semibold text-slate-900">
            Find an employee
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:ring-2 focus-within:ring-emerald-700">
            <Search size={18} className="shrink-0 text-slate-500" aria-hidden="true" />
            <input
              id="hris-employee-quick-find"
              type="search"
              autoComplete="off"
              maxLength={80}
              value={employeeQuery}
              onChange={(event) => setEmployeeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEmployeeQuery("");
                if (event.key === "Enter" && matches[0]) {
                  event.preventDefault();
                  onOpenEmployee?.(matches[0].id);
                  setEmployeeQuery("");
                }
              }}
              placeholder="Search name, employee number or job title"
              className="min-h-11 min-w-0 w-full border-0 bg-transparent py-2 text-sm text-slate-900 outline-none"
            />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Results come only from your current employer and authorized employee directory.
          </p>
          {employeeQuery.trim().length >= 2 && (
            <div className="mt-3" aria-live="polite" aria-label="Employee search results">
              {matches.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {matches.map((employee) => (
                    <li key={employee.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenEmployee?.(employee.id);
                          setEmployeeQuery("");
                        }}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm hover:border-emerald-600 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                        aria-label={`Open employee ${employee.firstName} ${employee.lastName}, ${employee.employeeNo}`}
                      >
                        <span className="min-w-0">
                          <strong className="block truncate text-slate-900">
                            {employee.firstName} {employee.lastName}
                          </strong>
                          <span className="block truncate text-xs text-slate-600">
                            {employee.employeeNo} · {employee.title}
                          </span>
                        </span>
                        <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-emerald-800" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg bg-white p-3 text-sm text-slate-600">
                  No matching employee in your authorized directory.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dailyActions.map((action) => {
          const Icon = ICONS[action.icon];
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onPage(action.page)}
              className="group flex min-h-32 items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left outline-offset-2 transition-colors hover:border-emerald-600 hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-emerald-700"
              aria-label={"Open " + action.title}
            >
              <span aria-hidden="true" className="shrink-0 rounded-lg bg-white p-2 text-emerald-800">
                <Icon size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{action.group}</span>
                <span className="mt-1 block text-sm font-semibold">{action.title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">{action.description}</span>
              </span>
              <ArrowRight aria-hidden="true" size={15} className="mt-1 shrink-0 text-slate-500 group-hover:text-emerald-800" />
            </button>
          );
        })}
      </div>
      {reviewTeamHref && (
        <div className="mt-3">
          <Link href={reviewTeamHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 hover:border-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
            <UsersRound size={18} aria-hidden="true" /> Review team <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      )}
      {additionalActions.length > 0 && (
        <details className="mt-5 rounded-xl border border-slate-200 px-4 py-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-800">
            More HR tools
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {additionalActions.map((action) => (
              <button key={action.id} type="button" onClick={() => onPage(action.page)}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
                <span><strong className="block">{action.title}</strong><span className="text-xs text-slate-600">{action.description}</span></span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
