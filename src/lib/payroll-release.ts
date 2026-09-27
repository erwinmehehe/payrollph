import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { earnedWageRequests, employeeLoans, expenseClaims, leaveConversions, loanPayments, payrollEntries, payrollRuns } from "@/db/schema";

type LineItem = { code?: string; amount?: string | number };
const money=(v:number)=>(Math.round((v+Number.EPSILON)*100)/100).toFixed(2);

export async function releasePayrollRunAtomically(input:{runId:number; userId:number; actorRole:string; acknowledgeExceptions:boolean}) {
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id,input.runId)).limit(1);
    if(!run) throw new Error("Payroll run not found.");
    if(run.status === "Released") throw new Error("This run is already released.");
    if(!["Needs review","Ready for release","Processed","Approved"].includes(run.status)) throw new Error(`Run must be calculated before release (currently ${run.status}).`);
    if(run.serviceMode === "managed" && run.reviewStage !== "client_approved") throw new Error("Managed payroll requires client approval before release.");
    if(run.exceptions > 0 && !input.acknowledgeExceptions) throw new Error(`${run.exceptions} exception(s) require explicit sign-off before release.`);
    if(run.exceptions > 0 && input.actorRole !== "owner") throw new Error("Only the workspace owner may release payroll with unresolved exceptions.");

    const entries = await tx.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,input.runId));
    if(entries.length===0) throw new Error("Run has no calculated entries.");

    for(const entry of entries){
      const items=Array.isArray(entry.lineItems)?entry.lineItems as LineItem[]:[];
      for(const item of items){
        const code=String(item.code??"");
        const amount=Math.abs(Number(item.amount??0));
        if(!Number.isFinite(amount)||amount<=0) continue;
        const [kind,idText]=code.split("-"); const id=Number(idText); if(!Number.isInteger(id)||id<=0) continue;
        if(kind==="EXP") await tx.update(expenseClaims).set({status:"paid",payrollRunId:input.runId}).where(and(eq(expenseClaims.id,id),eq(expenseClaims.organizationId,run.organizationId)));
        else if(kind==="EWA") await tx.update(earnedWageRequests).set({status:"repaid",payrollRunId:input.runId}).where(and(eq(earnedWageRequests.id,id),eq(earnedWageRequests.organizationId,run.organizationId)));
        else if(code.startsWith("LEAVE_CONV-")) {
          const conversionId=Number(code.slice("LEAVE_CONV-".length));
          if(Number.isInteger(conversionId)) await tx.update(leaveConversions).set({status:"paid",payrollRunId:input.runId}).where(and(eq(leaveConversions.id,conversionId),eq(leaveConversions.organizationId,run.organizationId)));
        } else if(kind==="LOAN") {
          const [loan]=await tx.select().from(employeeLoans).where(and(eq(employeeLoans.id,id),eq(employeeLoans.organizationId,run.organizationId))).limit(1);
          if(!loan) continue;
          const [existing]=await tx.select().from(loanPayments).where(and(eq(loanPayments.loanId,id),eq(loanPayments.payrollRunId,input.runId))).limit(1);
          if(existing) continue;
          const deduct=Math.min(amount,Number(loan.remainingBalance));
          if(deduct<=0) continue;
          await tx.insert(loanPayments).values({loanId:id,payrollRunId:input.runId,amount:money(deduct),paymentDate:run.payDate,reference:`Payroll release ${run.periodLabel}`});
          const remaining=Math.max(0,Number(loan.remainingBalance)-deduct);
          await tx.update(employeeLoans).set({remainingBalance:money(remaining),totalPaid:money(Number(loan.totalPaid)+deduct),status:remaining<=0?"paid_off":"active"}).where(eq(employeeLoans.id,id));
        }
      }
    }

    const [updated]=await tx.update(payrollRuns).set({status:"Released",reviewStage:"released",releasedByUserId:input.userId,releasedAt:new Date()}).where(eq(payrollRuns.id,input.runId)).returning();
    return { run: updated, entryCount: entries.length };
  });
}
