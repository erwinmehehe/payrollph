function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

export function validatePayrollWindow(periodStart: string, periodEnd: string, payDate: string) {
  if (![periodStart, periodEnd, payDate].every(validIsoDate)) {
    return { ok: false as const, error: "periodStart, periodEnd and payDate must use YYYY-MM-DD." };
  }
  if (periodStart > periodEnd) return { ok: false as const, error: "Payroll period start cannot be after period end." };
  if (payDate < periodEnd) return { ok: false as const, error: "Pay date cannot be before the payroll period ends." };
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > 16) return { ok: false as const, error: "Payroll periods cannot exceed 16 calendar days. Split the run into a valid semi-monthly or shorter cutoff." };
  const pay = new Date(`${payDate}T00:00:00Z`);
  if (Math.floor((pay.getTime() - end.getTime()) / 86_400_000) > 31) {
    return { ok: false as const, error: "Pay date is too far after the payroll cutoff." };
  }
  return { ok: true as const };
}

export function payrollPeriodLabel(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const startMonth = start.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const endMonth = end.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = end.getUTCFullYear();
  if (start.getUTCFullYear() === year && startMonth === endMonth) return `${startMonth} ${start.getUTCDate()}–${end.getUTCDate()}, ${year}`;
  return `${startMonth} ${start.getUTCDate()}, ${start.getUTCFullYear()}–${endMonth} ${end.getUTCDate()}, ${year}`;
}
