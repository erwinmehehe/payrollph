import Link from "next/link";
import { AppProductPreview } from "./AppProductPreview";
import {
  ArrowRight, BriefcaseBusiness, CalendarDays, Check, ChevronRight,
  ClipboardCheck, FileCheck2, FileText, Landmark, Layers3, ShieldCheck,
  UserRoundCheck, Users, Wallet,
} from "lucide-react";

const smallLabel = "text-[11px] font-bold uppercase tracking-[.16em] text-[#4373b4]";
const headline = "font-display text-balance text-[35px] font-semibold leading-[1.1] tracking-[-.04em] text-[#14243a] sm:text-[48px]";
const panel = "overflow-hidden rounded-[26px] border border-[#e3eaf3] bg-white shadow-[0_24px_64px_-40px_rgba(37,77,135,.22)]";

function FeatureList({items}: {items:string[]}) {
  return <ul className="mt-6 grid gap-3">{items.map(item=>(
    <li key={item} className="flex items-start gap-3 text-[14px] leading-[1.65] text-[#4d6078]">
      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e5f8ee] text-[#0b9355]"><Check size={12} strokeWidth={2.7} aria-hidden="true"/></span>
      {item}
    </li>
  ))}</ul>;
}

export function SectionTitle({label,title,description,centered=false}:{label:string,title:string,description:string,centered?:boolean}) {
  return <div className={centered?"mx-auto max-w-[750px] text-center":"max-w-[650px]"}>
    <p className={smallLabel}>{label}</p>
    <h2 className={headline+" mt-3"}>{title}</h2>
    <p className="mt-4 text-[15px] leading-[1.8] text-[#65758b] sm:text-[16px]">{description}</p>
  </div>;
}

const solutions = [
  {name:"Payroll",overline:"01 · PAYROLL",href:"/#payroll",copy:"Review every payroll run before money moves.",bullets:["Gross-to-net calculations","Approvals, payslips & exports"], icon:Wallet,tone:"bg-[#e9f2ff] text-[#176be9]",panelTone:"bg-[#f4f8ff]"},
  {name:"Workforce Management",overline:"02 · WFM",href:"/workforce-management",copy:"Connect schedules, attendance and worked time to payroll.",bullets:["Shift and rest-day schedules","Attendance & overtime review"],icon:CalendarDays,tone:"bg-[#e6f9ef] text-[#078b52]",panelTone:"bg-[#f5fcf7]"},
  {name:"Human Capital Management",overline:"03 · HCM",href:"/hcm",copy:"Keep employee changes, roles and positions connected.",bullets:["Employee lifecycle","Workforce and position records"],icon:Users,tone:"bg-[#f0ebff] text-[#6a49dc]",panelTone:"bg-[#faf8ff]"},
  {name:"Payroll Outsourcing",overline:"04 · SERVICE",href:"/payroll-outsourcing",copy:"Get help processing payroll while your team retains approval.",bullets:["Managed payroll processing","Clear input and review handoffs"],icon:BriefcaseBusiness,tone:"bg-[#fff1df] text-[#b76c15]",panelTone:"bg-[#fffaf3]"},
];
const solutionJourneys: Record<string, string[]> = {
  Payroll: ["Inputs", "Review", "Payslips"],
  "Workforce Management": ["Schedule", "Time", "Payroll"],
  "Human Capital Management": ["Employee", "Changes", "Payroll"],
  "Payroll Outsourcing": ["Inputs", "Approval", "Outputs"],
};

