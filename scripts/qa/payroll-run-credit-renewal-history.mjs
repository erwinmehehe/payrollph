import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyPayrollRenewalResults} from './payroll-run-credit-renewal-contract.mjs';
import {RENEWAL_LEDGER_INPUTS} from './payroll-run-renewal-inputs.mjs';

export const HISTORICAL_RENEWAL_RECEIPT='scripts/qa/payroll-run-credit-renewal-reconciled-receipt.json';
export const HISTORICAL_RENEWAL_SEAL='833c31caba56cbf082108a6fdd8a37219b11346e40b319d72c66ca27ba6054a6';
function sealed(file,seal,read){
  const raw=read(file,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'),seal,'Historical executed receipt changed');
  return {raw,receipt:JSON.parse(raw)};
}
/** Immutable history only: this never asserts that an old job ran new source. */
export function readHistoricalPayrollRenewal(read=readFileSync){
  const {raw,receipt}=sealed(HISTORICAL_RENEWAL_RECEIPT,HISTORICAL_RENEWAL_SEAL,read);
  verifyPayrollRenewalResults(receipt);
  assert.deepEqual(receipt.historicalFullInputReceipt,{
    file:'scripts/qa/payroll-run-credit-renewal-receipt.json',
    sha256:'13938f06233b272e72bcaf4f171378de220942b18cfffc79d8e8088d62a6e35b'});
  const original=sealed(receipt.historicalFullInputReceipt.file,receipt.historicalFullInputReceipt.sha256,read);
  assert.deepEqual(receipt.methods,original.receipt.methods);
  assert.deepEqual(receipt.accountingScope.excludedEntryPoints,RENEWAL_LEDGER_INPUTS);
  assert.deepEqual(Object.keys(receipt.cohorts),Object.keys(original.receipt.cohorts));
  for(const [name,cohort]of Object.entries(receipt.cohorts)){
    const {sourcePins,executedAccountingInputs,...metadata}=cohort;
    const {sourcePins:oldPins,...oldMetadata}=original.receipt.cohorts[name];
    assert.deepEqual(metadata,oldMetadata,'Historical execution metadata must remain immutable');
    assert.deepEqual(executedAccountingInputs,Object.fromEntries(Object.entries(oldPins).filter(([file])=>RENEWAL_LEDGER_INPUTS.includes(file))));
    assert.deepEqual(sourcePins,Object.fromEntries(Object.entries(oldPins).filter(([file])=>!RENEWAL_LEDGER_INPUTS.includes(file))),
      'Only the five declared ledger entrypoints may be separated from historical execution inputs');
  }
  return {receipt,raw,originalRaw:original.raw};
}
