import assert from "node:assert/strict";
import test from "node:test";
import {parseFirstPayrollLegalEmployerRead,readVerifiedFirstPayrollLegalEmployer} from "../src/lib/first-payroll-legal-employer-read";
const row={id:7,organizationId:41,primaryEntity:true,active:true,legalName:"Fictional Employer",payrollCalendarMode:"ph_semi_monthly",birTin:null,sssEmployerNo:null,philHealthEmployerNo:null,pagIbigEmployerNo:null};
const good={organizationId:41,legalEntities:[row]};
test("legal employer: foreign, partial and malformed do not appear as empty; verified empty works",()=>{
 assert.deepEqual(parseFirstPayrollLegalEmployerRead({organizationId:41,legalEntities:[]},41),[]);
 assert.deepEqual(parseFirstPayrollLegalEmployerRead(good,41),[row]);
 for(const body of [null,{}, {organizationId:41},{organizationId:42,legalEntities:[]},
    {organizationId:41,legalEntities:[{...row,organizationId:42}]},
    {organizationId:41,legalEntities:[{...row,legalName:undefined}]},
    {organizationId:41,legalEntities:[row,row]}]) {
   assert.throws(()=>parseFirstPayrollLegalEmployerRead(body,41),/unavailable|inconsistent/);
 }
});
test("legal employer read: non-OK, malformed JSON, wrong org, verified empty, retry",async()=>{
 let status=503,bad=false,body:unknown=good,calls=0;
 const fetcher=(async()=>({ok:(++calls>0)&&status===200,json:async()=>{if(bad)throw SyntaxError("fictional");return body;}}as Response))as typeof fetch;
 await assert.rejects(()=>readVerifiedFirstPayrollLegalEmployer(41,fetcher));
 status=200;bad=true;
 await assert.rejects(()=>readVerifiedFirstPayrollLegalEmployer(41,fetcher));
 bad=false;body={...good,organizationId:99};
 await assert.rejects(()=>readVerifiedFirstPayrollLegalEmployer(41,fetcher));
 body={organizationId:41,legalEntities:[]};
 assert.deepEqual(await readVerifiedFirstPayrollLegalEmployer(41,fetcher),[]);
 body=good;
 assert.deepEqual(await readVerifiedFirstPayrollLegalEmployer(41,fetcher),[row]);
 assert.equal(calls,5);
});