export function SolutionsGrid() {
  return <section id="solutions" className="scroll-mt-24 py-16 sm:py-20">
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <SectionTitle label="Connected around payroll" title="Payroll first. Workforce and HCM connected around it." description="Start with the payroll run, then connect schedules, attendance, employee records and managed processing without stitching together separate workflows." centered />
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {solutions.map(item=>(
          <article key={item.name} className="group flex h-full flex-col overflow-hidden rounded-[25px] border border-[#e5eaf3] bg-white transition-transform hover:-translate-y-1 hover:shadow-[0_20px_45px_-30px_rgba(24,53,98,.25)]">
            <div className="flex-1 p-6">
              <div className="flex items-center justify-between">
                <span className={"flex h-11 w-11 items-center justify-center rounded-[14px] "+item.tone}><item.icon size={21} aria-hidden="true"/></span>
                <span className="text-[10px] font-bold tracking-wider text-[#97a1b1]">{item.overline}</span>
              </div>
              <h3 className="mt-6 text-[21px] font-bold tracking-tight text-[#17283f]">{item.name}</h3>
              <p className="mt-2 min-h-[68px] text-[13px] leading-[1.7] text-[#6a7890]">{item.copy}</p>
              <ul className="mt-4 space-y-2.5">{item.bullets.map(t=><li key={t} className="flex items-start gap-2 text-[12px] font-medium text-[#51627b]"><Check size={13} className="mt-0.5 shrink-0 text-[#149c66]"/>{t}</li>)}</ul>
              <Link href={item.href} className="mt-6 inline-flex items-center gap-2 text-[13px] font-bold text-[#176be9] hover:underline">Explore {item.name}<ArrowRight size={14} aria-hidden="true"/></Link>
            </div>
            <div className={"border-t border-[#edf1f6] px-5 py-4 "+item.panelTone}>
              <p className="text-[9px] font-bold uppercase tracking-[.13em] text-[#8190a7]">Workflow at a glance</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {solutionJourneys[item.name].map((step,i)=>(
                  <span key={step} className="inline-flex items-center gap-1.5">
                    {i > 0 && <ChevronRight size={12} className="text-[#9db0c6]" aria-hidden="true" />}
                    <span className="rounded-lg border border-[#e2eaf5] bg-white px-2 py-1 text-[10px] font-semibold text-[#47617d]">{step}</span>
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>;
}

export function PayrollPreview() {
  return <AppProductPreview role="payroll" />;
}

export function PayrollShowcase() {
  return <section id="payroll" className="scroll-mt-24 bg-[#f8fbff] py-20 sm:py-24">
    <div className="mx-auto grid max-w-[1240px] items-center gap-11 px-5 sm:px-8 lg:grid-cols-[.83fr_1.17fr]">
      <div><SectionTitle label="Payroll software" title="Go from attendance to payslips with a clear approval trail." description="Prepare inputs, calculate pay, inspect variances and hand a reviewed run to the right approver. Keep government reporting evidence distinct from external agency acceptance."/>
        <FeatureList items={["SSS, PhilHealth, Pag-IBIG and BIR withholding calculations","Holiday, rest-day, overtime and night-work payroll inputs","Maker-checker review and audit history","Employee payslips, accounting exports and supported government worksheets"]}/>
        <Link href="/demo" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#132841] px-6 py-3.5 text-[13px] font-semibold text-white">Explore payroll workspace <ArrowRight size={15}/></Link>
      </div>
      <PayrollPreview/>
    </div>
  </section>;
}

export function WfmPreview() {
  const days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const data=[
    {role:"Team A",cells:["D","D","D","D","D","—","—"]},
    {role:"Team B",cells:["N","N","N","—","—","N","N"]},
    {role:"Team C",cells:["D","D","—","D","D","D","—"]},
  ];
  return <div className={panel}>
    <div className="flex items-center justify-between border-b border-[#eaf0f5] px-5 py-4">
      <div className="flex items-center gap-2.5"><CalendarDays size={19} className="text-[#13986f]"/><div><strong className="text-[14px] text-[#1b3048]">Workforce scheduling</strong><p className="text-[10px] text-[#8794a6]">Illustrative weekly schedule</p></div></div>
      <span className="rounded-full bg-[#e6f8f0] px-2.5 py-1 text-[10px] font-bold text-[#13966a]">Sample</span>
    </div>
    <div className="p-4 sm:p-5">
      <div className="grid grid-cols-3 gap-2">
        {[["Scheduled shifts","15"],["Review flags","2"],["Time records","Synced"]].map(([k,v])=><div key={k} className="rounded-xl border border-[#e5ecef] bg-[#f8fcfa] px-3 py-3"><p className="text-[9px] text-[#7e9190]">{k}</p><strong className="mt-2 block text-[16px] text-[#203b38]">{v}</strong></div>)}
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-[#e4edf0]">
        <table className="w-full min-w-[400px] text-center text-[10px]">
          <thead><tr className="bg-[#f7fbfa] text-[#7a8c90]"><th scope="col" className="px-2 py-3 text-left">Teams</th>{days.map(d=><th scope="col" key={d} className="px-2 py-3">{d}</th>)}</tr></thead>
          <tbody>{data.map(row=><tr key={row.role} className="border-t border-[#eaf0ef]"><th scope="row" className="whitespace-nowrap px-2 py-3 text-left font-semibold text-[#2d4847]">{row.role}</th>{row.cells.map((v,i)=><td key={i} className="px-1 py-2"><span className={v==="D"?"inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#e4f7ed] font-bold text-[#15845b]":v==="N"?"inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#eaf0ff] font-bold text-[#466bd3]":"inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#f4f6f9] text-[#a1aaba]"}>{v}</span></td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#ecf9f2] px-4 py-3">
        <span className="flex items-center gap-2 text-[11px] font-semibold text-[#217251]"><ClipboardCheck size={15}/> Attendance reviewed before payroll</span>
        <span className="text-[10px] text-[#458872]">D = Day · N = Night</span>
      </div>
    </div>
  </div>;
}

export function WorkforceShowcase() {
  return <section id="wfm" className="scroll-mt-24 py-20 sm:py-24">
    <div className="mx-auto grid max-w-[1240px] items-center gap-11 px-5 sm:px-8 lg:grid-cols-[1.16fr_.84fr]">
      <div className="lg:order-1"><WfmPreview/></div>
      <div className="lg:order-2"><SectionTitle label="Workforce management" title="Know who worked, when, and what payroll needs to review." description="Build schedules around real teams, account for rest days and overnight work, and carry reviewed time data into payroll without hiding exceptions."/>
        <FeatureList items={["Shift schedules, swaps and effective-dated rest days","Raw punches and attendance exception handling","Overtime approval evidence without suppressing legally owed pay","Holiday, night differential and workforce cost context"]}/>
        <Link href="/workforce-management" className="mt-8 inline-flex items-center gap-2 text-[14px] font-bold text-[#1668ec] hover:underline">Explore workforce management <ArrowRight size={16}/></Link>
      </div>
    </div>
  </section>;
}

export function HcmPreview() {
  return <div className={panel}>
    <div className="flex items-center justify-between border-b border-[#eaf0f5] px-5 py-4">
      <div className="flex items-center gap-2.5"><Users size={19} className="text-[#7355d9]"/><div><strong className="text-[14px] text-[#1b3048]">People & positions</strong><p className="text-[10px] text-[#8794a6]">Illustrative HCM view</p></div></div>
      <span className="rounded-full bg-[#f2edff] px-3 py-1 text-[10px] font-bold text-[#7658d6]">Sample</span>
    </div>
    <div className="p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-[#ece7f8] bg-[#faf8ff] p-4"><p className="text-[10px] text-[#978cae]">Worker lifecycle</p><strong className="mt-2 block text-[15px] text-[#3e3760]">Effective-dated</strong></div><div className="rounded-xl border border-[#ece7f8] bg-[#faf8ff] p-4"><p className="text-[10px] text-[#978cae]">Organization scope</p><strong className="mt-2 block text-[15px] text-[#3e3760]">Role-based</strong></div></div>
      <div className="mt-4 rounded-xl border border-[#e9e7f1]">
        <p className="border-b border-[#edeaf3] px-4 py-3 text-[11px] font-semibold text-[#534c6d]">People record workflow</p>
        {[
          {icon:UserRoundCheck,label:"New hire",detail:"Identity & role setup"},
          {icon:Layers3,label:"Position change",detail:"Review effective date"},
          {icon:FileCheck2,label:"Payroll impact",detail:"Send for downstream review"},
        ].map((row,i)=><div key={row.label} className="flex items-center gap-3 border-b border-[#f1eef6] px-4 py-3 last:border-0"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0ebff] text-[#7658d6]"><row.icon size={15}/></span><div className="flex-1"><p className="text-[12px] font-semibold text-[#332c4c]">{row.label}</p><p className="text-[10px] text-[#877e9b]">{row.detail}</p></div><span className="text-[10px] font-semibold text-[#a099ae]">0{i+1}</span></div>)}
      </div>
      <p className="mt-3 text-[10px] text-[#91a0b3]">Concept preview; features can depend on organization setup.</p>
    </div>
  </div>;
}

export function HcmShowcase() {
  return <section id="hcm" className="scroll-mt-24 bg-[#fbfaff] py-20 sm:py-24">
    <div className="mx-auto grid max-w-[1240px] items-center gap-11 px-5 sm:px-8 lg:grid-cols-[.86fr_1.14fr]">
      <div><SectionTitle label="Human capital management" title="People records that connect to real workforce decisions." description="Manage employee information, organizational assignments and lifecycle events with the context needed by scheduling and payroll."/>
        <FeatureList items={["Employee profiles and scoped organizational access","Onboarding, separation and employment lifecycle workflows","Job architecture, positions and workforce planning foundations","Audit trails for workforce changes that may affect payroll"]}/>
        <Link href="/hcm" className="mt-8 inline-flex items-center gap-2 text-[14px] font-bold text-[#1668ec] hover:underline">Explore HCM <ArrowRight size={16}/></Link>
      </div>
      <HcmPreview/>
    </div>
  </section>;
}

export function OutsourcingPreview() {
  return <div className={panel+" p-5 sm:p-7"}>
    <div className="flex items-center justify-between gap-3"><p className="text-[12px] font-bold text-[#1d3047]">A clear handoff, every cycle</p><span className="rounded-full bg-[#fff3e4] px-3 py-1 text-[10px] font-semibold text-[#a46d25]">Process illustration</span></div>
    <div className="mt-5 space-y-3">
      {[
        {step:"01",t:"Approved inputs",by:"Your team",tone:"bg-[#e9f2ff] text-[#3569a1]"},
        {step:"02",t:"Calculate & validate",by:"Payroll processing",tone:"bg-[#fff3e4] text-[#a46d25]"},
        {step:"03",t:"Resolve exceptions",by:"Shared review",tone:"bg-[#f0ebff] text-[#7051ba]"},
        {step:"04",t:"Authorize release",by:"Your approver",tone:"bg-[#e5f8ed] text-[#18805c]"},
      ].map(row=><div key={row.step} className="flex items-center gap-3 rounded-xl border border-[#e9edf4] bg-white p-3"><span className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold "+row.tone}>{row.step}</span><div className="flex-1"><p className="text-[13px] font-semibold text-[#24364b]">{row.t}</p><p className="text-[10px] text-[#8290a2]">{row.by}</p></div><ChevronRight size={15} className="text-[#a4afbc]"/></div>)}
    </div>
    <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[#f7f9fd] p-3.5 text-[11px] leading-relaxed text-[#5e7085]"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#4274af]"/> Outsourcing processing does not transfer employer obligations or your company&apos;s release approval.</div>
  </div>;
}

export function OutsourcingShowcase() {
  return <section id="outsourcing" className="scroll-mt-24 py-20 sm:py-24">
    <div className="mx-auto grid max-w-[1240px] items-center gap-11 px-5 sm:px-8 lg:grid-cols-[1.14fr_.86fr]">
      <div className="lg:order-1"><OutsourcingPreview/></div>
      <div className="lg:order-2"><SectionTitle label="Managed payroll service" title="Prefer to hand off payroll processing, not your control?" description="Linaw's payroll outsourcing workflow is built around input validation, visible exceptions and review before authorized release. Scope and delivery are agreed during consultation."/>
        <FeatureList items={["Approved inputs with clear responsibility","Payroll calculations and exception lists","Payslips, reports and supported export outputs","Authorized client approval remains required"]}/>
        <Link href="/payroll-outsourcing" className="mt-8 inline-flex items-center gap-2 text-[14px] font-bold text-[#1668ec] hover:underline">See payroll outsourcing <ArrowRight size={16}/></Link>
      </div>
    </div>
  </section>;
}

export function PhilippineCompliance() {
  const items=[
    {icon:ShieldCheck,title:"SSS",copy:"Employee and employer contributions, MSC and MPF/WISP context.",tone:"bg-[#e5efff] text-[#1767c6]"},
    {icon:Users,title:"PhilHealth",copy:"Premium calculations, employee/employer allocation and boundaries.",tone:"bg-[#e7f8ed] text-[#11855c]"},
    {icon:Landmark,title:"Pag-IBIG",copy:"Contribution calculations and supported remittance worksheets.",tone:"bg-[#fff4e6] text-[#b37325]"},
    {icon:FileText,title:"BIR",copy:"TRAIN withholding calculations and payroll reporting data.",tone:"bg-[#f0ebff] text-[#7358c9]"},
  ];
  return <section id="compliance" className="scroll-mt-24 border-y border-[#e6edf5] bg-[linear-gradient(115deg,#f2f7ff_0%,#ffffff_55%,#f6fbf7_100%)] py-20 sm:py-24">
    <div className="mx-auto grid max-w-[1240px] gap-10 px-5 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
      <div><SectionTitle label="Built for Philippine payroll" title="Local payroll rules deserve visible calculations." description="Review statutory figures alongside attendance, leave, bonuses and adjustments instead of trusting an unexplained final amount."/>
        <p className="mt-5 rounded-xl border border-[#d9e6f4] bg-white/90 p-4 text-[12px] leading-[1.7] text-[#63758d]">Agency forms, filing acceptance and remittance depend on the relevant official processes and external validation. Linaw does not represent calculation support as government certification or successful remittance.</p>
        <Link href="/compliance" className="mt-6 inline-flex items-center gap-2 text-[14px] font-bold text-[#1668ec]">See compliance workflows <ArrowRight size={16}/></Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{items.map(item=><article key={item.title} className="rounded-[22px] border border-[#e6ebf3] bg-white/95 p-5 shadow-[0_14px_40px_-35px_rgba(36,70,125,.3)]"><span className={"flex h-11 w-11 items-center justify-center rounded-xl "+item.tone}><item.icon size={19}/></span><h3 className="mt-5 text-[17px] font-bold text-[#1d3047]">{item.title}</h3><p className="mt-2 text-[13px] leading-[1.65] text-[#65768c]">{item.copy}</p></article>)}</div>
    </div>
  </section>;
}

export function PlatformFinalCTA() {
  return <section id="cta" className="scroll-mt-24 px-5 py-20 sm:px-8"><div className="relative mx-auto max-w-[1240px] overflow-hidden rounded-[32px] border border-[#dce8f6] bg-[linear-gradient(105deg,#eff6ff,#eef8f2_75%,#f8fbff)] px-7 py-14 sm:px-14 sm:py-16">
    <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 h-96 w-96 rounded-full bg-[#bcd9ff]/40 blur-[55px]"/>
    <div className="relative grid items-center gap-7 lg:grid-cols-[1fr_auto]">
      <div><p className={smallLabel}>A clearer next payroll</p><h2 className="font-display mt-3 max-w-[700px] text-[33px] font-semibold tracking-[-.04em] text-[#14253b] sm:text-[48px]">See how Linaw fits your team.</h2><p className="mt-4 max-w-[610px] text-[15px] leading-[1.7] text-[#5c6c81]">Explore the sample workspace or talk through payroll, WFM, HCM and managed service requirements with us.</p></div>
      <div className="flex flex-wrap gap-3"><Link href="/book-demo" style={{ color: "#ffffff", backgroundColor: "#14273e" }} className="inline-flex items-center gap-2 rounded-xl bg-[#14273e] px-6 py-4 text-[13px] font-bold text-white">Request a demo <ArrowRight size={15}/></Link><Link href="/demo" className="inline-flex items-center gap-2 rounded-xl border border-[#cbd9e9] bg-white px-6 py-4 text-[13px] font-bold text-[#203854]">Explore sample workspace</Link></div>
    </div>
  </div></section>;
}
