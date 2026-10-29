import { toCsv } from "@/lib/csv";

/** Strict, explicit employer selector for private server-rendered report pages. */
export function explicitReportBuilderEmployerId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export type BuilderDataset = "people" | "time" | "payroll";
export type BuilderField = "department" | "status" | "employmentType" |
  "headcount" | "separatedCount" | "turnoverCount" | "scheduledMinutes" | "workedMinutes" |
  "overtimeMinutes" | "absenceDays" | "payrollCost" | "otLineCost";
export type BuilderSpec = {
  dataset: BuilderDataset;
  fields: BuilderField[];
  groupBy?: "department" | "status" | "employmentType" | null;
  filters?: { department?: string; status?: string; employmentType?: string };
};

export const BUILDER_FIELD_CATALOG: Record<BuilderDataset, readonly BuilderField[]> = {
  people: ["department", "status", "employmentType", "headcount", "separatedCount", "turnoverCount"],
  time: ["department", "status", "scheduledMinutes", "workedMinutes", "overtimeMinutes", "absenceDays"],
  payroll: ["department", "status", "payrollCost", "otLineCost"],
};
export const BUILDER_DIMENSIONS: readonly BuilderField[] =
  ["department", "status", "employmentType"];
export const BUILDER_SENSITIVE: readonly BuilderField[] = ["payrollCost", "otLineCost"];
const SAFE_ROLES = new Set(["hr", "payroll"]);

export type BuilderFact = Partial<Record<BuilderField, string | number | null>>;

export function canUseBuilderField(role: string, dataset: BuilderDataset, field: string) {
  return BUILDER_FIELD_CATALOG[dataset]?.includes(field as BuilderField) === true
    && (dataset !== "payroll" || SAFE_ROLES.has(role))
    && (!BUILDER_SENSITIVE.includes(field as BuilderField) || SAFE_ROLES.has(role));
}

export function validateBuilderSpec(spec: unknown, role: string): BuilderSpec {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Report specification is required.");
  const row = spec as Record<string, unknown>;
  const dataset = row.dataset as BuilderDataset;
  if (!Object.hasOwn(BUILDER_FIELD_CATALOG, dataset)) throw new Error("Unknown report dataset.");
  const fields = row.fields as BuilderField[];
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 12
    || new Set(fields).size !== fields.length
    || !fields.every(field => typeof field === "string" && canUseBuilderField(role, dataset, field))) {
    throw new Error("One or more requested fields are unavailable for this role.");
  }
  const groupBy = row.groupBy == null ? null : row.groupBy;
  if (groupBy !== null
    && (typeof groupBy !== "string" || !BUILDER_DIMENSIONS.includes(groupBy as BuilderField)
      || !BUILDER_FIELD_CATALOG[dataset].includes(groupBy as BuilderField)
      || !fields.includes(groupBy as BuilderField))) {
    throw new Error("Grouping must use a selected whitelisted dimension.");
  }
  if (groupBy !== null && fields.some(field => BUILDER_DIMENSIONS.includes(field) && field !== groupBy)) {
    throw new Error("Grouped reports cannot contain additional ungrouped dimensions.");
  }
  const filters = row.filters ?? {};
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new Error("Invalid report filters.");
  const outFilters: BuilderSpec["filters"] = {};
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (!BUILDER_DIMENSIONS.includes(key as BuilderField)
      || !BUILDER_FIELD_CATALOG[dataset].includes(key as BuilderField)
      || typeof value !== "string" || value.length > 100) {
      throw new Error("Only whitelisted exact-match text filters are supported.");
    }
    outFilters[key as keyof typeof outFilters] = value;
  }
  return { dataset, fields, groupBy: groupBy as BuilderSpec["groupBy"], filters: outFilters };
}


/** Exact decimal centavos for payroll reporting; no IEEE-754 money totals. */
export function reportMoneyCentavos(value: string | number): bigint {
 const raw=String(value);
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(raw))throw new Error("Payroll amount has invalid centavo precision.");
 const negative=raw.startsWith("-");
 const [whole,fraction=""]=raw.replace(/^-/, "").split(".");
 const amount=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));
 return negative?-amount:amount;
}
export function formatReportCentavos(value: bigint): string {
 const abs=value<BigInt(0)?-value:value;
 return (value<BigInt(0)?"-":"")+(abs/BigInt(100)).toString()+"."+(abs%BigInt(100)).toString().padStart(2,"0");
}

export function runWhitelistedBuilder(
  facts: readonly BuilderFact[], spec: BuilderSpec, maxRows = 5_000,
) {
  if (facts.length > 50_000) throw new Error("Source dataset is too large; narrow the time range.");
  const matching = facts.filter(fact => Object.entries(spec.filters ?? {}).every(([key, value]) =>
    String(fact[key as BuilderField] ?? "") === value));
  const measures = spec.fields.filter(field => !BUILDER_DIMENSIONS.includes(field));
  if (spec.groupBy) {
    const groups = new Map<string, Record<string, string | number>>();
    for (const fact of matching) {
      const group = String(fact[spec.groupBy] ?? "Unallocated");
      if (!groups.has(group)) groups.set(group, { [spec.groupBy]: group });
      const row = groups.get(group)!;
      for (const field of measures) {
        if (BUILDER_SENSITIVE.includes(field)) {
          row[field] = formatReportCentavos(
            reportMoneyCentavos(String(row[field] ?? "0.00"))+
            reportMoneyCentavos(fact[field] ?? "0.00")
          );
        } else {
          const n = Number(fact[field] ?? 0);
          if (!Number.isFinite(n)) throw new Error("Report source contains invalid numeric evidence.");
          row[field] = Number(row[field] ?? 0) + n;
        }
      }
    }
    const records = [...groups.values()].sort((a,b) => String(a[spec.groupBy!]).localeCompare(String(b[spec.groupBy!])));
    if (records.length > maxRows) throw new Error("Report exceeds the configured row limit.");
    return records.map(record => spec.fields.map(field => String(record[field] ?? "")));
  }
  if (matching.length > maxRows) throw new Error("Report exceeds the configured row limit.");
  return matching.map(fact => spec.fields.map(field => String(fact[field] ?? "")));
}

export function builderRowsToCsv(spec: BuilderSpec, rows: string[][]) {
  return toCsv({ columns: spec.fields, rows });
}

/** Never silently treat a multi-day leave request as entirely inside a partial report window. */
export function leaveRangeFullyWithinReport(
  leaveStart: string, leaveEnd: string, reportStart: string, reportEnd: string,
): boolean {
  return leaveStart >= reportStart && leaveEnd <= reportEnd;
}

/** Unattributed legacy rows and multi-employer tenants both require reviewed entity-scoped grants. */
export function builderRequiresEntityRole(activeLegalEmployers: number): boolean {
  return !Number.isSafeInteger(activeLegalEmployers) || activeLegalEmployers !== 1;
}
