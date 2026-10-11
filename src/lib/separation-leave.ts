import { leaveConversionAllowance } from "@/lib/leave-conversion-policy";
export type SeparationLeaveSources = {
  balances: Array<{ id: number; leaveType: string; year: number; opening: string; accrued: string; used: string; pending: string }>;
  policies: Array<{ id: number; leaveType: string; annualDays: string; active: boolean; conversionCap: number | null }>;
  conversions: Array<{ id: number; leaveType: string; daysConverted: string; status: string; createdAt: Date | string }>;
};
export function separationLeaveAllowance(sources: SeparationLeaveSources, leaveType: string, year: number) {
  const matches = (type: string) => type.trim().toLowerCase() === leaveType.trim().toLowerCase();
  const policies = sources.policies.filter(p => p.active && matches(p.leaveType));
  const balances = sources.balances.filter(b => b.year === year && matches(b.leaveType));
  if (policies.length !== 1 || balances.length !== 1) throw new Error("One active leave policy and authoritative balance are required for separation leave monetization.");
  const policy = policies[0], balance = balances[0];
  if (policy.conversionCap == null) throw new Error("Separation leave monetization requires an approved employer leave-type conversion cap.");
  for (const conversion of sources.conversions.filter(c => matches(c.leaveType) && c.status !== "rejected")) {
    if (!conversion.daysConverted.trim() || !Number.isFinite(Number(conversion.daysConverted)) || Number(conversion.daysConverted) < 0
      || Number.isNaN(new Date(conversion.createdAt).getTime())) throw new Error("Leave conversion reservation cannot be verified.");
  }
  const reserved = sources.conversions.filter(c => matches(c.leaveType) && c.status !== "rejected"
    && Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date(c.createdAt))) === year)
    .reduce((sum, c) => sum + Number(c.daysConverted), 0);
  const available = Number(balance.opening) + Number(balance.accrued) - Number(balance.used) - Number(balance.pending);
  if ([balance.opening, balance.accrued, balance.used, balance.pending, policy.annualDays].some(v => !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0)) {
    throw new Error("Leave balance or policy cannot be verified.");
  }
  return { balanceId: balance.id, policyId: policy.id, leaveType: policy.leaveType,
    authorizedCap: policy.conversionCap, available,
    convertible: leaveConversionAllowance({ available, reserved, alreadyConverted: reserved,
      policyAnnualDays: Number(policy.annualDays), approvedAnnualConversionCap: policy.conversionCap }) };
}
export function validateSeparationLeaveCredits(credits: number, allowance: ReturnType<typeof separationLeaveAllowance>) {
  if (!Number.isFinite(credits) || credits < 0 || Math.abs(credits * 10 - Math.round(credits * 10)) > 1e-8
    || credits > allowance.convertible) throw new Error(`Requested leave exceeds the authorized unspent balance of ${allowance.convertible} days. Use tenths of a day.`);
}
