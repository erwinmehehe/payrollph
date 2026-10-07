import type { Metadata } from "next";
import { SolutionLanding } from "@/components/marketing/solution-pages";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Human Capital Management Philippines | Linaw HCM",
  description: "Philippine HCM software foundations for employee records, effective-dated changes, onboarding, positions and payroll-connected workforce management.",
  alternates: { canonical: "/hcm" },
  openGraph: {title:"Human Capital Management Philippines | Linaw HCM",description:"Employee lifecycle, position records and organizational changes connected to payroll.",url:"/hcm"},
};

export default function HcmPage(){
 return <>
  <StructuredData breadcrumbs={[{name:"Home",path:"/"},{name:"Human Capital Management",path:"/hcm"}]} service={{name:"Human Capital Management Philippines",description:"Employee lifecycle, workforce records, positions and organization management connected to payroll.",path:"/hcm"}}/>
  <SolutionLanding
    variant="hcm"
    eyebrow="Human capital management · Philippines"
    title="Know your people."
    accent="Keep every change connected."
    introduction="Bring employee records, positions, organizational assignments and lifecycle events into a structured system that feeds workforce operations and payroll review."
    primaryHref="/book-demo"
    primaryLabel="Explore Linaw HCM"
    secondaryHref="/hris"
    secondaryLabel="See HRIS capabilities"
    points={["Employee records with scoped access","Onboarding and offboarding workflows","Effective-dated employment changes","Position and headcount foundations"]}
    cards={[
      {title:"One payroll-ready worker record",description:"Connect worker identity, role, pay configuration, worksite and reporting structure to their downstream operational use."},
      {title:"Employment lifecycle with history",description:"Track hires, moves, pay changes, separations and other employment decisions without silently rewriting a prior payroll."},
      {title:"Positions and workforce structure",description:"Maintain job architecture, organization positions and assignments with a foundation for workforce planning."},
      {title:"Permissions and accountability",description:"Apply tenant and role scope to sensitive workforce information and retain evidence of important changes."},
    ]}
    steps={[
      {title:"Record the decision",description:"Create or revise an employee, assignment or position with an effective date."},
      {title:"Review downstream impact",description:"Identify changes affecting schedules, permissions, payroll inputs or employee status."},
      {title:"Preserve the evidence",description:"Keep auditable context for authorized users and historical payroll reviews."},
    ]}
    footnote="Linaw is prioritizing payroll-connected HCM foundations. Advanced planning, compensation and enterprise controls may have implementation or readiness dependencies."
  />
 </>;
}
