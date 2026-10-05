export const HCM_ANALYTICS_PRIVACY_THRESHOLD = 5;

export function phToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function averageNumber(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function medianNumber(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function daysBetween(start: string | Date, end: string | Date) {
  const startTime = typeof start === "string"
    ? new Date(start.includes("T") ? start : start + "T00:00:00Z").getTime()
    : start.getTime();
  const endTime = typeof end === "string"
    ? new Date(end.includes("T") ? end : end + "T00:00:00Z").getTime()
    : end.getTime();
  return Math.max(0, Math.round((endTime - startTime) / 86_400_000));
}

export function traceInputNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return 0;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return 0;
  const prefix = key + "=";
  const raw = inputs.find((value) => typeof value === "string" && value.startsWith(prefix));
  if (typeof raw !== "string") return 0;
  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function reportableSensitiveCohort(count: number, threshold = HCM_ANALYTICS_PRIVACY_THRESHOLD) {
  return count >= Math.max(HCM_ANALYTICS_PRIVACY_THRESHOLD, threshold);
}

export function performanceDistribution(scores: number[]) {
  const buckets = [
    { label: "1.0–1.9", minimum: 1, maximum: 2 },
    { label: "2.0–2.9", minimum: 2, maximum: 3 },
    { label: "3.0–3.9", minimum: 3, maximum: 4 },
    { label: "4.0–4.9", minimum: 4, maximum: 5 },
    { label: "5.0", minimum: 5, maximum: 5.01 },
  ];
  return buckets.map((bucket) => ({
    label: bucket.label,
    count: scores.filter((score) => score >= bucket.minimum && score < bucket.maximum).length,
  }));
}

export function recruitingFunnel(stages: string[]) {
  const order = ["applied", "screening", "interview", "offer", "hired", "rejected"];
  return order.map((stage) => ({
    stage,
    count: stages.filter((value) => value.toLowerCase() === stage).length,
  }));
}

export function monthSnapshots(today: string, months = 12) {
  const current = new Date(today + "T00:00:00Z");
  const snapshots: Array<{ key: string; label: string; date: string }> = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth() - offset;
    const start = new Date(Date.UTC(year, month, 1));
    const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const end = new Date(nextMonth.getTime() - 86_400_000);
    const isCurrentMonth =
      start.getUTCFullYear() === current.getUTCFullYear()
      && start.getUTCMonth() === current.getUTCMonth();
    const snapshot = isCurrentMonth ? current : end;
    snapshots.push({
      key: start.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat("en-PH", { month: "short", year: "2-digit", timeZone: "UTC" }).format(start),
      date: snapshot.toISOString().slice(0, 10),
    });
  }
  return snapshots;
}

export function reconstructHeadcountTrend(input: {
  today: string;
  employees: Array<{ id: number; startDate: string }>;
  separations: Array<{ employeeId: number; lastDay: string; status: string }>;
  months?: number;
}) {
  const separationByEmployee = new Map<number, string>();
  for (const separation of input.separations) {
    if (separation.status !== "released") continue;
    const existing = separationByEmployee.get(separation.employeeId);
    if (!existing || separation.lastDay < existing) separationByEmployee.set(separation.employeeId, separation.lastDay);
  }

  return monthSnapshots(input.today, input.months ?? 12).map((snapshot) => ({
    ...snapshot,
    headcount: input.employees.filter((employee) => {
      if (employee.startDate > snapshot.date) return false;
      const separationDate = separationByEmployee.get(employee.id);
      return !separationDate || separationDate > snapshot.date;
    }).length,
  }));
}
