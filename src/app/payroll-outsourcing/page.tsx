import type { Metadata } from "next";
import { OutsourcingLanding } from "@/components/marketing/solution-pages";
import { absolutePublicUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Payroll Outsourcing Philippines | Managed Payroll | Linaw",
  description: "Payroll outsourcing for Philippine businesses with approved inputs, payroll validation, exception review, approvals and supported payslip and reporting outputs.",
  alternates: {canonical:"/payroll-outsourcing"},
  openGraph: {title:"Payroll Outsourcing Philippines | Linaw",description:"Managed payroll processing with traceable inputs, approvals and supported outputs.",url:"/payroll-outsourcing"},
};
const outsourcingSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": absolutePublicUrl("/payroll-outsourcing#service"),
  url: absolutePublicUrl("/payroll-outsourcing"),
  name: "Linaw Payroll Outsourcing",
  serviceType: "Managed payroll processing",
  description: "Managed payroll processing workflows for Philippine businesses with reviewed inputs, payroll validation and authorized client approvals.",
  provider: {"@type":"Organization","@id":absolutePublicUrl("/#organization"),name:"Linaw",url:absolutePublicUrl("/")},
  areaServed: {"@type":"Country",name:"Philippines"},
};
export default function PayrollOutsourcingPage(){
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(outsourcingSchema).replace(/</g,"\\u003c")}}/>
    <OutsourcingLanding/>
  </>;
}
