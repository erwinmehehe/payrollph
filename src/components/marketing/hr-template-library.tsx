"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Download, Printer, RotateCcw } from "lucide-react";
import { HR_CHECKLIST_TEMPLATES, hrChecklistCsv } from "@/lib/hr-checklist-templates";
import "./hr-template-library.css";

export function HrTemplateLibrary() {
  const [slug, setSlug] = useState(HR_CHECKLIST_TEMPLATES[0].slug);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const selected = useMemo(
    () => HR_CHECKLIST_TEMPLATES.find((template) => template.slug === slug) ?? HR_CHECKLIST_TEMPLATES[0],
    [slug],
  );
  const total = selected.sections.reduce((sum, section) => sum + section.items.length, 0);
  const previewChecked = Object.entries(checked).filter(([key, value]) => key.startsWith(slug + ":") && value).length;
  const csvHref = "data:text/csv;charset=utf-8," + encodeURIComponent(hrChecklistCsv(selected));

  return (
    <section aria-label="HR templates" className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-14">
      <div className="hr-template-layout grid gap-6 lg:grid-cols-[315px_minmax(0,1fr)]">
        <aside className="hr-template-sidebar rounded-2xl border border-slate-200 bg-white p-3">
          <h2 className="px-3 py-3 text-sm font-semibold text-slate-800">Choose a blank checklist</h2>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1" role="group" aria-label="HR checklist templates">
            {HR_CHECKLIST_TEMPLATES.map((item) => (
              <button key={item.slug} type="button" aria-pressed={selected.slug === item.slug}
                onClick={() => setSlug(item.slug)}
                className={"min-h-14 rounded-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 " +
                  (selected.slug === item.slug ? "bg-[#e9f2ff] text-[#065ac4]" : "text-slate-700 hover:bg-slate-50")}>
                <span className="block text-sm font-semibold">{item.title}</span>
                <span className="mt-1 block text-xs opacity-75">{item.category}</span>
              </button>
            ))}
          </div>
        </aside>

        <article className="hr-template-sheet min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-8" aria-live="polite">
          <div className="hr-template-explainer flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full bg-[#e9f2ff] px-3 py-1 text-xs font-semibold text-[#065ac4]">{selected.category} · Blank template</span>
            <span className="text-xs text-slate-500">{selected.audience}</span>
          </div>
          <h2 className="font-display mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{selected.title}</h2>
          <p className="mt-2 max-w-[690px] text-sm leading-relaxed text-slate-600">{selected.description}</p>
          <div className="hr-template-controls mt-6 flex flex-wrap gap-2">
            <a download={selected.slug + ".csv"} href={csvHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0877ff] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
              <Download size={16} aria-hidden="true" /> Download blank CSV
            </a>
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800">
              <Printer size={16} aria-hidden="true" /> Print
            </button>
            <button type="button" onClick={() => setChecked({})} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800">
              <RotateCcw size={16} aria-hidden="true" /> Reset preview
            </button>
          </div>
          <p className="hr-template-reset mt-3 flex items-center gap-2 text-xs text-slate-600" role="status">
            <CheckCircle2 size={15} aria-hidden="true" /> {previewChecked} of {total} preview boxes checked. Checks are not saved or submitted.
          </p>
          <div className="mt-7 space-y-7">
            {selected.sections.map((section, sectionIndex) => (
              <section key={section.title} aria-labelledby={"hr-section-" + sectionIndex}>
                <h3 id={"hr-section-" + sectionIndex} className="border-b border-slate-200 pb-2 text-base font-semibold text-slate-900">{section.title}</h3>
                <ul className="mt-3 space-y-2">
                  {section.items.map((item, itemIndex) => {
                    const key = slug + ":" + sectionIndex + ":" + itemIndex;
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm leading-relaxed text-slate-800 hover:bg-slate-50">
                          <input type="checkbox" checked={Boolean(checked[key])}
                            onChange={(event) => setChecked((current) => ({ ...current, [key]: event.target.checked }))}
                            className="mt-0.5 h-5 w-5 shrink-0 accent-[#0877ff]" />
                          <span>{item}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <p className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-600">
            Planning aid only. Adapt to employer policy and current Philippine requirements. This public page has no employee-data collection,
            approval capability, storage or connection to payroll. Use your employer&apos;s authorized system for actual records and decisions.
          </p>
        </article>
      </div>
    </section>
  );
}
