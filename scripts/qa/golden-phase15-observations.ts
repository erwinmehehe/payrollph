import assert from "node:assert/strict";
export type Phase15CutoffSpec = {
  withholdingEachCutoff: number; withholdingOverrides?: Record<string, number>; status: string;
  noBreakdownFlagFrom: number | null; poolFlagFrom: number | null;
};
export type Phase15Observation = {
  status: string; withholding: number; noBreakdownFlag: boolean; poolFlag: boolean; flags: string[];
};
export function phase15Centavos(value: number, label: string) {
  const cents=value*100, rounded=Math.round(cents);
  assert.ok(Number.isFinite(value)&&Number.isSafeInteger(rounded)&&Math.abs(cents-rounded)<0.000001,
    label+": amount must be finite exact centavos");
  return rounded;
}
export function phase15CutoffFailures(id:string,spec:Phase15CutoffSpec,cutoff:number,seen:Phase15Observation) {
  const failures:string[]=[];
  const expected=spec.withholdingOverrides?.[String(cutoff)]??spec.withholdingEachCutoff;
  if(phase15Centavos(seen.withholding,id)!==phase15Centavos(expected,id))
    failures.push(`${id} cutoff ${cutoff} withholding: expected ${expected.toFixed(2)}, got ${seen.withholding.toFixed(2)}`);
  if(seen.status!==spec.status)failures.push(`${id} cutoff ${cutoff} status: expected ${spec.status}, got ${seen.status}`);
  const breakdown=spec.noBreakdownFlagFrom!==null&&cutoff>=spec.noBreakdownFlagFrom;
  const pool=spec.poolFlagFrom!==null&&cutoff>=spec.poolFlagFrom;
  if(seen.noBreakdownFlag!==breakdown)failures.push(`${id} cutoff ${cutoff} no-breakdown review flag: expected ${breakdown}, got ${seen.noBreakdownFlag}`);
  if(seen.poolFlag!==pool)failures.push(`${id} cutoff ${cutoff} pool review flag: expected ${pool}, got ${seen.poolFlag}`);
  if(spec.status==="Ready"&&seen.flags.length!==0)failures.push(`${id} cutoff ${cutoff}: control must have no flags`);
  return failures;
}
