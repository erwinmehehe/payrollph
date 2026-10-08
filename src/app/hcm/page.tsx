import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
export const metadata: Metadata = {title: "HCM Software Philippines | Employee Lifecycle | Linaw",description: "Manage onboarding, effective-dated employment changes, compensation and performance responsibilities connected to payroll.",alternates: {canonical: "/hcm"}};
export default function Page() { return <SeoLandingPage simulationArea={"hcm"}
eyebrow={"Human Capital Management"}
title={"Every employee change has a next step."}
intro={"Give HR and managers a shared path from onboarding to employment changes, compensation reviews and performance. Keep decisions connected to the employee record and the payroll work that follows."}
proof={["Onboarding tasks with clear owners","Governed, effective-dated employment changes","Compensation and performance workflows"]}
sections={[{title: "01 / Prepare a new joiner for their first payroll","body":"Assign onboarding tasks, prepare employee records and follow outstanding responsibilities before the first cutoff.","bullets":["Track task ownership and completion","Connect the employee record to payroll setup","Review missing information before the cycle starts"]},{title: "02 / Review a promotion or transfer before it takes effect","body":"Record the proposed employment change, effective date and approval decision. Scheduled changes should not silently replace today’s employee details.","bullets":["Review changes through maker-checker decisions","Preserve employment history","Connect approved changes to downstream administration"]},{title: "03 / Make compensation and performance decisions reviewable","body":"Use compensation review proposals, employee goals and formal review cycles to give managers a documented basis for decisions.","bullets":["Review pay changes against configured bands","Track goals and manager assessments","Keep decisions and responsibilities visible"]}]}
related={[{"label":"HRIS","href":"/hris",description: "Maintain the employee system of record."},{"label":"Workforce Management","href":"/workforce-management",description: "Plan coverage using employee context."}]}
ctaTitle={"Bring an employee lifecycle scenario."}
ctaBody={"Walk through a new hire, transfer or pay change with the people who own each decision."} />; }
