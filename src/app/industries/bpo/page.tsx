import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";

export const metadata: Metadata = {
  title: "BPO Payroll Software Philippines | Shifts & Night Differential | Linaw",
  description: "Payroll software for Philippine BPO teams with workforce schedules, night differential, overtime, rest days, attendance processing, approvals and employee payslips.",
  alternates: { canonical: "/industries/bpo" },
};

export default function BpoPayrollPage() {
  return (
    <SeoLandingPage
      eyebrow="BPO payroll software Philippines"
      title="Payroll for shift-heavy Philippine BPO operations."
      intro="BPO payroll gets difficult when schedules, night work, overtime, rest days, attendance exceptions and approval handoffs collide. Linaw already models those operating conditions directly."
      proof={[
        "Night differential computation",
        "Overtime and premium-pay logic",
        "Workforce scheduling and schedule swaps",
        "Effective-dated rest days",
        "Attendance exception handling",
        "Maker-checker payroll release controls",
      ]}
      sections={[
        {
          title: "Handle night work as part of payroll logic",
          body: "Night differential is calculated from worked time and can combine with overtime and day-specific premium rules instead of being treated as a manual flat adjustment.",
        },
        {
          title: "Keep schedule changes from rewriting payroll history",
          body: "Employee rest days are effective-dated, and workforce scheduling has its own data model, helping historical calculations use the schedule that was in force for the work date.",
        },
        {
          title: "Route payroll through explicit review roles",
          body: "Payroll processing, checker review and owner release are separate operating steps so one user does not need to own every critical action.",
        },
        {
          title: "Give employees direct access after release",
          body: "Employee self-service exposes personal payslips and year-to-date payroll figures without opening other employees' data.",
        },
      ]}
      lastReviewed="October 5, 2026"
      faq={[
        { question: "What makes BPO payroll difficult in the Philippines?", answer: "Round-the-clock schedules, night differential, overtime, rest days, attendance exceptions and frequent schedule changes make worked-time context central to payroll accuracy." },
        { question: "Can night differential and overtime apply to the same shift?", answer: "Yes. A night shift can also contain overtime, so payroll should preserve both the applicable day premium and the night-differential component instead of flattening everything into one allowance." },
        { question: "Why should rest days be effective-dated?", answer: "When rest-day assignments change, historical payroll should still use the schedule that applied on the original work date rather than today's assignment." },
        { question: "Should payroll preparation and release be separate roles?", answer: "Separating preparation, checker review and final release creates a stronger control model for high-volume payroll operations." },
      ]}
      related={[
        { label: "Time & attendance", href: "/time-and-attendance", description: "Explore schedules, punches, overtime and attendance exceptions." },
        { label: "Employee self-service", href: "/employee-self-service", description: "See the payroll portal employees can use after release." },
        { label: "Payroll software", href: "/", description: "Review the full Philippine payroll workflow." },
      ]}
    />
  );
}
