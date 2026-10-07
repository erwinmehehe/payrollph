"use client";

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { DEMO_ROLES, demoRolePath, type DemoRoleId } from "@/lib/demo-roles";
import { AppProductPreview } from "@/components/marketing/claude-home/components/AppProductPreview";

export function DemoRolePicker() {
  const [selectedRole, setSelectedRole] = useState<DemoRoleId>("payroll");
  const [launching, setLaunching] = useState<DemoRoleId | null>(null);
  const [error, setError] = useState("");
  const selected = DEMO_ROLES.find((role) => role.id === selectedRole) ?? DEMO_ROLES[0];

  async function openDemo(role: DemoRoleId) {
    if (launching) return;
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

  function selectByKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = DEMO_ROLES.length;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index+1)%count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index-1+count)%count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count-1;
    else return;
    event.preventDefault();
    setSelectedRole(DEMO_ROLES[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] pb-20 text-[#10213d]">
      <section className="border-b border-[#e5eaf1] bg-[radial-gradient(ellipse_at_78%_25%,#e8f3ff,transparent_50%),#fbfdff]">
        <div className="mx-auto max-w-[1240px] px-5 pb-14 pt-16 sm:px-8 sm:pb-18 sm:pt-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d9e6f6] bg-white px-3 py-2 text-[11px] font-semibold text-[#35668c]">
            <ShieldCheck size={14} aria-hidden="true" />
            Current Linaw interface · six roles · sample data
          </div>
          <div className="mt-6 grid items-end gap-6 lg:grid-cols-[1fr_auto]">
            <div>
              <h1 className="font-display max-w-[780px] text-balance text-[43px] font-semibold leading-[1.1] tracking-[-.045em] sm:text-[61px]">
                See Linaw from the seat you actually use.
              </h1>
              <p className="mt-5 max-w-[780px] text-[16px] leading-[1.8] text-[#60758a]">
                Choose a workspace below. Its preview mirrors the current role-specific app layout; opening the sandbox signs you into a populated example organization with that role's permissions.
              </p>
            </div>
            <Link href="/#demo" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#dce5ee] bg-white px-4 py-3 text-[13px] font-semibold text-[#315d8d] hover:bg-[#f0f6ff]">
              Back to homepage <ArrowUpRight size={15} aria-hidden="true"/>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-5 pt-12 sm:px-8">
        <div className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-[.15em] text-[#457db5]">Pick a role</p>
          <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-.035em] sm:text-[39px]">Choose a seat, then do the work.</h2>
          <p className="mt-2 max-w-[740px] text-[14px] leading-[1.7] text-[#718198]">This guided view is illustrative. The button below opens the actual role-based product experience.</p>
        </div>

        {error && <div role="alert" className="mb-5 rounded-lg border border-[#f0cbd4] bg-[#fff3f5] px-5 py-4 text-[13px] font-medium text-[#9f2c47]">{error}</div>}

        <div role="tablist" aria-label="Demo roles" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {DEMO_ROLES.map((role,index)=>(
            <button key={role.id} id={"demo-role-"+role.id} type="button" role="tab"
              aria-controls="demo-role-panel" aria-selected={selectedRole===role.id} tabIndex={selectedRole===role.id?0:-1}
              onClick={()=>setSelectedRole(role.id)} onKeyDown={event=>selectByKey(event,index)}
              className={"min-h-[74px] rounded-lg border px-4 py-3 text-left transition-colors " + (selectedRole===role.id?"border-[#bfd6f9] bg-[#e9f3ff] text-[#075ee3]":"border-[#e0e8f0] bg-white text-[#465c73] hover:bg-[#f0f6ff]")}>
              <strong className="block text-[13px]">{role.label}</strong>
              <small className="mt-1 block truncate text-[11px] opacity-75">{role.person}</small>
            </button>
          ))}
        </div>

        <div id="demo-role-panel" role="tabpanel" tabIndex={0} aria-labelledby={"demo-role-"+selectedRole} className="mt-4">
          <AppProductPreview role={selectedRole}/>
        </div>

        <div className="mt-5 grid items-start gap-6 rounded-xl border border-[#e1e9f2] bg-white p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
          <div>
            <h3 className="text-[21px] font-semibold tracking-tight">{selected.label}: {selected.person}</h3>
            <p className="mt-2 max-w-[740px] text-[13px] leading-[1.8] text-[#64758b]">{selected.description}</p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-3">
              {selected.tasks.map(task=>(
                <li key={task.id} className="rounded-lg border border-[#e7edf4] bg-[#fafcff] p-3">
                  <strong className="block text-[12px] text-[#274665]">{task.label}</strong>
                  <span className="mt-1 block text-[11px] leading-[1.6] text-[#718296]">{task.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={()=>openDemo(selectedRole)} disabled={launching!==null}
            className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#0866ed] px-6 py-3 text-[13px] font-bold text-white transition-colors hover:bg-[#0754c5] disabled:cursor-wait disabled:opacity-65"
            style={{color:"#fff",backgroundColor:"#0866ed"}}>
            {launching===selectedRole?<><LoaderCircle size={16} className="animate-spin" aria-hidden="true"/>Opening workspace</>:<>Open {selected.label} workspace <ArrowRight size={16} aria-hidden="true"/></>}
          </button>
        </div>
        <p className="mt-5 text-[11px] leading-[1.7] text-[#78899d]">The preview contains illustrative sample amounts and statuses. App permissions, payroll outcomes and government filing acceptance are determined in the actual workspace, not in this marketing preview.</p>
      </section>
    </main>
  );
}
