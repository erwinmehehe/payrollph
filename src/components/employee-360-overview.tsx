"use client";

import {
  ArrowDownRight,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  FileText,
  BadgeDollarSign,
  ReceiptText,
  History,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { Employee360Card, Employee360CardId } from "@/lib/employee-360-overview";
import { focusEmployee360Section } from "@/lib/employee-360-focus";

const ICONS: Record<Employee360CardId, LucideIcon> = {
  employment: BriefcaseBusiness,
  onboarding: ClipboardList,
  documents: FileText,
  leave: CalendarDays,
  performance: Target,
  compensation: BadgeDollarSign,
  payroll: ReceiptText,
  history: History,
};

/**
 * Existing source sections stay authoritative. This summary never writes HR
 * decisions or payroll, and never invents a "completed" state for a missing
 * connected source.
 */
export function Employee360Overview({
  cards,
  employeeNo,
}: {
  cards: readonly Employee360Card[];
  employeeNo: string;
}) {
  return (
    <section aria-labelledby="employee-360-heading"
      className="employee-360 mb-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm sm:p-5">
      <header className="mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          People · {employeeNo}
        </span>
        <h3 id="employee-360-heading" className="mt-1 text-lg font-semibold tracking-tight">
          Employee 360
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          One read-only view of the selected employee&apos;s linked HR information. Choose a section to review
          its underlying source records.
        </p>
      </header>
      <div className="employee-360-grid">
        {cards.map((card) => {
          const Icon = ICONS[card.id];
          const isUnavailable = !card.available;
          return (
            <button key={card.id} type="button" disabled={isUnavailable} data-tone={card.tone}
              aria-label={"Review " + card.title + " details"}
              aria-controls={card.available ? card.targetId : undefined}
              onClick={() => {
                const target = document.getElementById(card.targetId);
                if (!target) return;
                // Section headings are not always natively focusable. Preserve
                // keyboard focus and respect the user's reduced-motion setting.
                focusEmployee360Section(
                  target, window.matchMedia("(prefers-reduced-motion: reduce)").matches,
                );
              }}
              className={
                "employee-360-card flex min-h-32 flex-col rounded-xl border p-3 text-left outline-offset-2 " +
                "focus-visible:ring-2 focus-visible:ring-emerald-700 " +
                (isUnavailable
                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500"
                  : card.tone === "attention"
                    ? "border-amber-200 bg-amber-50 text-slate-900 hover:border-amber-400"
                    : "border-slate-200 bg-slate-50 text-slate-900 hover:border-emerald-500 hover:bg-emerald-50")
              }>
              <span className="employee-360-card-heading flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Icon size={15} aria-hidden="true"/>
                  {card.title}
                </span>
                {card.available && <ArrowDownRight size={15} aria-hidden="true" className="text-slate-500"/>}
              </span>
              <strong className="employee-360-value mt-2 text-sm font-semibold leading-5">{card.value}</strong>
              <span className="employee-360-detail mt-1 text-xs leading-5 text-slate-600">{card.detail}</span>
              <span className="employee-360-source mt-auto pt-3 text-[10px] leading-4 text-slate-500">
                Source: {card.source}
              </span>
            </button>
          );
        })}
      </div>
      <details className="employee-360-context"><summary>About these source records</summary>
        <p className="mt-4 text-xs leading-5 text-slate-600">
          These are scoped, potentially incomplete source snapshots. Missing history or an empty queue
          is not proof of onboarding completion, verified documents, statutory compliance, or payroll settlement.
        </p>
      </details>
    </section>
  );
}
