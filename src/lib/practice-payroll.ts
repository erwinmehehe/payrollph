/** Public fictional inputs/results only. Never contains a live worker or run ID. */
export type PracticeWorker = {
  id: string; name: string; basis: string; startDate: string; inputSummary: string;
  grossCents: number; deductionCents: number; netCents: number;
  lines: { label: string; cents: number }[];
};
export type PracticeScenario = { id: string; name: string; explanation: string; workers: PracticeWorker[] };
export type PracticePayload = { status: "ready"; scenarios: PracticeScenario[] } | { status: "unavailable" };

export function practicePayrollAllowed(enabled: boolean, access: { role: string; companyWide: boolean } | null | undefined) {
  return enabled && access?.role === "owner" && access.companyWide === true;
}

export function totalPracticePayroll(scenario: PracticeScenario, selected: readonly string[]) {
  if (!selected.length || new Set(selected).size !== selected.length) throw new Error("Select at least one fictional employee, without duplicates.");
  if (selected.some(id => !scenario.workers.some(worker => worker.id === id))) throw new Error("Unknown fictional employee. Reset practice and try again.");
  const workers = scenario.workers.filter(worker => selected.includes(worker.id));
  const total = { grossCents: 0, deductionCents: 0, netCents: 0 };
  for (const worker of workers) {
    for (const key of ["grossCents", "deductionCents", "netCents"] as const) {
      if (!Number.isSafeInteger(worker[key]) || worker[key] < 0) throw new Error("Sample calculation is unavailable.");
      total[key] += worker[key];
      if (!Number.isSafeInteger(total[key])) throw new Error("Sample total is unavailable.");
    }
    if (worker.grossCents - worker.deductionCents !== worker.netCents) throw new Error("Sample calculation does not reconcile.");
  }
  return { workers, ...total };
}

export function samplePayslipText(worker: PracticeWorker) {
  return ["PRACTICE ONLY — NOT A REAL PAYSLIP", "No wages paid. Not for a bank, filing or employment evidence.",
    worker.name, "Fictional cutoff: October 1–15, 2026", worker.inputSummary,
    ...worker.lines.map(line => `${line.label}: PHP ${(line.cents / 100).toFixed(2)}`),
    `Gross: PHP ${(worker.grossCents / 100).toFixed(2)}`,
    `Deductions: PHP ${(worker.deductionCents / 100).toFixed(2)}`,
    `Sample net: PHP ${(worker.netCents / 100).toFixed(2)}`].join("\n");
}
