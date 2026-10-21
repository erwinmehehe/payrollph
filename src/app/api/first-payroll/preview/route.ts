import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { parseMigrationDate } from "@/lib/migration-date";
import { MAX_PAYROLL_PERIOD_DAYS, inclusivePeriodDays, validIsoDate } from "@/lib/payroll-period-validation";
import { loadCanonicalFirstPayrollPreview } from "@/lib/first-payroll-canonical-preview";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { firstPayrollInlineAvailable } from "@/lib/first-payroll-inline-gate";
import { publicFirstPayrollPreviewError } from "@/lib/first-payroll-public-errors";
import { privatePreviewDenied, privatePreviewJson } from "@/lib/first-payroll-private-response";
export const dynamic="force-dynamic";

/** Read-only first-payroll preview. Deliberately GET-only, never a payroll-run mutation. */
export async function GET(request:Request){
 if (!(await firstPayrollInlineAvailable()))
  return privatePreviewJson({error:"First-payroll preview is unavailable."},404);
 const user=await getSessionUser();
 if(!user)return privatePreviewJson({error:"Authentication required."},401);
 const q=new URL(request.url).searchParams;
 const organizationId=Number(q.get("organizationId"));
 const periodStart=parseMigrationDate(q.get("periodStart")??"");
 const periodEnd=parseMigrationDate(q.get("periodEnd")??"");
 const payDate=parseMigrationDate(q.get("payDate")??"");
 if(!Number.isSafeInteger(organizationId)||organizationId<=0||!periodStart||!periodEnd||!payDate||
   !validIsoDate(periodStart)||!validIsoDate(periodEnd)||!validIsoDate(payDate)||
   periodStart>periodEnd||payDate<periodEnd||inclusivePeriodDays(periodStart,periodEnd)>MAX_PAYROLL_PERIOD_DAYS)
  return privatePreviewJson({error:`Valid employer and pay period (maximum ${MAX_PAYROLL_PERIOD_DAYS} inclusive days) required.`},400);
 const denied=await assertOrganizationRole(user.id,organizationId,PAYROLL_VIEW_ROLES,"Payroll viewer access required.");
 if(denied)return privatePreviewDenied(denied);
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return privatePreviewJson({error:"Company-wide payroll access required."},403);
 try {
  const data=await db.transaction(async tx=>{
   await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
   return loadCanonicalFirstPayrollPreview({organizationId,periodStart,periodEnd,payDate},tx);
  });
  return privatePreviewJson({ ...data, organizationId, periodStart, periodEnd, payDate });
 }catch(e){
  return privatePreviewJson({error:publicFirstPayrollPreviewError(e)},422);
 }
}
