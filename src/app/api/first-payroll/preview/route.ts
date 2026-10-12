import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { parseMigrationDate } from "@/lib/migration-date";
import { loadReadOnlyFirstPayrollPreview } from "@/lib/first-payroll-preview";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { firstPayrollInlineAvailable } from "@/lib/first-payroll-inline-gate";
export const dynamic="force-dynamic";

/** Read-only first-payroll preview. Deliberately GET-only, never a payroll-run mutation. */
export async function GET(request:Request){
 if (!(await firstPayrollInlineAvailable()))
  return Response.json({error:"First-payroll preview is unavailable."},{status:404});
 const user=await getSessionUser();
 if(!user)return Response.json({error:"Authentication required."},{status:401});
 const q=new URL(request.url).searchParams;
 const organizationId=Number(q.get("organizationId"));
 const periodStart=parseMigrationDate(q.get("periodStart")??"");
 const periodEnd=parseMigrationDate(q.get("periodEnd")??"");
 const payDate=parseMigrationDate(q.get("payDate")??"");
 if(!Number.isSafeInteger(organizationId)||organizationId<=0||!periodStart||!periodEnd||!payDate||
   periodStart>periodEnd||payDate<periodEnd||(Date.parse(periodEnd)-Date.parse(periodStart))/86400000>31)
  return Response.json({error:"Valid employer and pay period (maximum 32 inclusive days) required."},{status:400});
 const denied=await assertOrganizationRole(user.id,organizationId,PAYROLL_VIEW_ROLES,"Payroll viewer access required.");
 if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return Response.json({error:"Company-wide payroll access required."},{status:403});
 try {
  const data=await db.transaction(async tx=>{
   await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
   return loadReadOnlyFirstPayrollPreview({organizationId,periodStart,periodEnd,payDate},tx);
  });
  return Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){
  return Response.json({error:e instanceof Error?e.message:"Preview unavailable."},{status:422});
 }
}
