"use client";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, AlertTriangle, Upload, Users, Wallet, ShieldCheck } from "lucide-react";
import type { DashboardData,PayrollRun } from "@/components/workspace/types";
import { uiMoney,uiDate,type TaskTarget } from "@/lib/task-first-ui";

export function TaskFirstPayrollHome({data,run,onTask,onNewRun}:{data:DashboardData;run?:PayrollRun;onTask:(target:TaskTarget)=>void;onNewRun:()=>void}) {
  const active = data.employees.filter(e=>e.status==="Active");
  const missingPayout = active.filter(e=>!e.bankCode || !e.bankAccount).length;
  const attendance = new Set((data.punches??[]).filter(p=>(!run || (p.workDate >= run.periodStart && p.workDate <= run.periodEnd)) && !["complete","present","ok","approved"].includes(p.status.toLowerCase())).map(p=>p.employeeId)).size;
  const exceptions = run?.exceptions ?? 0;
  const problemCount = missingPayout + attendance + exceptions;
  const calculated = Boolean(run && (Number(run.grossPay)>0 || run.status==="Released"));
  const submitted = Boolean(run && ["Pending approval","Ready for release","Released"].includes(run.status));
  const currentStep = !run || attendance>0 ? 0 : !calculated ? 1 : exceptions>0 ? 2 : 3;
  const stageNames = ["Inputs","Calculate","Review","Submit"];
  const gross=calculated?Number(run?.grossPay):null;
  const net=calculated?Number(run?.netPay):null;
  const money=(v:number|null)=>v==null ? "Not calculated" : uiMoney(v);
  const payrollTask=(focus:"workflow"|"register"|"exceptions")=>run ? onTask({page:"Payroll",runId:run.id,focus}) : onNewRun();
  return <div className="tf-payroll-home">
    <header className="tf-home-header"><div><div className="tf-kicker">PAYROLL WORKSPACE</div><h1>Let’s make payday a good day.</h1><p>Prepare, check, and send the current payroll for independent review.</p></div>
    <span className="tf-org-chip">{data.selectedOrganization.name} · Payroll officer</span></header>
    <div className="tf-payroll-grid">
      <section className="tf-card tf-current">
        <div className="tf-card-heading"><div><div className="tf-kicker">CURRENT PAYROLL</div><h2>{run ? run.periodLabel : "Your next payroll"}</h2><p>{run ? run.employeeCount+" employees · Pay date "+uiDate(run.payDate) : "Create a payroll run to begin"}</p></div><span className="tf-status">{run?.status ?? "Not started"}</span></div>
        <ol className="tf-step-track" aria-label="Current payroll progress">{stageNames.map((step,i)=><li className={submitted||i<currentStep?"tf-step-done":i===currentStep?"tf-step-current":""} key={step} aria-current={!submitted&&i===currentStep?"step":undefined}><span>{submitted||i<currentStep?<CheckCircle2 size={16}/>:i+1}</span>{step}</li>)}</ol>
        <div className="tf-primary-foot"><span>{submitted?"Your payroll is awaiting or has completed the independent review/release stage.":calculated?"Review the payroll register before submitting.":"Check inputs before calculating payroll."}</span><button type="button" className="tf-primary" onClick={()=>payrollTask("workflow")}>{run?"Continue payroll":"Create payroll"} <ArrowRight size={17}/></button></div>
      </section>
      <section className="tf-card tf-payday"><div className="tf-kicker">UPCOMING PAYDAY</div><CalendarDays size={21}/><strong>{run?uiDate(run.payDate):"Not scheduled"}</strong><p>{run ? run.employeeCount+" employees in this run" : "No payroll run selected"}</p><span className="tf-sublabel">{run?.scopeLabel ?? "New payroll"}</span></section>
    </div>
    <div className="tf-metrics" aria-label="Current payroll totals">
      <div className="tf-metric"><span><Wallet size={17}/> Gross pay</span><strong>{money(gross)}</strong><small>{calculated?"Calculated amount":"Awaiting calculation"}</small></div>
      <div className="tf-metric"><span><FileText size={17}/> Deductions</span><strong>{money(gross!==null && net!==null ? Math.max(0,gross-net):null)}</strong><small>Statutory and other deductions</small></div>
      <div className="tf-metric"><span><ShieldCheck size={17}/> Net pay</span><strong>{money(net)}</strong><small>{calculated?"Subject to review and release":"Awaiting calculation"}</small></div>
      <div className="tf-metric"><span><Users size={17}/> Employees</span><strong>{run?.employeeCount ?? active.length}</strong><small>{run?"Included in selected run":"Active employees"}</small></div>
    </div>
    <div className="tf-lower-grid">
      <section className="tf-card"><div className="tf-card-heading tf-row-heading"><h2>Needs your attention</h2><span className={"tf-count "+(problemCount?"tf-count-issue":"")}>{problemCount}</span></div>
        <ActionRow icon={<Clock3/>} issue={attendance>0} title={attendance ? attendance+" employee(s) with incomplete attendance":"Attendance inputs appear clear"} detail={attendance?"Review attendance exceptions before calculation":"No incomplete attendance in the selected period"} action="Review attendance" onClick={()=>onTask({page:"Time & attendance",filter:"attendance-exceptions"})}/>
        <ActionRow icon={<AlertTriangle/>} issue={exceptions>0} title={exceptions ? exceptions+" payroll exception(s) to review":"No exceptions reported on the run"} detail={exceptions?"Inspect the current run and the flagged entries":"Check the detailed register before submitting"} action="Review exceptions" onClick={()=>payrollTask("exceptions")}/>
        <ActionRow icon={<ShieldCheck/>} issue={missingPayout>0} title={missingPayout ? missingPayout+" employee(s) need payout details":"Payout details appear complete"} detail="This summary checks missing fields only, not bank acceptance." action="View employees" onClick={()=>onTask({page:"People",filter:"missing-payout"})}/>
      </section>
      <section className="tf-card"><div className="tf-card-heading tf-row-heading"><h2>Quick actions</h2></div>
        <ActionRow icon={<Upload/>} title="Import adjustments" detail="Open payroll preparation for this run" onClick={()=>payrollTask("workflow")}/>
        <ActionRow icon={<FileText/>} title="Preview payroll register" detail="Inspect stored employee-level amounts" onClick={()=>payrollTask("register")}/>
        <ActionRow icon={<AlertTriangle/>} title="Review exceptions" detail="Show flagged employee entries" onClick={()=>payrollTask("exceptions")}/>
      </section>
    </div>
    <p className="tf-footer-note">Financial values are drawn from the selected payroll record. Releasing payroll and exporting bank files require the existing independent authorization and evidence gates.</p>
  </div>;
}
function ActionRow({icon,title,detail,issue=false,action,onClick}:{icon:React.ReactNode;title:string;detail:string;issue?:boolean;action?:string;onClick:()=>void}) {
 return <button type="button" className="tf-action-row" onClick={onClick}><span className={"tf-action-icon "+(issue?"tf-icon-issue":"")}>{icon}</span><span className="tf-action-copy"><strong>{title}</strong><small>{detail}</small></span><span className="tf-action-go">{action??"Open"} <ArrowRight size={15}/></span></button>;
}
