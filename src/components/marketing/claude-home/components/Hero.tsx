import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck, Clock3, ShieldCheck, Users } from "lucide-react";

export default function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden border-b border-[#e9edf5] bg-[#fcfdff] pt-28 sm:pt-32 lg:pt-36">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_77%_24%,#dcecff_0%,transparent_43%),radial-gradient(ellipse_at_8%_72%,#eaf9f0_0%,transparent_37%)]" />
      <div className="mx-auto grid max-w-[1260px] items-center gap-12 px-5 pb-20 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:gap-8 lg:pb-24">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#dfe8f5] bg-white/90 px-3.5 py-2 text-[12px] font-semibold text-[#405472] shadow-sm">
            <span className="h-2 w-2 rounded-full bg-[#1784ff]" aria-hidden="true" />
            Philippine payroll & workforce platform
          </div>
          <h1 className="font-display mt-7 max-w-[640px] text-balance text-[46px] font-semibold leading-[1.055] tracking-[-.048em] text-[#10182a] sm:text-[64px] lg:text-[69px]">
            People, payroll and compliance <span className="text-[#1668ec]">made clear.</span>
          </h1>
          <p className="mt-6 max-w-[535px] text-[17px] leading-[1.8] text-[#536278] sm:text-[18px]">
            From schedules and employee records to payroll review and payslips, Linaw brings the work together in one connected Philippine platform.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/book-demo" style={{ color: "#ffffff", backgroundColor: "#10243d" }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#10243d] px-6 py-3.5 text-[14px] font-semibold text-white shadow-[0_14px_25px_-14px_rgba(16,36,61,.45)] transition-transform hover:-translate-y-0.5">
              Request a demo <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#d9e1eb] bg-white px-6 py-3.5 text-[14px] font-semibold text-[#15253d] transition-colors hover:bg-[#f1f6ff]">
              Explore sample workspace <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-10 grid max-w-[520px] gap-4 border-t border-[#e4eaf2] pt-6 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, heading: "Philippine-focused", copy: "SSS, PhilHealth, Pag-IBIG & BIR workflows" },
              { icon: Users, heading: "Built for teams", copy: "Distinct employee and approval roles" },
              { icon: Clock3, heading: "Payroll-connected", copy: "Attendance, schedules and leave inputs" },
            ].map((item) => (
              <div key={item.heading} className="flex items-start gap-2.5 sm:block">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#e8f1ff] text-[#1668ec] sm:mb-2">
                  <item.icon size={16} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[12px] font-bold text-[#17263c]">{item.heading}</p>
                  <p className="mt-1 text-[11px] leading-[1.5] text-[#64748b]">{item.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 lg:pl-3">
          <div aria-hidden="true" className="absolute -inset-5 rounded-[42px] bg-[#a6caff]/20 blur-3xl" />
          <div data-testid="payroll-hero-preview" className="relative overflow-hidden rounded-[27px] border border-white bg-white shadow-[0_40px_100px_-40px_rgba(37,75,132,.32),0_5px_30px_-13px_rgba(31,58,89,.17)]">
            <div className="flex items-center justify-between border-b border-[#e9edf4] bg-white px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2 text-[12px] font-bold text-[#1a2b47]">
                <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#e9f2ff] text-[#1769ea]"><ShieldCheck size={15} aria-hidden="true" /></span>
                Linaw workspace
              </div>
              <span className="rounded-full bg-[#f2f6fc] px-2.5 py-1 text-[10px] font-semibold text-[#68788d]">Illustrative · sample data</span>
            </div>
            <div className="grid grid-cols-[70px_minmax(0,1fr)] sm:grid-cols-[112px_minmax(0,1fr)]">
              <aside className="border-r border-[#edf0f6] bg-[#f9fbfe] px-2 py-5 sm:px-3" aria-label="Illustrative workspace navigation">
                {["Home","Payroll","People","Time","Reports"].map((name, i) => (
                  <div key={name} className={i===0 ? "mb-2 rounded-lg bg-[#e6f0ff] px-2 py-2.5 text-[10px] font-bold text-[#1868e8] sm:text-[11px]" : "mb-2 rounded-lg px-2 py-2.5 text-[10px] font-medium text-[#8792a6] sm:text-[11px]"}>
                    {name}
                  </div>
                ))}
              </aside>
              <div className="min-w-0 bg-[#fff] p-3 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-medium text-[#8994a7]">Payroll overview</p>
                    <h2 className="mt-1 text-[17px] font-bold tracking-tight text-[#18263c] sm:text-[20px]">Ready for the next step.</h2>
                  </div>
                  <span className="rounded-full bg-[#e9f8f1] px-2.5 py-1 text-[10px] font-semibold text-[#0b8556]">Sample run</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    {label:"Sample net pay",value:"₱412,800",color:"text-[#1769ea]"},
                    {label:"Employee records",value:"48",color:"text-[#192943]"},
                    {label:"Review items",value:"2",color:"text-[#be7230]"},
                  ].map((m)=>(
                    <div key={m.label} className="rounded-xl border border-[#e8eef6] bg-[#fafcff] p-3">
                      <p className="text-[9px] text-[#8b98aa]">{m.label}</p>
                      <p className={"mt-1 text-[16px] font-bold tabular-nums sm:text-[18px] "+m.color}>{m.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-[#e9edf5] p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[11px] text-[#253954] sm:text-[12px]">Payroll handoff</strong>
                    <span className="text-[9px] font-medium text-[#8794a6]">Example workflow</span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {[
                      {n:"1",t:"Inputs",done:true},
                      {n:"2",t:"Calculate",done:true},
                      {n:"3",t:"Review",done:false},
                      {n:"4",t:"Release",done:false},
                    ].map((step)=>(
                      <div key={step.n} className="min-w-0 text-center">
                        <span className={step.done?"mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-[#1769ea] text-[11px] font-bold text-white":"mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-[#edf2f8] text-[11px] font-bold text-[#6b7a8f]"}>{step.done?<CheckCircle2 size={14} />:step.n}</span>
                        <p className="mt-2 truncate text-[9px] font-semibold text-[#5e6e84]">{step.t}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-[#e9edf5] p-3 sm:p-4">
                  <p className="mb-3 text-[11px] font-semibold text-[#253954]">Items to resolve</p>
                  <div className="flex items-center gap-2 border-b border-[#f0f2f6] pb-2.5 text-[10px] text-[#58677c]"><span className="h-2 w-2 rounded-full bg-amber-400" /> Attendance exception <span className="ml-auto text-[#8d9aab]">Review</span></div>
                  <div className="flex items-center gap-2 pt-2.5 text-[10px] text-[#58677c]"><span className="h-2 w-2 rounded-full bg-amber-400" /> Overtime change <span className="ml-auto text-[#8d9aab]">Review</span></div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#eef5ff] px-3 py-3">
                  <span className="flex items-center gap-2 text-[10px] font-semibold text-[#265a9d]"><ClipboardCheck size={14} aria-hidden="true" /> Maker → Checker → Owner</span>
                  <span className="text-[9px] font-bold text-[#1668ec]">Review before release</span>
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-[#7b8aa2]">Conceptual product interface; not a live payroll result or compliance certification.</p>
        </div>
      </div>
    </section>
  );
}
