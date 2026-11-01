import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {requireFictionalJourney,centavos,reconcileFirstPayroll} from '../scripts/qa/first-payroll-full-contract.mjs';
const env={FIRST_PAYROLL_FULL_MODE:'fictional-disposable-only',DATABASE_URL:'postgresql://postgres@127.0.0.1:5436/app_db',SECURITY_SMOKE_URL:'http://127.0.0.1:3016',WORKER_ENABLED:'false',CENTRAL_SCHEDULER_ENABLED:'false',PAYMONGO_DISBURSEMENTS_ENABLED:'false',XENDIT_PAYOUTS_ENABLED:'false'};
test('journey refuses nonlocal sources, workers, providers and missing explicit mode',()=>{
 assert.doesNotThrow(()=>requireFictionalJourney(env));
 for(const changes of [{DATABASE_URL:'postgresql://postgres@db.example.invalid/app_db'},{DATABASE_URL:env.DATABASE_URL+'?host=elsewhere'},{SECURITY_SMOKE_URL:'https://app.example.invalid'},...['WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED'].map(k=>({[k]:'true'})),{XENDIT_SECRET_KEY:'forbidden'},{FIRST_PAYROLL_FULL_MODE:undefined}])assert.throws(()=>requireFictionalJourney({...env,...changes}));
});
test('reconciliation rejects incomplete, duplicate, wrong-run and one-cent drift',()=>{
 const run={id:7,employeeCount:1,grossPay:'15000.00',netPay:'13271.30'};
 const entry={employeeId:9,payrollRunId:7,grossPay:'15000.00',deductions:'1728.70',netPay:'13271.30'};
 assert.doesNotThrow(()=>reconcileFirstPayroll(run,[entry]));
 for(const entries of [[],[entry,entry],[{...entry,payrollRunId:8}],[{...entry,netPay:'13271.31'}]])assert.throws(()=>reconcileFirstPayroll(run,entries));
 assert.throws(()=>reconcileFirstPayroll({...run,netPay:'13271.29'},[entry]));
 assert.throws(()=>reconcileFirstPayroll({...run,grossPay:'15000.01'},[entry]));
});
test('exact decimal centavos refuse rounding guesses and unsafe integers',()=>{
 assert.equal(centavos('0.29'),29);assert.equal(centavos('-0.01'),-1);
 for(const value of ['0.005','1e3','NaN','','9007199254740993'])assert.throws(()=>centavos(value));
});

test('idempotent payroll creation includes browser-equivalent same-origin headers',()=>{
 const source=readFileSync(new URL('../scripts/qa/first-payroll-full-http.mjs',import.meta.url),'utf8');
 const from=source.indexOf('async function create(){');
 const to=source.indexOf('const created=await create()',from);
 assert.ok(from>=0&&to>from,'payroll idempotent creation helper is required');
 const create=source.slice(from,to);
 assert.ok(create.includes("origin:base.origin,'sec-fetch-site':'same-origin'"),'production-mode server requires a matching browser same-origin signal');
 assert.ok(create.includes("'idempotency-key':key"),'retry must use the same intent key');
 assert.ok(create.includes("fetch(new URL('/api/payroll-runs',base)"),'request must use the disposable localhost base URL');
});
