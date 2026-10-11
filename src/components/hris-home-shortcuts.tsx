"use client";

import {
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  Clock3,
  FileText,
  Target,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { HrisHomeShortcut } from "@/lib/hris-home-shortcuts";

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
}: {
  actions: readonly HrisHomeShortcut[];
  onPage: (page: string) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <section aria-labelledby="hris-home-actions-heading"
      className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">HR workspace</p>
          <h2 id="hris-home-actions-heading" className="mt-1 text-xl font-semibold tracking-tight">
            People operations
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Go directly to an existing HR workflow for this employer.
          </p>
        </div>
        <span className="text-xs text-slate-500">Available to your role</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => {
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
    </section>
  );
}
