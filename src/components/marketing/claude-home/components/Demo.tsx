"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { DEMO_ROLES, type DemoRoleId } from "@/lib/demo-roles";
import { AppProductPreview } from "./AppProductPreview";

export default function Demo() {
  const [role, setRole] = useState<DemoRoleId>("payroll");
  const chosen = DEMO_ROLES.find((option) => option.id === role) ?? DEMO_ROLES[0];

  function chooseWithKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = DEMO_ROLES.length;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    setRole(DEMO_ROLES[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <section id="demo" className="scroll-mt-24 border-y border-[#e6ecf3] bg-[#f8fafc] py-20 sm:py-24">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
          <div className="max-w-[800px]">
            <p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#316fae]">The actual product design</p>
            <h2 className="font-display mt-3 text-balance text-[35px] font-semibold leading-[1.12] tracking-[-.04em] text-[#10213d] sm:text-[47px]">
              See the product from every seat involved in payday.
            </h2>
            <p className="mt-4 max-w-[660px] text-[15px] leading-[1.8] text-[#64748b]">
              Switch between the six roles that prepare, review, release, close and receive payroll. These previews mirror the current Linaw interface; the sandbox contains the working controls.
            </p>
          </div>
          <Link href="/demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#d0ddec] bg-white px-5 py-3 text-[13px] font-bold text-[#075ee3] hover:bg-[#edf5ff]">
            Open working sandbox <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div role="tablist" aria-label="Sample payroll roles" className="mt-9 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {DEMO_ROLES.map((option,i)=>(
            <button type="button" role="tab" key={option.id} id={"sample-role-"+option.id}
              aria-selected={role===option.id} aria-controls="sample-role-panel"
              tabIndex={role===option.id?0:-1} onClick={()=>setRole(option.id)}
              onKeyDown={(event)=>chooseWithKeys(event,i)}
              className={"min-h-14 rounded-lg border px-3 py-3 text-left transition-colors " + (role===option.id?"border-[#bfd7fc] bg-[#e9f3ff] text-[#075ee3]":"border-[#e0e7ef] bg-white text-[#465b75] hover:bg-[#f0f6ff]")}>
              <span className="block text-[12px] font-bold">{option.label}</span>
              <span className="mt-1 block truncate text-[10px] opacity-70">{option.shortLabel} view</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" id="sample-role-panel" aria-labelledby={"sample-role-"+role} tabIndex={0} className="mt-4 outline-none focus-visible:outline-2 focus-visible:outline-[#0866ed]">
          <AppProductPreview role={role} />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 text-[12px] leading-relaxed text-[#667a92]">
          <p><strong className="text-[#314966]">{chosen.label}:</strong> {chosen.description}</p>
          <Link href="/demo" className="inline-flex shrink-0 items-center gap-2 font-bold text-[#0866ed] hover:underline">Use the real sandbox <ArrowRight size={15}/></Link>
        </div>
      </div>
    </section>
  );
}
