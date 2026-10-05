"use client";

import { useMemo, useState } from "react";

type ChecklistItem = {
  id: string;
  label: string;
  note?: string;
};

type ChecklistSection = {
  title: string;
  items: ChecklistItem[];
};

export function ProcurementChecklist({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: ChecklistSection[];
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const completed = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="rounded-[22px] border border-[#E3E5EF] bg-white p-6">
          <h1 className="font-display text-[36px] font-semibold tracking-[-0.04em]">{title}</h1>
          <p className="mt-4 max-w-[760px] text-[14px] leading-relaxed text-[#5B6080]">{description}</p>
          <button
            type="button"
            onClick={() => window.print()}
            className="mt-5 rounded-full border border-[#D9DCEC] px-4 py-2.5 text-[12px] font-semibold print:hidden"
          >
            Print / Save as PDF
          </button>
        </div>

        <div className="mt-5 grid gap-5">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[22px] border border-[#E3E5EF] bg-white p-6">
              <h2 className="font-display text-[24px] font-semibold">{section.title}</h2>
              <div className="mt-4 grid gap-3">
                {section.items.map((item) => (
                  <label key={item.id} className="flex gap-3 rounded-[16px] bg-[#FAFBFD] p-4">
                    <input
                      type="checkbox"
                      checked={Boolean(checked[item.id])}
                      onChange={(event) => setChecked((current) => ({ ...current, [item.id]: event.target.checked }))}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span>
                      <span className="block text-[13.5px] font-semibold leading-relaxed text-[#34394F]">{item.label}</span>
                      {item.note ? <span className="mt-1 block text-[12px] leading-relaxed text-[#7C82A1]">{item.note}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <aside className="h-fit rounded-[22px] bg-[#11141F] p-5 text-white lg:sticky lg:top-24 print:hidden">
        <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/45">Checklist progress</p>
        <p className="mt-3 text-[34px] font-semibold">{completed}/{total}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-white transition-all" style={{ width: `${total ? (completed / total) * 100 : 0}%` }} />
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-white/55">
          Your selections stay in this browser session. Nothing in this checklist is submitted to Linaw.
        </p>
      </aside>
    </div>
  );
}
