import assert from "node:assert/strict";
export const MIGRATION_PROOF_KINDS=["employees","payroll_history","leave_balances","loans"];
export function migrationProofBody(e,kind,employeeNo=e.worker.employeeNo){
  const marker=e.marker, csv={
    employees:["Employee ID,First Name,Last Name,Employment Status,Monthly Basic,Hire Date",employeeNo+",Fictional,"+marker+" migrated,Regular,21111,2026-01-05"],
    payroll_history:["Employee ID,Pay Date,Payroll Period,Reference,Gross Pay,Basic Salary Earned,Net Pay,Withholding Tax",employeeNo+",2025-06-30,Fictional June,"+marker+"-HIST,25000,21111,23000,2000"],
    leave_balances:["Employee ID,Leave Type,Year,Opening Balance,Accrued,Used,Pending",employeeNo+",Vacation,2025,5,10,3,1"],
    loans:["Employee No,Loan Type,Loan Number,Original Amount,Outstanding Balance,Monthly Deduction",employeeNo+",Fictional Loan,"+marker+"-LOAN,1200,1000,200"],
  }[kind];
  assert.ok(csv,"bounded migration kind required");
  return {organizationId:e.org.id,source:"generic",kind,csv:csv.join("\n")+"\n",fileName:marker+"-"+kind+".csv",dryRun:false,evidenceReference:marker+" fictional HR baseline"};
}
export function assertMigrationCommit(before,after,e,kind){
  const batches=after.batches.filter(row=>!before.batches.some(old=>old.id===row.id));
  assert.equal(batches.length,1,"one real committed batch required");
  assert.equal(batches[0].organizationId,e.org.id,"accepts another employer's data: batch");
  assert.equal(batches[0].importKind,kind);
  assert.equal(batches[0].status,"completed");
  const worker=after.workers.find(row=>row.id===e.worker.id&&row.organizationId===e.org.id);
  assert.ok(worker,"accepts another employer's data: worker");
  if(kind==="employees"){
    assert.equal(worker.lastName,e.marker+" migrated");assert.equal(Number(worker.basicRate),21111);
    assert.equal(Number(after.profiles.find(row=>row.employeeId===e.worker.id)?.rateAmount),21111);
  }else{
    assert.deepEqual(after.workers,before.workers,"history/balance/loan import must not rewrite worker master");
    const table={payroll_history:"history",leave_balances:"leave",loans:"loans"}[kind];
    const rows=after[table].filter(row=>row.employeeId===e.worker.id&&row.organizationId===e.org.id);
    assert.equal(rows.length,1,"exact own imported source required");
    if(kind==="payroll_history"){assert.equal(rows[0].sourceReference,e.marker+"-HIST");assert.equal(Number(rows[0].grossPay),25000);}
    if(kind==="leave_balances"){assert.equal(rows[0].leaveType,"Vacation");assert.equal(Number(rows[0].opening),5);}
    if(kind==="loans"){assert.equal(rows[0].referenceNo,e.marker+"-LOAN");assert.equal(Number(rows[0].remainingBalance),1000);}
  }
  assert.deepEqual(after.payroll,before.payroll,"migration must never rewrite operational payroll");
  const audit=after.audit.filter(row=>!before.audit.some(old=>old.id===row.id));
  assert.equal(audit.length,1);assert.equal(audit[0].organizationId,e.org.id);
  assert.equal(audit[0].action,kind==="employees"?"Initial employee-master migration completed":"Migration import completed");
}
