import { execFileSync } from "node:child_process";

const baseSha = process.env.PAYOUT_GUARD_BASE_SHA?.trim();
const headSha = process.env.PAYOUT_GUARD_HEAD_SHA?.trim();

if (!baseSha || !headSha) {
  console.error("Payout/payroll isolation requires PAYOUT_GUARD_BASE_SHA and PAYOUT_GUARD_HEAD_SHA.");
  process.exit(2);
}

const changedFiles = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=ACMR", baseSha, headSha],
  { encoding: "utf8" },
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const payoutPatterns = [
  /^src\/app\/api\/compliance\/bank-validations\//,
  /^src\/app\/api\/payout-destination-changes\//,
  /^src\/app\/api\/treasury-controls\//,
  /^src\/app\/api\/webhooks\/paymongo\//,
  /^src\/app\/api\/payroll-runs\/\[id\]\/exports\//,
  /^src\/app\/api\/payroll-runs\/\[id\]\/payout-reconciliation\//,
  /^src\/components\/treasury-controls-panel\.tsx$/,
  /^src\/components\/workspace\/exports\.tsx$/,
  /^src\/components\/workspace\/people\.tsx$/,
  /^src\/lib\/bank-/,
  /^src\/lib\/paymongo/,
  /^src\/lib\/payout-/,
  /^src\/lib\/payroll-payout-/,
  /^src\/lib\/treasury-/,
  /^src\/lib\/exporters\.ts$/,
  /^drizzle\/\d+_.*(?:bank|payout|treasury).*\.sql$/,
  /^tests\/.*(?:bank|paymongo|payout|treasury).*\.test\.ts$/,
];

const protectedPayrollPatterns = [
  /^src\/lib\/payroll-engine\.ts$/,
  /^src\/lib\/payroll-rules\.ts$/,
  /^src\/lib\/pay-policy-engine\.ts$/,
  /^src\/lib\/workforce-payroll\.ts$/,
  /^src\/lib\/leave-payroll\.ts$/,
  /^src\/lib\/payroll-calendar\.ts$/,
  /^scripts\/golden-payroll-certification\.ts$/,
  /^scripts\/golden-payroll-phase2a\.ts$/,
  /^scripts\/golden-payroll-phase2b\.ts$/,
  /^scripts\/golden-pay-rules-phase3\.ts$/,
  /^certification\/golden-payroll-phase2a\.json$/,
  /^certification\/golden-payroll-phase2b\.json$/,
  /^certification\/golden-pay-rules-phase3\.json$/,
  /^tests\/fixtures\/open-payroll-data\//,
  /^tests\/pay-policy-golden-reconciliation\.test\.ts$/,
  /^tests\/rates-crosscheck\.test\.ts$/,
  /^tests\/premium-pay-crosscheck\.test\.ts$/,
  /^tests\/wage-13th-crosscheck\.test\.ts$/,
];

const matchesAny = (path: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(path));
const payoutFiles = changedFiles.filter((path) => matchesAny(path, payoutPatterns));
const protectedPayrollFiles = changedFiles.filter((path) => matchesAny(path, protectedPayrollPatterns));

console.log(`Payout/payroll isolation: ${changedFiles.length} changed file(s), ${payoutFiles.length} payout/banking file(s).`);

if (payoutFiles.length === 0) {
  console.log("No payout/banking changes detected; isolation boundary does not apply.");
  process.exit(0);
}

if (protectedPayrollFiles.length > 0) {
  console.error("");
  console.error("PAYOUT/PAYROLL ISOLATION FAILED");
  console.error("This pull request changes payout/banking code and protected payroll computation or certification files.");
  console.error("Keep money-movement work below the released-payroll boundary. Split payroll math changes into a separate pull request.");
  console.error("");
  console.error("Protected files changed:");
  for (const path of protectedPayrollFiles) console.error(` - ${path}`);
  console.error("");
  console.error("The regular CI job will still run golden payroll and statutory regression suites, but those baselines may not be changed in the same payout PR.");
  process.exit(1);
}

console.log("Isolation boundary passed: payout/banking changes do not modify protected payroll computation or golden-certification baselines.");
