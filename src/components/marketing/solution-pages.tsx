import Link from "next/link";
import { ArrowRight, Check, ChevronRight, CircleHelp, ShieldCheck } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/marketing/site-chrome";
import { HcmPreview, OutsourcingPreview, WfmPreview } from "@/components/marketing/claude-home/components/PlatformSections";
import { PayrollQuoteForm } from "@/components/marketing/payroll-quote-form";

type PageProps = {
  eyebrow:string; title:string; accent:string; introduction:string; primaryHref:string; primaryLabel:string;
  secondaryHref:string; secondaryLabel:string; points:string[]; cards:{title:string,description:string}[];
  steps:{title:string,description:string}[]; footnote:string; variant:"wfm"|"hcm";
};

const highlights = "flex items-start gap-2.5 text-[13px] leading-[1.7] text-[#50627c]";
function MarketingHero({eyebrow,title,accent,introduction,primaryHref,primaryLabel,secondaryHref,secondaryLabel,points,variant}:PageProps) {
  return <section className="relative isolate overflow-hidden border-b border-[#e8edf5] bg-[linear-gradient(110deg,#fcfdff_0%,#f2f8ff_55%,#fafcff_100%)] pt-16 pb-18 sm:py-24">
    <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[.9fr_1.1fr]">
      <div>
        <div className="inline-flex rounded-full border border-[#dce8f4] bg-white px-4 py-2 text-[11px] font-bold tracking-wide text-[#3270ba]">{eyebrow}</div>
        <h1 className="font-display mt-6 text-balance text-[44px] font-semibold leading-[1.09] tracking-[-.045em] text-[#14243a] sm:text-[60px]">{title} <span className="text-[#1769e9]">{accent}</span></h1>
        <p className="mt-6 max-w-[570px] text-[16px] leading-[1.8] text-[#596d82]">{introduction}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={primaryHref} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#142941] px-6 py-3 text-[13px] font-semibold text-white">{primaryLabel}<ArrowRight size={16}/></Link>
          <Link href={secondaryHref} className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[#d7e2ec] bg-white px-6 py-3 text-[13px] font-semibold text-[#284057]">{secondaryLabel}<ChevronRight size={16}/></Link>
        </div>
        <ul className="mt-9 grid gap-3 sm:grid-cols-2">{points.map(t=><li key={t} className={highlights}><Check size={16} className="mt-1 shrink-0 text-[#148c66]"/>{t}</li>)}</ul>
      </div>
      <div>{variant==="wfm"?<WfmPreview/>:<HcmPreview/>}</div>
    </div>
  </section>;
}

export function SolutionLanding(props:PageProps) {
  return <div className="min-h-screen bg-white font-sans text-[#14243a]"><SiteNav/><main>
    <MarketingHero {...props}/>
    <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#3473b9]">Built into the operating flow</p>
      <h2 className="font-display mt-3 max-w-[780px] text-balance text-[34px] font-semibold tracking-[-.035em] sm:text-[46px]">Detailed workflows, not another disconnected dashboard.</h2>
      <div className="mt-9 grid gap-4 md:grid-cols-2">{props.cards.map((c,i)=><article key={c.title} className="rounded-[24px] border border-[#e5ebf3] bg-[#fbfcff] p-7"><span className="text-[11px] font-bold text-[#3875bc]">0{i+1}</span><h3 className="mt-4 text-[19px] font-semibold text-[#1d3046]">{c.title}</h3><p className="mt-3 text-[14px] leading-[1.75] text-[#607289]">{c.description}</p></article>)}</div>
    </section>
    <section className="border-y border-[#e8eef6] bg-[#f6f9fe] py-20 sm:py-24"><div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <p className="text-[11px] font-bold uppercase tracking-[.15em] text-[#3372b7]">Connected to payroll</p>
      <h2 className="font-display mt-3 text-balance text-[34px] font-semibold tracking-[-.035em] sm:text-[44px]">From the original change to its payroll impact.</h2>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{props.steps.map((s,i)=><div key={s.title} className="rounded-[22px] border border-[#e1eaf3] bg-white p-6"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e9f2ff] text-[13px] font-bold text-[#1766ce]">{i+1}</span><h3 className="mt-5 text-[18px] font-semibold">{s.title}</h3><p className="mt-3 text-[13px] leading-[1.7] text-[#65758b]">{s.description}</p></div>)}</div>
      <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-[#e0e8f1] bg-white px-5 py-4 text-[12px] leading-relaxed text-[#6b7b90]"><CircleHelp size={17} className="mt-0.5 shrink-0 text-[#4273aa]"/>{props.footnote}</div>
    </div></section>
    <section className="mx-auto grid max-w-[1240px] gap-6 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
      <div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#3473b9]">See Linaw in context</p><h2 className="font-display mt-3 text-[35px] font-semibold tracking-[-.04em]">Make your next payroll workflow clearer.</h2><p className="mt-3 max-w-[700px] text-[14px] leading-[1.75] text-[#62758b]">Review the connected feature set with sample data and discuss implementation requirements before using real employee records.</p></div>
      <Link href="/book-demo" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#142941] px-6 py-4 text-[13px] font-bold text-white">Book a demo<ArrowRight size={16}/></Link>
    </section>
  </main><SiteFooter/></div>;
}

const outsourcingSteps=[
  {title:"Send approved inputs",copy:"Your business supplies verified changes, attendance decisions and cutoff details."},
  {title:"Calculate and validate",copy:"The agreed processing scope covers computation and visible exception review."},
  {title:"Your approver decides",copy:"Approval and employer responsibilities stay with your authorized representatives."},
  {title:"Prepare agreed outputs",copy:"Payslips, reports and supported exports follow the approved payroll cycle."},
];

export function OutsourcingLanding(){
  return <div className="min-h-screen bg-white text-[#14243a]"><SiteNav/><main>
    <section className="border-b border-[#e8eef5] bg-[linear-gradient(115deg,#fafcff,#f2f7ff_55%,#fffaf4)] py-16 sm:py-24">
      <div className="mx-auto grid max-w-[1240px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[.91fr_1.09fr]">
        <div>
          <span className="inline-flex rounded-full border border-[#dce7f2] bg-white px-4 py-2 text-[11px] font-bold text-[#3774b3]">Managed payroll · Philippines</span>
          <h1 className="font-display mt-6 text-balance text-[45px] font-semibold leading-[1.08] tracking-[-.045em] sm:text-[59px]">Payroll processing handled. <span className="text-[#1769e9]">Your approvals stay yours.</span></h1>
          <p className="mt-6 max-w-[570px] text-[16px] leading-[1.8] text-[#5f7187]">Explore a managed payroll service designed around approved inputs, calculation review, clear exceptions and supported payroll outputs. Service scope is agreed with your team.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="#quote" className="inline-flex items-center gap-2 rounded-xl bg-[#142941] px-6 py-3.5 text-[13px] font-semibold text-white">Get a payroll quote<ArrowRight size={16}/></Link><Link href="/demo" className="inline-flex items-center gap-2 rounded-xl border border-[#d7e2ec] bg-white px-6 py-3.5 text-[13px] font-semibold text-[#284057]">Explore the software</Link></div>
          <p className="mt-6 text-[12px] leading-[1.7] text-[#7d8ba0]">Employer obligations, funding decisions and official filing acceptance remain separate from software or processing support.</p>
        </div><OutsourcingPreview/>
      </div>
    </section>
    <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[.14em] text-[#3473b9]">How it works</p>
      <h2 className="font-display mt-3 max-w-[740px] text-[35px] font-semibold tracking-[-.04em] sm:text-[45px]">Every payroll cutoff has a clear owner.</h2>
      <div className="mt-9 grid gap-4 md:grid-cols-4">{outsourcingSteps.map((s,i)=><article key={s.title} className="rounded-[24px] border border-[#e8edf5] bg-[#fbfcff] p-6"><span className="text-[12px] font-bold text-[#1769e9]">0{i+1}</span><h3 className="mt-5 text-[18px] font-semibold">{s.title}</h3><p className="mt-3 text-[13px] leading-[1.7] text-[#66768c]">{s.copy}</p></article>)}</div>
    </section>
    <section className="border-y border-[#e8edf5] bg-[#f8fbff] py-20 sm:py-24"><div className="mx-auto grid max-w-[1240px] gap-4 px-5 sm:px-8 lg:grid-cols-2">
      {[
        {title:"What the processing scope can cover",list:["Payroll calculations and validated registers","Exceptions and supporting review details","Payslips and agreed accounting reports","Supported bank or agency output preparation"]},
        {title:"What your organization retains",list:["Accurate, approved payroll source inputs","Employment and attendance decisions","Release approvals and payroll funding","Employer filing and remittance responsibilities"]},
      ].map(g=><article key={g.title} className="rounded-[24px] border border-[#e4eaf3] bg-white p-7"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e9f2ff] text-[#1769e9]"><ShieldCheck size={19}/></span><h3 className="mt-5 text-[22px] font-semibold">{g.title}</h3><ul className="mt-6 space-y-4">{g.list.map(t=><li key={t} className={highlights}><Check size={16} className="mt-1 shrink-0 text-[#138a63]"/>{t}</li>)}</ul></article>)}
    </div></section>
    <section id="quote" className="scroll-mt-24 border-b border-[#e8edf5] py-20 sm:py-24"><div className="mx-auto grid max-w-[1150px] items-start gap-10 px-5 sm:px-8 lg:grid-cols-[.78fr_1.22fr]">
      <div className="lg:sticky lg:top-24"><span className="text-[11px] font-bold uppercase tracking-[.14em] text-[#3473b9]">Payroll outsourcing quote</span><h2 className="font-display mt-3 text-balance text-[34px] font-semibold tracking-[-.04em] sm:text-[45px]">Tell us about your payroll cycle.</h2><p className="mt-5 text-[15px] leading-[1.75] text-[#60738a]">Share the size and complexity of your payroll. No private employee records or bank credentials are needed to request a quote.</p></div>
      <PayrollQuoteForm/>
    </div></section>
  </main><SiteFooter/></div>;
}
