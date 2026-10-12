import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeePayProfiles, organizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { calculateEmployeePay } from "@/lib/payroll-engine";
import { statutoryRuleVersionsForDate } from "@/lib/ph-statutory-rule-packs";
import { readJourneyProgress } from "@/lib/first-payroll-progress";
import { parseMigrationDate } from "@/lib/migration-date";

export const dynamic="force-dynamic";
/** GET is intentionally read-only: no bootstraps, audit inserts, payroll rows or ledgers. */
export async function GET(request:Request) {
 const user=await getSessionUser();if(!user)return Response.json({error:"Sign in required"},{status:401});
 const q=new URL(request.url).searchParams;
 const organizationId=Number(q.get("organizationId"));
 const periodStart=parseMigrationDate(q.get("periodStart") ?? "");
 const periodEnd=parseMigrationDate(q.get("periodEnd") ?? "");
 const payDate=parseMigrationDate(q.get("payDate") ?? "");
 if(!Number.isSafeInteger(organizationId)||organizationId<=0||!periodStart||!periodEnd||!payDate||periodStart>periodEnd||payDate<periodEnd)
  return Response.json({error:"Valid employer, period and pay date are required"},{status:400});
 const denied=await assertOrganizationRole(user.id,organizationId,PAYROLL_VIEW_ROLES,"Payroll visibility required");
 if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return Response.json({error:"Company-wide payroll access required"},{status:403});
 const [org]=await db.select().from(organizations).where(eq(organizations.id,organizationId)).limit(1);
 if(!org)return Response.json({error:"Unknown employer"},{status:404});
 const progress=await readJourneyProgress(organizationId);
 const people=await db.select().from(employees).where(and(eq(employees.organizationId,organizationId),eq(employees.status,"Active"),lte(employees.startDate,periodEnd)));
 const profiles=await db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId,organizationId));
 const byEmployee=new Map(profiles.map(p=>[p.employeeId,p]));
 const blockers:string[]=[];
 if(!progress?.reviewedByUserId)blockers.push("Attendance has not been approved by an authorized human reviewer.");
 if(!org.payrollCalendarMode)blockers.push("No payroll calendar configured.");
 if(!people.length)blockers.push("No active employees in this pay period.");
 let ruleVersions:ReturnType<typeof statutoryRuleVersionsForDate>;
 try{ruleVersions=statutoryRuleVersionsForDate(payDate);}catch{return Response.json({error:"No certified statutory rule pack for pay date"},{status:422});}
 const rows=people.map(employee=>{
  const issues:string[]=[];
  if(!employee.tin)issues.push("Missing TIN");
  if(!employee.bankAccount || !employee.bankCode)issues.push("Missing bank payout destination");
  const profile=byEmployee.get(employee.id);
  if(!profile)issues.push("Missing pay profile");
  if(String(employee.startDate)>periodEnd)issues.push("Employee begins after cutoff");
  let amounts:{gross:number;sss:number;philHealth:number;pagIbig:number;withholding:number;net:number}|null=null;
  if(profile) {
   try {
    const calc=calculateEmployeePay({
     employee,punches:[],advisories:[],unitName:"Unassigned",periodLabel:periodStart+" - "+periodEnd,
     payProfile:{payBasis:profile.payBasis,rateAmount:profile.rateAmount,standardWorkDaysPerMonth:profile.standardWorkDaysPerMonth,standardHoursPerDay:profile.standardHoursPerDay},
     periodStart,periodEnd,payDate,statutoryRuleVersions:ruleVersions,
     statutoryDeductionTiming:org.statutoryDeductionTiming,
    });
    const amount=(code:string)=>Math.abs(Number(calc.lineItems.find(i=>i.code===code)?.amount ?? 0));
    amounts={gross:calc.gross,sss:amount("SSS"),philHealth:amount("PHIC"),pagIbig:amount("HDMF"),withholding:amount("WHT"),net:calc.net};
    if(calc.status==="Exception")issues.push("Payroll engine returned calculation exceptions");
   }catch{issues.push("Payroll inputs cannot be calculated safely");}
  }
  return {employeeId:employee.id,employeeNo:employee.employeeNo,name:employee.firstName+" "+employee.lastName,...amounts,blockers:issues};
 });
 if(rows.some(r=>r.blockers.length))blockers.push("One or more employees have missing or invalid payroll inputs.");
 blockers.push("Preview uses no attendance punches, holidays, benefit deductions or previous payroll history. Amounts are provisional and must be reconciled with a real payroll calculation.");
 return Response.json({dryRun:true,persisted:false,previewReady:!blockers.some(b=>!b.startsWith("Preview uses")),ruleVersions,rows,blockers});
}
