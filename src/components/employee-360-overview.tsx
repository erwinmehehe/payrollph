"use client";

import { useState } from "react";

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
import { EMPLOYEE_360_SECTIONS, cardsForEmployee360Section, type Employee360SectionId } from "@/lib/employee-360-navigation";

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
  const [section, setSection] = useState<Employee360SectionId>("overview");
  const activeGroup = EMPLOYEE_360_SECTIONS.find(group => group.id === section)!;
  const displayedCards = cardsForEmployee360Section(cards, section);
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
          One read-only entry point to the selected employee&apos;s authorized records. Current employee fields
          are not historical as-of facts. History is shown only from linked effective-dated records.
        </p>
      </header>
      <nav aria-label="Employee 360 sections" className="mb-4 flex flex-wrap gap-2">
        {EMPLOYEE_360_SECTIONS.map(group => (
          <button key={group.id} type="button" aria-pressed={section === group.id}
            aria-controls="employee-360-section" onClick={() => setSection(group.id)}
            className={"rounded-lg border px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 " +
              (section === group.id ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
            {group.label}
          </button>
        ))}
      </nav>
      <div id="employee-360-section" aria-live="polite" className="mb-3">
        <h4 className="text-sm font-semibold text-slate-900">{activeGroup.label}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {section === "history"
            ? "As-of evidence comes from recorded employment event dates and effective position assignments. This preview may not contain every historical record."
            : "Values reflect the connected, authorized source snapshot. Select a card to inspect its original records and effective dates where available."}
        </p>
      </div>
      <div className="employee-360-grid">
        {displayedCards.map((card) => {
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
