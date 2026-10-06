import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "Timekeeping Software Philippines | Payroll-Ready | Linaw",
  description: "Philippine timekeeping and attendance software with raw punches, schedules, overtime workflows, night differential and payroll-connected attendance processing.",
  alternates: { canonical: "/time-and-attendance" },
};

export default function TimeAttendancePage() {
  return (
    <SeoLandingPage
      eyebrow="Timekeeping system Philippines"
      title="Time and attendance that payroll can actually use."
      intro="Linaw connects raw punches, work schedules, overtime, night differential, rest days and attendance exceptions directly to payroll calculation."
      proof={[
        "Raw punch processing for hours, tardiness, undertime and overtime",
        "Night differential calculation",
        "Effective-dated employee rest days",
        "Workforce scheduling and schedule swaps",
        "Overtime request and approval workflows",
        "Biometric synchronization endpoint for device integrations",
      ]}
      sections={[
        {
          title: "Convert clock data into payroll inputs",
          body: "Raw time punches are interpreted into payroll-relevant hours and exceptions instead of requiring payroll staff to manually rebuild attendance every cutoff.",
          bullets: ["Regular hours", "Tardiness and undertime", "Overtime", "Night differential", "Incomplete-punch exception handling"],
        },
        {
          title: "Handle real schedules instead of one universal shift",
          body: "The data model includes workforce scheduling, employee rest days and effective-dated revisions so historical payroll does not have to assume today's schedule always applied.",
        },
        {
          title: "Route overtime through an approval process",
          body: "Overtime is represented as an enterprise workflow with actor IDs and approval controls rather than only as a manual payroll adjustment.",
        },
        {
          title: "Use attendance context in premium-pay calculations",
          body: "Payroll calculation combines worked time with configured rest days, holidays, overtime and night differential. Claims about government filing remain separate from calculation capability.",
        },
      ]}
      related={[
        { label: "Payroll software", href: "/", description: "See how attendance becomes a traceable payroll run." },
        { label: "BPO payroll", href: "/industries/bpo", description: "Explore shift-heavy payroll requirements for Philippine BPO teams." },
        { label: "Compliance", href: "/compliance", description: "See how statutory and payroll-rule evidence is handled." },
      ]}
    />
  );
}
