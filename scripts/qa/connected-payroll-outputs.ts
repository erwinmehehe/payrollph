import assert from "node:assert/strict";
import {and,eq} from "drizzle-orm";
import {db} from "../../src/db";
import {payrollEntries,payrollRuns} from "../../src/db/schema";
import {parseCsv} from "../../src/lib/csv-import";

type Client={ok:(path:string)=>Promise<any>;request:(path:string)=>Promise<Response>};
const cents=(value:unknown):bigint=>{
  const text=String(value);
  assert.match(text,/^-?\d+(?:\.\d{1,2})?$/,"Output amount must be finite, centavo precision");
  const negative=text.startsWith("-"),[whole,fraction=""]=text.replace(/^-/,'').split('.');
  const amount=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
  return negative?-amount:amount;
};

/** Actual synthetic HTTP outputs for the same stored run; never invokes a payout route. */
export async function proveConnectedPayrollOutputs(input:{organizationId:number;runId:number;employeeId:number;
  owner:Client;employee:Client;foreignOwner:Client;foreignEmployee?:Client}){
  const [run]=await db.select().from(payrollRuns).where(and(eq(payrollRuns.id,input.runId),eq(payrollRuns.organizationId,input.organizationId)));
  assert.equal(run.status,"Released");
  const entries=await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,run.id));
  assert.equal(entries.length,run.employeeCount);
  assert.equal(entries.reduce((sum,e)=>sum+cents(e.grossPay),BigInt(0)),cents(run.grossPay));
  assert.equal(entries.reduce((sum,e)=>sum+cents(e.netPay),BigInt(0)),cents(run.netPay));
  for(const entry of entries)assert.equal(cents(entry.grossPay)-cents(entry.deductions),cents(entry.netPay));
  const entry=entries.find(e=>e.employeeId===input.employeeId);assert.ok(entry);
  const summary=await input.employee.ok("/api/self/payslips");
  const slip=summary.payslips?.find((s:{entryId:number})=>s.entryId===entry.id);assert.ok(slip);
  for(const [output,stored]of [[slip.gross,entry.grossPay],[slip.deductions,entry.deductions],[slip.net,entry.netPay]]){
    assert.equal(cents(output),cents(stored));
  }
  const pdf=await input.employee.request("/api/self/payslips/"+entry.id);assert.equal(pdf.status,200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),"%PDF-");
  if(input.foreignEmployee)assert.equal((await input.foreignEmployee.request("/api/self/payslips/"+entry.id)).status,404);
  const journalPath=`/api/payroll-runs/${run.id}/exports?kind=journal`;
  assert.equal((await input.foreignOwner.request(journalPath)).status,403);
  const journal=await input.owner.request(journalPath);assert.equal(journal.status,200);
  const cacheControl=journal.headers.get("cache-control")??"";
  // The framework/proxy may normalize the route's private/no-store header.
  // Require the actual privacy guarantee rather than one serialized spelling.
  assert.match(cacheControl,/(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.doesNotMatch(cacheControl,/\bpublic\b|s-maxage\s*=\s*[1-9]/i);
  const [header,...rows]=parseCsv(await journal.text());
  assert.equal(header[9],"Debit");assert.equal(header[10],"Credit");assert.ok(rows.length>0);
  assert.equal(rows.reduce((sum,row)=>sum+cents(row[9]||"0"),BigInt(0)),
    rows.reduce((sum,row)=>sum+cents(row[10]||"0"),BigInt(0)),"Journal debit and credit must balance exactly");
  assert.equal(rows.filter(row=>row[8]==="Cash/Bank").reduce((sum,row)=>sum+cents(row[10]||"0")-cents(row[9]||"0"),BigInt(0)),cents(run.netPay));
}
