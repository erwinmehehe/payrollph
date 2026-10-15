/**
 * Strict, safe-to-log predicates for two real HTTP responses from the
 * fictional demo. Never emit the JSON, identifiers, amounts or cookies.
 */
import { readFileSync } from "node:fs";

const cycleName = "Public demo HR scope privacy #1046";
const fixtureBudget = "876543.21";

function requireSafe(condition, message) {
  if (!condition) throw new Error("Compensation acceptance failed: " + message);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function uniquePositiveIds(rows) {
  if (!Array.isArray(rows)) return null;
  const ids = rows.map((row) => row?.id);
  if (!ids.every((value) => Number.isSafeInteger(value) && value > 0)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return new Set(ids);
}
function includesForbiddenKey(value) {
  const privateKeys = new Set([
    "disbursementAccount", "disbursementAccountName", "disbursementBankCode",
    "bankAccount", "bankCode", "tin", "sssNo", "philHealthNo", "pagIbigNo",
    "birTin", "birBranchCode", "sssEmployerNo", "philHealthEmployerNo",
    "pagIbigEmployerNo", "annualBudget", "notes",
  ]);
  if (Array.isArray(value)) return value.some(includesForbiddenKey);
  if (!object(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    privateKeys.has(key) || includesForbiddenKey(nested));
}

export function verifyLiveCompensationPrivacy(company, scoped) {
  requireSafe(object(company) && object(scoped), "response must be an object");
  requireSafe(object(company.access) && object(scoped.access), "access metadata missing");
  requireSafe(company.access.role === "hr" && scoped.access.role === "hr", "both callers must be HR");
  requireSafe(company.access.companyWide === true && company.access.orgUnitId === null,
    "global HR membership is not company-wide");
  requireSafe(scoped.access.companyWide === false &&
    Number.isSafeInteger(scoped.access.orgUnitId) && scoped.access.orgUnitId > 0 &&
    typeof scoped.access.orgUnitName === "string" && scoped.access.orgUnitName.length > 0,
    "scoped HR does not have a validated unit");
  requireSafe(company.access.organizationId === scoped.access.organizationId &&
    Number.isSafeInteger(company.access.organizationId) &&
    company.access.organizationId > 0, "the two HR roles must use the same employer");

  requireSafe(Array.isArray(company.cycles) && Array.isArray(scoped.cycles),
    "compensation cycles missing");
  const globalFixture = company.cycles.filter((cycle) => cycle.name === cycleName);
  const scopedFixture = scoped.cycles.filter((cycle) => cycle.name === cycleName);
  requireSafe(globalFixture.length === 1 && scopedFixture.length === 1,
    "real fictional budget fixture must appear in both role responses");
  requireSafe(globalFixture[0].id === scopedFixture[0].id,
    "role responses must refer to the same cycle");
  requireSafe(globalFixture[0].budgetPool === fixtureBudget,
    "company-wide HR must retain the actual seeded budget");
  requireSafe(scoped.cycles.every((cycle) => cycle.budgetPool === null),
    "every scoped compensation cycle budget must be null, not zero");
  requireSafe(!JSON.stringify(scoped).includes(fixtureBudget),
    "scoped HTTP payload must never include the raw organization budget");

  const globalIds = uniquePositiveIds(company.employees);
  const scopedIds = uniquePositiveIds(scoped.employees);
  requireSafe(globalIds && scopedIds && scopedIds.size > 0 &&
    globalIds.size > scopedIds.size, "distinct in-unit and out-of-unit workers required");
  requireSafe([...scopedIds].every((id) => globalIds.has(id)),
    "unit workers must be a subset of global HR workers");
  const hiddenIds = new Set([...globalIds].filter((id) => !scopedIds.has(id)));

  requireSafe(Array.isArray(company.proposals) && Array.isArray(scoped.proposals) &&
    scoped.proposals.length > 0, "nonempty compensation proposal fixture required");
  requireSafe(scoped.proposals.every((p) => scopedIds.has(p.employeeId)),
    "an out-of-unit proposal was sent to scoped HR");
  requireSafe(company.proposals.some((p) => hiddenIds.has(p.employeeId)) &&
    company.proposals.some((p) => scopedIds.has(p.employeeId)),
    "global HR must have both unit and other-unit proposals");
  requireSafe(scoped.proposals.every((p) =>
    company.proposals.some((g) => g.id === p.id && g.employeeId === p.employeeId)),
    "scoped proposals must match global HR source records");

  // A unique fictional canary proves value confidentiality without wrongly
  // flagging two legitimate workers whose unrelated pay amounts happen to match.
  const privateFixture = company.proposals.filter((p) =>
    hiddenIds.has(p.employeeId) && p.reason === "QA1046 other unit private proposal");
  requireSafe(privateFixture.length === 1, "missing distinctive other-unit salary canary");
  const scopedText = JSON.stringify(scoped);
  requireSafe(!scopedText.includes(privateFixture[0].reason) &&
    !scopedText.includes(String(privateFixture[0].proposedAnnual)),
    "another unit's identifiable proposal content leaked");
  requireSafe(!includesForbiddenKey(scoped) && !includesForbiddenKey(company),
    "internal legal, bank, statutory or position-budget keys were serialized");

  requireSafe(Array.isArray(company.bands) && Array.isArray(scoped.bands) &&
    scoped.bands.length > 0 && company.bands.length > scoped.bands.length,
    "scoped salary-band catalog did not redact the other unit");
  const globalBandIds = new Set(company.bands.map((band) => band.id));
  requireSafe(scoped.bands.every((band) => globalBandIds.has(band.id)),
    "unit salary bands not drawn from the authorized company catalog");

  return {
    globalHr: true, scopedHr: true, realCycleComparison: true,
    budgetRedacted: true, otherUnitWorkersExcluded: true,
    otherUnitProposalsExcluded: true, internalFieldsExcluded: true,
  };
}

if (process.argv[1]?.endsWith("/verify-live-compensation-scope.mjs")) {
  try {
    if (process.argv.length !== 4) throw new Error("Two private response files are required");
    let globalPayload;
    let scopedPayload;
    try {
      globalPayload = JSON.parse(readFileSync(process.argv[2], "utf8"));
      scopedPayload = JSON.parse(readFileSync(process.argv[3], "utf8"));
    } catch {
      throw new Error("Invalid private response JSON");
    }
    verifyLiveCompensationPrivacy(globalPayload, scopedPayload);
    console.log("PASS: fictional production HR compensation unit privacy HTTP contract.");
  } catch (error) {
    // Do not print raw JSON, salary amounts, session tokens, or object diffs.
    console.error(error instanceof Error ? error.message : "Compensation privacy verification failed.");
    process.exitCode = 1;
  }
}
