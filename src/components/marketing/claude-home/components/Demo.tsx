import { ArrowRight, CheckCircle2, Lock, Play, ShieldCheck } from "lucide-react";
import { WorkspacePreview } from "../../workspace-preview";
import { Reveal, SectionHeading } from "./ui";

export default function Demo() {
  return (
    <section id="demo" className="scroll-mt-20 overflow-hidden bg-[#11141F] py-20 text-white sm:py-28">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.7fr]">
          <div className="[&_h2]:!text-white [&_p]:!text-white/65"><SectionHeading
            title={<>A payroll demo you can actually use.</>}
            description="Open the real Linaw simulation, move through payroll, approvals, people and exports, and see how the handoff behaves before you create an account."
          /></div>
          <Reveal delay={100}>
            <div className="grid gap-2 text-[13px] text-white/70 sm:grid-cols-3 lg:grid-cols-1">
              {[
                ["Playable", "The controls actually respond"],
                ["Safe", "Demo writes nothing to production"],
                ["Role-aware", "Owner, HR, Payroll, Checker and Employee"],
              ].map(([title, copy]) => (
                <div key={title} className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.06] p-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#00CA72]" aria-hidden />
                  <span><strong className="block text-white">{title}</strong>{copy}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={140} className="mt-10">
          <div className="overflow-hidden rounded-[26px] border border-white/10 bg-white shadow-[0_35px_100px_-35px_rgba(97,97,255,.55)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8EAF3] bg-[#FAFBFD] px-4 py-3 text-[#0B0D1A] sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#11141F]">
                  <Play className="h-3.5 w-3.5 fill-white text-white" aria-hidden />
                </span>
                <div>
                  <strong className="block text-[12.5px]">Linaw live workspace</strong>
                  <span className="block text-[10.5px] text-[#7C82A1]">Interactive public sandbox</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] font-bold text-[#5B6080]">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#E3FAF0] px-2.5 py-1 text-[#0A8A53]">
                  <ShieldCheck className="h-3 w-3" aria-hidden /> isolated
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#F1F2F8] px-2.5 py-1">
                  <Lock className="h-3 w-3" aria-hidden /> no writes
                </span>
              </div>
            </div>
            <div className="bg-[#F7F8FC] p-2 sm:p-3">
              <div className="overflow-hidden rounded-[18px] border border-[#E2E4F0] bg-white">
                <WorkspacePreview mode="interactive" />
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={180}>
          <div className="mt-7 flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-4 text-center sm:flex-row sm:text-left">
            <div>
              <p className="text-[13.5px] font-bold">Want the full role-based walkthrough?</p>
              <p className="mt-0.5 text-[12.5px] text-white/55">Open the dedicated demo and switch between every payroll role.</p>
            </div>
            <a href="/demo" className="group inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-[#11141F]">
              Open full sandbox <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
