import { ArrowRight, CheckCircle2, Database, ShieldCheck } from "lucide-react";
import { ProductSimulation } from "@/components/marketing/product-simulation";
import { Reveal, SectionHeading } from "./ui";

export default function Demo() {
  return (
    <section id="demo" className="system-demo-section scroll-mt-20 bg-[#F7F8FC] py-16 sm:py-20">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="grid gap-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
          <SectionHeading
            title={<>See how payroll moves from <span className="text-[#0877ff]">preparation to approval.</span></>}
            description="Explore a populated sample workspace, then open the role-based sandbox to see what the Payroll Officer, Checker, Owner and Employee each need to do next."
          />

          <Reveal delay={100}>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <span className="system-demo-proof">
                <CheckCircle2 aria-hidden />
                Real product navigation
              </span>
              <span className="system-demo-proof">
                <Database aria-hidden />
                Sample payroll already loaded
              </span>
              <span className="system-demo-proof">
                <ShieldCheck aria-hidden />
                Safe to explore
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal delay={130}>
          <div className="system-demo-stage mt-8">
            <div className="system-demo-toolbar">
              <div>
                <span className="system-demo-kicker">Interactive payroll workflow</span>
                <strong>Masigla Foods · Linaw workspace</strong>
              </div>
              <a href="/demo" className="system-demo-open">
                Open role-based sandbox
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>

            <div className="system-demo-product">
              <ProductSimulation area="payroll" />
            </div>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <div className="system-demo-foot">
            <p>
              Explore the sample workspace here, then switch into the full sandbox to see how preparation, checking,
              release and employee self-service hand off between roles.
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
