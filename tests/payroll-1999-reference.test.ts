import assert from 'node:assert/strict';
import test from 'node:test';
import {MONTHS,WORKERS,cents,pesos,sssReference,semiMonthlyTax,expectedCutoff} from './fixtures/payroll-1999-reference';
test('reference inputs are two completed 2026 months, eight fictional workers, four cutoffs; #2006 boundary vectors are excluded',()=>{
 assert.deepEqual(MONTHS,['2026-09','2026-10']);assert.equal(WORKERS.length,8);
 assert.ok(WORKERS.every(w=>![524999,525000,1474999,1475000,3474999,3475000].includes(w.rate)));
});
test('reference arithmetic rejects malformed/unsafe money and preserves exact cents',()=>{
 assert.equal(cents('0.01'),1);assert.equal(cents('-1.01'),-101);assert.equal(pesos(123456), '1234.56');
 for(const x of ['1.001','NaN','1e5','900719925474099.99'])assert.throws(()=>cents(x));
});
test('manually worked source controls check the separate reference calculator',()=>{
 assert.deepEqual(sssReference(3000000),{msc:3000000,regularMsc:2000000,mpfMsc:1000000,sss:150000,sssEr:300000,ec:3000});
 assert.equal(semiMonthlyTax(1377500),50370);assert.equal(semiMonthlyTax(2500000),260410);
 const a=expectedCutoff(WORKERS[0],MONTHS[0],1);
 assert.deepEqual([a.gross,a.sss,a.ph,a.pag,a.wht,a.net],[1500000,75000,37500,10000,50370,1327130]);
 assert.equal(expectedCutoff(WORKERS[2],MONTHS[0],1).wht,788120,'BIR Annex E column 4 has PHP4270.70 base, not PHP4270.80');
 const first=expectedCutoff(WORKERS[4],MONTHS[0],1),last=expectedCutoff(WORKERS[4],MONTHS[0],2);
 assert.deepEqual([first.sss,last.sss,first.net,last.net],[60000,90000,1091255,1575590]);
 const sept=expectedCutoff(WORKERS[7],MONTHS[0],2),oct=expectedCutoff(WORKERS[7],MONTHS[1],2);
 assert.deepEqual([sept.benefitExempt,oct.benefitExempt],[6000000,3000000]);
 assert.deepEqual([sept.net,oct.net],[7327130,5141590]);
 const monthly40=expectedCutoff(WORKERS[1],MONTHS[0],1);
 assert.deepEqual([monthly40.gross,monthly40.sss,monthly40.ph,monthly40.wht,monthly40.net],[2000000,87500,50000,130910,1721590]);
 for(const w of WORKERS.filter(w=>w.basis!=='monthly')){
  const ordinary=expectedCutoff(w,MONTHS[0],1);
  assert.deepEqual([ordinary.gross,ordinary.sss,ordinary.ph,ordinary.pag,ordinary.wht,ordinary.net],[1000000,50000,27500,10000,0,912500]);
 }
 const phFirst=expectedCutoff(WORKERS[3],MONTHS[0],1),phLast=expectedCutoff(WORKERS[3],MONTHS[0],2);
 assert.deepEqual([phFirst.phEr,phLast.phEr,phFirst.net],[12501,12500,452510],'Explicit unverified odd-cent assignment must not silently change');
});
