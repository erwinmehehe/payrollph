import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Timekeeping System Philippines | Payroll Software | Linaw",
  description: "Philippine timekeeping and attendance software with raw punches, schedules, overtime workflows, night differential and payroll-connected attendance processing.",
  alternates: { canonical: "/time-and-attendance" },
};

const faq = [
  {
    question: "What attendance data can feed payroll in Linaw?",
    answer: "Linaw can use raw punches, schedules, rest-day context, overtime workflow data and night-work timing to derive payroll-relevant hours and exceptions.",
  },
  {
    question: "What happens when a clock-in or clock-out is missing?",
    answer: "Incomplete punch sequences should surface as an exception for review instead of being silently guessed into payable time.",
  },
  {
    question: "Can overtime be reviewed before payroll?",
    answer: "Yes. Overtime has an approval workflow with actor evidence, while payroll still preserves the statutory pay context for actual work performed.",
  },
  {
    question: "Can biometric attendance devices connect to Linaw?",
    answer: "The application includes a biometric synchronization endpoint for supported device or integration workflows. A device-specific connector still depends on the external system and implementation scope.",
  },
  {
    question: "Why are schedules and rest days effective-dated?",
    answer: "Historical payroll should use the work context that applied on the actual date. Effective-dated schedules prevent today's assignment from rewriting an older payroll period.",
  },
];

export default function TimeAttendancePage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Timekeeping system", path: "/time-and-attendance" }]}
        service={{
          name: "Timekeeping System Philippines",
          description: "Philippine time and attendance software connected to payroll calculations, schedules, overtime and attendance exceptions.",
          path: "/time-and-attendance",
        }}
        faq={faq}
      />
      <SeoLandingPage
      simulationArea="attendance"
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
        {
          title: "Keep attendance exceptions visible before money moves",
          body: "Missing punches, schedule mismatches and other attendance issues should be visible to payroll reviewers before release instead of disappearing inside a manually adjusted total.",
        },
      ]}
      faq={faq}
      related={[
        { label: "Payroll software", href: "/", description: "See how attendance becomes a traceable payroll run." },
        { label: "BPO payroll", href: "/industries/bpo", description: "Explore shift-heavy payroll requirements for Philippine BPO teams." },
        { label: "Compliance", href: "/compliance", description: "See how statutory and payroll-rule evidence is handled." },
      ]}
    />
    </>
  );
}
