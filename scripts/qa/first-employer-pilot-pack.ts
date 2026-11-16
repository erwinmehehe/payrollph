/**
 * Offline preparation and arithmetic triage only. Never grants operational approval.
 * Reuses the canonical payroll + GL verifier; no database, network or runtime flags.
 */
import { chmodSync, closeSync, constants, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateParallelPayrollReconciliation, JOURNAL_COLUMNS, PAYROLL_COLUMNS } from "../../src/lib/private-parallel-payroll-reconciliation";

const LIMIT = 256 * 1024;
const EXCLUDED = ["multiple-sites-or-regions", "daily-or-piece-rate", "joiners-or-leavers",
  "final-pay", "retro-or-imported-year-to-date", "variable-incentives", "loans",
  "holiday-rest-day-night-or-overtime", "multi-entity-transfers"];
export const unassignedScope = () => ({
  schemaVersion: 1, mode: "shadow-only", legalEntityCode: null, region: null,
  industry: null, employeeCount: null, siteCount: 1, payFrequency: null,
  requiredMonths: 2, workerBasis: "monthly-fixed", exceptions: [],
});
const KEYS = Object.keys(unassignedScope()).sort();
const OBJECT = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

export function scopeBlockers(scope: unknown): string[] {
  if (!OBJECT(scope) || JSON.stringify(Object.keys(scope).sort()) !== JSON.stringify(KEYS))
    return ["SCOPE_SCHEMA_INVALID"];
  const issues: string[] = [];
  if (scope.schemaVersion !== 1 || scope.mode !== "shadow-only") issues.push("SHADOW_ONLY_REQUIRED");
  if (typeof scope.legalEntityCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{5,47}$/.test(scope.legalEntityCode))
    issues.push("EMPLOYER_UNASSIGNED");
  if (typeof scope.region !== "string" || !["NCR","CAR","I","II","III","IV-A","IV-B","V","VI","VII","VIII","IX","X","XI","XII","XIII","BARMM"].includes(scope.region))
    issues.push("REGION_UNASSIGNED");
  if (typeof scope.industry !== "string" || !/^[A-Za-z][A-Za-z -]{1,63}$/.test(scope.industry))
    issues.push("INDUSTRY_UNASSIGNED");
  if (!Number.isSafeInteger(scope.employeeCount) || Number(scope.employeeCount) < 1 || Number(scope.employeeCount) > 25)
    issues.push("COHORT_REQUIRES_1_TO_25_WORKERS");
  if (scope.siteCount !== 1) issues.push("SINGLE_SITE_REQUIRED");
  if (!["monthly","semi-monthly"].includes(String(scope.payFrequency))) issues.push("PAY_FREQUENCY_UNASSIGNED");
  if (!Number.isSafeInteger(scope.requiredMonths) || Number(scope.requiredMonths) < 2 || Number(scope.requiredMonths) > 12)
    issues.push("TWO_TO_TWELVE_MONTHS_REQUIRED");
  if (scope.workerBasis !== "monthly-fixed") issues.push("WORKER_BASIS_OUT_OF_SCOPE");
  if (!Array.isArray(scope.exceptions) || scope.exceptions.length) issues.push("EXCEPTIONS_REQUIRE_SEPARATE_PROOF");
  return issues;
}

function privateJson(path: string): unknown {
  // Do not check lstat before opening: the path could be swapped in between.
  // O_NOFOLLOW rejects final-component symlinks atomically. Fail closed if
  // the runtime cannot request it rather than silently following links.
  if (typeof constants.O_NOFOLLOW !== "number") throw Error("UNSAFE_INPUT_PLATFORM");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > LIMIT)
      throw Error("UNSAFE_INPUT");
    // Bound the actual read too, even if a file grows after the stat.
    const bytes = Buffer.alloc(LIMIT + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = readSync(fd, bytes, size, bytes.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > LIMIT) throw Error("INPUT_TOO_LARGE");
    return JSON.parse(bytes.subarray(0, size).toString("utf8"));
  } finally { closeSync(fd); }
}

const pending = [
  "EMPLOYER_PERMISSION_AND_PRIVATE_STORAGE", "REGION_SECTOR_SIZE_WAGE_CATEGORY",
  "CURRENT_STATUTORY_RULES_AND_1280_DECISIONS", "REAL_DISTINCT_OPERATOR_ROLES",
  "HRIS_ROSTER_AND_SOURCE_INPUT_REVIEW", "WFM_PHYSICAL_DEVICE_AND_POLICY_UAT",
  "HCM_EFFECTIVE_DATES_AND_APPROVAL_UAT", "ORIGINAL_EXPORT_PROVENANCE_AND_NORMALIZATION",
  "PAYSLIP_AND_BANK_PREVIEW_RECONCILIATION", "AGENCY_FORMAT_AND_FILING_ACCEPTANCE",
  "DEPLOYED_FLAGS_MFA_BACKUP_RESTORE_AND_SECURITY", "OWNER_OPERATIONAL_RELEASE_DECISION",
];
function limits() {
  return {
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", operationalApproval: false,
    independentReviewVerified: false, productionReady: false, approvedForPayment: false,
    runtimeFlagsInspected: false, pendingExternalEvidence: pending,
    limitation: "Offline scope and supplied-file arithmetic only. No original-source authentication, statutory certification, human signoff, deployed environment inspection, bank settlement or agency acceptance.",
  } as const;
}

