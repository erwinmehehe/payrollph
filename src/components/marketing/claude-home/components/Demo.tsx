import { ArrowRight, CheckCircle2, Database, ShieldCheck } from "lucide-react";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import { Reveal, SectionHeading } from "./ui";

export default function Demo() {
  return (
    <section id="demo" className="system-demo-section scroll-mt-20 bg-[#F7F8FC] py-16 sm:py-20">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
          <SectionHeading
            title={<>Explore the <span className="text-[#6161FF]">actual Linaw workspace.</span></>}
            description="This homepage preview now uses the same navigation contract, sample payroll data and workspace interactions as the product instead of a separate marketing-only payroll mockup."
          />

          <Reveal delay={100}>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <span className="system-demo-proof">
                <CheckCircle2 aria-hidden />
                Same workspace navigation
              </span>
              <span className="system-demo-proof">
                <Database aria-hidden />
                Populated sample payroll
              </span>
              <span className="system-demo-proof">
                <ShieldCheck aria-hidden />
                Nothing saved here
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal delay={130}>
          <div className="system-demo-stage mt-8">
            <div className="system-demo-toolbar">
              <div>
                <span className="system-demo-kicker">Interactive product preview</span>
                <strong>Masigla Foods · Linaw workspace</strong>
              </div>
              <a href="/demo" className="system-demo-open">
                Open role-based sandbox
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>

            <div className="system-demo-product">
              <WorkspacePreview mode="interactive" />
            </div>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <div className="system-demo-foot">
            <p>
              Use the preview to explore modules locally. The role-based sandbox opens the real product shell with Owner,
              HR Admin, Payroll Officer, Checker and Employee permissions enforced by the server.
            </p>
            <a href="/demo">
              Choose a role
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
