import type { Metadata } from "next";
import { SolutionLanding } from "@/components/marketing/solution-pages";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Workforce Management Software Philippines | Linaw",
  description: "Workforce management software for Philippine teams: scheduling, attendance, overtime reviews, shift context and payroll-connected workforce records.",
  alternates: { canonical: "/workforce-management" },
  openGraph: {title:"Workforce Management Software Philippines | Linaw",description:"Schedules, attendance, overtime and work context connected to Philippine payroll.",url:"/workforce-management"},
};

export default function WorkforceManagementPage(){
 return <>
  <StructuredData breadcrumbs={[{name:"Home",path:"/"},{name:"Workforce Management",path:"/workforce-management"}]} service={{name:"Workforce Management Software Philippines",description:"Scheduling, timekeeping, attendance exception and overtime workflows connected to Philippine payroll.",path:"/workforce-management"}}/>
  <SolutionLanding
    variant="wfm"
    eyebrow="Workforce management for Philippine teams"
    title="From shifts to payroll,"
    accent="without the blind spots."
    introduction="Build schedules, track attendance and route exceptions to the right person before reviewed time becomes a payroll input. Handle shift-heavy teams without treating every day like a standard nine-to-five."
    primaryHref="/book-demo"
    primaryLabel="See a WFM demo"
    secondaryHref="/time-and-attendance"
    secondaryLabel="Explore timekeeping"
    points={["Work schedules and effective-dated rest days","Attendance exceptions and raw punch review","Overtime authorization and review","Holiday, night and overtime pay context"]}
    cards={[
      {title:"Schedules that match real operations",description:"Plan shifts, assignments and effective-dated work arrangements across teams that operate during nights, holidays and weekends."},
      {title:"Attendance that can be explained",description:"Review clock inputs, missing punches, tardiness, undertime and schedule mismatches before they enter payroll."},
      {title:"Overtime with an audit trail",description:"Review authorization separately from the statutory entitlement for work actually performed. Exceptions remain visible to payroll."},
      {title:"A clearer handoff to payroll",description:"Preserve rest days, holidays and worksite context so approved time records reach payroll with the right calculation inputs."},
    ]}
    steps={[
      {title:"Assign the work",description:"Create team schedules and employee rest-day context for the period."},
      {title:"Review actual time",description:"Compare clock data to scheduled work and surface missing or conflicting evidence."},
      {title:"Prepare payroll inputs",description:"Carry reviewed hours, exceptions and premium-pay context into payroll calculation."},
    ]}
    footnote="Feature availability and supported biometric integrations vary by configuration. Statutory entitlement is not conditional on a manager approving worked overtime."
  />
 </>;
}