export function checkPilotPack(directory: string) {
  const root = realpathSync(directory);
  const scope = privateJson(join(root, "scope.json"));
  const blockers = scopeBlockers(scope);
  const notRun = { reconciliation: "NOT_RUN", monthsCompared: 0, verifiedFileHashCount: 0,
    reconciliationIssueCount: 0, matchedEmployeesPerMonth: [] as number[] };
  if (blockers.length) return { status: "BLOCKED", blockers, ...notRun, ...limits() };
  // Exact schema was validated above; never print private scope or source paths.
  const assigned = scope as unknown as { legalEntityCode: string; employeeCount: number; requiredMonths: number };
  const manifest = privateJson(join(root, "parallel-manifest.json"));
  if (!OBJECT(manifest) || manifest.legalEntityCode !== assigned.legalEntityCode)
    return { status: "BLOCKED", blockers: ["SCOPE_MANIFEST_EMPLOYER_MISMATCH"], ...notRun, ...limits() };
  const evidence = realpathSync(join(root, "evidence"));
  const rel = relative(root, evidence);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep))
    throw Error("UNSAFE_EVIDENCE_ROOT");
  // Certification mode requires multiple months; --pilot's one-month shortcut
  // is deliberately not used for this two-month preparation plan.
  const report = evaluateParallelPayrollReconciliation(manifest, evidence);
  // Underlying filesystem exceptions can contain private paths. Preserve their
  // failure, never forward arbitrary error text into this bounded summary.
  const failures = report.issues.length ? ["CANONICAL_RECONCILIATION_FAILED"] : [];
  if (report.cycleCount < assigned.requiredMonths) failures.push("PLANNED_MONTHS_INCOMPLETE");
  if (report.results.some(c => c.incumbentEmployeeCount !== assigned.employeeCount || c.linawEmployeeCount !== assigned.employeeCount))
    failures.push("SCOPE_ROSTER_COUNT_MISMATCH");
  return {
    status: failures.length ? "BLOCKED" : "ARITHMETIC_RECONCILED_REVIEW_PENDING",
    blockers: failures, reconciliation: failures.length ? "FAILED" : "PASSED",
    monthsCompared: report.cycleCount, verifiedFileHashCount: report.verifiedFileHashCount,
    reconciliationIssueCount: report.issues.length,
    matchedEmployeesPerMonth: report.results.map(c => c.matchedEmployees), ...limits(),
  };
}

export function preparePilotPack(parent: string) {
  const root = mkdtempSync(join(realpathSync(parent), "payrollph-first-pilot-"));
  chmodSync(root, 0o700);
  mkdirSync(join(root, "evidence"), { mode: 0o700 });
  mkdirSync(join(root, "templates"), { mode: 0o700 });
  const write = (path: string, body: string) => writeFileSync(join(root, path), body, { flag: "wx", mode: 0o600 });
  write("scope.json", JSON.stringify(unassignedScope(), null, 2) + "\n");
  write("parallel-manifest.json", JSON.stringify({ schemaVersion: 1, legalEntityCode: null, cycles: [] }, null, 2) + "\n");
  write("templates/payroll.csv", PAYROLL_COLUMNS.join(",") + "\n");
  write("templates/journal.csv", JOURNAL_COLUMNS.join(",") + "\n");
  write("README.txt", [
    "UNASSIGNED SHADOW PILOT. No employer, evidence, dates, approvals or payroll results invented.",
    "This directory is private working material: never commit it or upload its files to CI/GitHub.",
    "Templates have headers only and intentionally cannot pass reconciliation.",
    "Populate scope.json only after employer permission and scope review. 1-25 workers is this pilot's bounded cohort, not a product or legal limit.",
    "Use an opaque employer code, never a company name/TIN. Keep mapping and original exports in the employer-approved encrypted vault.",
    "For each of at least two completed months retain FOUR distinct authentic normalized files under evidence/: incumbentPayroll, linawPayroll, incumbentJournal, linawJournal.",
    "Add period YYYY-MM and {filePath: relative file path, sha256: actual 64-hex digest} for each source in parallel-manifest.json. Do not hash empty templates.",
    "Use canonical headers in templates/. Worker keys require private employer-specific HMAC pseudonyms. Do not log the secret or mapping.",
    "Run node --import tsx scripts/qa/first-employer-pilot-pack.ts check <this-directory> from the source checkout.",
    "A passing report is supplied-file arithmetic only. Existing canonical one-cent tolerance is unchanged; every nonzero difference still needs reviewer explanation.",
    "No database, provider, email, payout, release, filing or environment-setting action is performed.",
    "Exceptions requiring a separately reviewed plan: " + EXCLUDED.join(", "),
    "See docs/launch/first-employer-shadow-pilot.md for roles, stages, source evidence and stop rules.",
    "",
  ].join("\n"));
  return { status: "PREPARED_UNASSIGNED", directory: root, reconciliation: "NOT_RUN", ...limits() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, ...extra] = process.argv.slice(2);
  if (!directory || extra.length || !["prepare","check"].includes(command)) {
    console.error("Usage: node --import tsx scripts/qa/first-employer-pilot-pack.ts <prepare|check> <private-directory>");
    process.exitCode = 2;
  } else {
    try {
      const result = command === "prepare" ? preparePilotPack(directory) : checkPilotPack(directory);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "BLOCKED") process.exitCode = 1;
    } catch {
      console.error("PILOT_PACK_INPUT_INVALID: inspect private inputs locally; do not paste files, paths or payroll into GitHub.");
      process.exitCode = 2;
    }
  }
}
