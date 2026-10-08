import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
export const metadata: Metadata = {"title":"Workforce Management Philippines | Coverage & Scheduling | Linaw","description":"Plan staffing coverage, review employee eligibility and overtime budgets, and connect schedules with attendance and payroll.","alternates":{"canonical":"/workforce-management"}};
export default function Page() { return <SeoLandingPage simulationArea={"workforce"}
eyebrow={"Workforce Management"}
title={"Plan the coverage. See the gaps. Review the trade-offs."}
intro={"Start with the work your team needs to cover. Review staffing demand, schedules, leave and employee eligibility before assigning shifts, then compare planned time with attendance."}
proof={["Staffing requirements and coverage gaps","Schedule and worksite eligibility checks","Overtime budget controls"]}
sections={[{"title":"01 / Define the coverage your operation needs","body":"Review staffing requirements and role demand by worksite before assigning people. Use scenario snapshots to compare a proposed staffing plan.","bullets":["Identify shortages and open shifts","Review job-profile demand","Keep staffing proposals available for review"]},{"title":"02 / Check who can cover the shift","body":"Use employee skills, credentials, worksite authorization and leave intervals as context for eligibility. A free slot is not enough to decide who should work.","bullets":["Review skill and credential requirements","Consider leave and worksite authorization","Check overtime budgets before authorization"]},{"title":"03 / Connect the roster to actual time","body":"Review attendance exceptions against the schedule before payroll preparation. Keep schedule planning separate from correcting the time an employee actually recorded.","bullets":["Plan rotations and roster assignments","Review rest-day context","Hand attendance exceptions to the payroll workflow"]}]}
related={[{"label":"Time & attendance","href":"/time-and-attendance","description":"Review punches, recorded hours and exceptions."},{"label":"HCM","href":"/hcm","description":"Maintain employment changes and capabilities."}]}
ctaTitle={"Bring a difficult staffing week."}
ctaBody={"Review coverage, eligibility and overtime trade-offs for your operating model."} />; }
