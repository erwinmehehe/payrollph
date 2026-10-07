import { runAutomationEventSafely } from "@/lib/automation";

export type AutomationFieldChange = {
  field: string;
  previousValue?: string | number | boolean | null;
  newValue?: string | number | boolean | null;
  effectiveDate?: string | null;
  timing?: "effective" | "scheduled";
  sensitive?: boolean;
  source?: string;
  metadata?: Record<string, unknown>;
};

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stableFieldKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "field";
}

export function fieldChangeContext(change: AutomationFieldChange) {
  const previousNumericValue = finiteNumber(change.previousValue);
  const newNumericValue = finiteNumber(change.newValue);
  const numeric = previousNumericValue != null && newNumericValue != null;
  const changeAmount = numeric ? newNumericValue - previousNumericValue : null;
  const changePercent = numeric && previousNumericValue !== 0
    ? ((newNumericValue - previousNumericValue) / Math.abs(previousNumericValue)) * 100
    : null;

  const direction = numeric
    ? changeAmount! > 0
      ? "increased"
      : changeAmount! < 0
        ? "decreased"
        : "unchanged"
    : change.previousValue === change.newValue
      ? "unchanged"
      : "changed";

  return {
    changeField: change.field,
    changeDirection: direction,
    changeTiming: change.timing ?? "effective",
    sensitiveChange: Boolean(change.sensitive),
    effectiveDate: change.effectiveDate ?? undefined,
    changeSource: change.source ?? undefined,
    ...(change.sensitive
      ? {}
      : {
          previousValue: change.previousValue ?? null,
          newValue: change.newValue ?? null,
        }),
    ...(numeric
      ? {
          previousNumericValue,
          newNumericValue,
          changeAmount,
          changePercent: Math.round((changePercent ?? 0) * 100) / 100,
        }
      : {}),
    ...(change.metadata ?? {}),
  };
}

export function meaningfulFieldChange(change: AutomationFieldChange) {
  if (change.sensitive) return true;
  return change.previousValue !== change.newValue;
}

export async function runEmployeeFieldChangeAutomations(input: {
  organizationId: number;
  employeeId: number;
  eventKey: string;
  changes: AutomationFieldChange[];
}) {
  const outcomes: Array<{
    field: string;
    automation: Awaited<ReturnType<typeof runAutomationEventSafely>>;
  }> = [];

  for (const change of input.changes.filter(meaningfulFieldChange)) {
    const automation = await runAutomationEventSafely({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      trigger: "employee.field_changed",
      eventKey: `${input.eventKey}:${stableFieldKey(change.field)}`,
      context: fieldChangeContext(change),
    });
    outcomes.push({ field: change.field, automation });
  }

  return outcomes;
}
