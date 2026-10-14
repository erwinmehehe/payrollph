/**
 * P0-3 independent source review policy. Pure decisions only; no API writes.
 * Production payroll release, DB migrations and payout approvals are separate.
 */
import { tierForPath } from "../classify-pr-risk.mjs";

const SHA = /^[0-9a-f]{40}$/;
const REVIEWER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const HUMAN_PERMISSIONS = new Set(["write", "maintain", "admin"]);
const DECISIVE_REVIEW = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
const MAX_FILES = 3000;

const ALWAYS_SENSITIVE = [
  /^drizzle\//,
  /^src\/db\//,
  /^src\/lib\/(?:payroll(?:-|\.|$)|final-pay|wage-order|statutory|bank-|government-id-|payout-|paymongo|xendit|payment|separation|approval|audit-|scheduler|worker-)/,
  /^src\/app\/api\/(?:payroll|payroll-runs|payout|approvals|separation|bank|webhooks\/(?:paymongo|xendit))/,
  /^src\/components\/workspace\/(?:payroll|approvals|payslip|compensation|bank|audit)/,
  /^scripts\/(?:worker\.ts|.*(?:payroll|payout|bank|migration|review|scheduler|encrypt|release))/,
  /^\.github\/(?:CODEOWNERS|workflows\/)/,
  /^docs\/engineering\/(?:change-risk-policy|pr-queue-operating-model|independent-review-gate)\.md$/,
  /^tests\/.*(?:payroll|payout|bank|financial|review|approval|migration|scheduler).*\.test\.(?:ts|mjs)$/,
];

// One narrow development-only source-evidence lane for WFM-12. This does NOT
// permit runtime behavior, new tests, migrations, operational pilot activation,
// environment flags, or payroll release. Every GitHub file must be MODIFIED.
const WFM12_DEV_EVIDENCE_FILES = new Set([
  "scripts/wfm-pilot-synthetic-evidence.mjs",
  "tests/wfm-roster-scale-postgres.test.ts",
]);
function isExactWfm12DevelopmentEvidence(files) {
  if (files.length !== WFM12_DEV_EVIDENCE_FILES.size) return false;
  const actual = new Set(files.map(file => file.filename));
  return actual.size === WFM12_DEV_EVIDENCE_FILES.size
    && files.every(file => file.status === "modified"
      && WFM12_DEV_EVIDENCE_FILES.has(file.filename));
}

// One additional exact development acceptance artifact, reviewed as immutable
// content rather than trusting filenames. Any changed byte or added file must
// return to P0-3's pilot freeze; this is never runtime/payout authorization.
const WFM5_DEV_PINNED_BLOBS = new Map([
  [".github/workflows/wfm-five-worker-dev-acceptance.yml", "f925a4d6e14ca02676b9a381a3f35dd5a52fd2eb"],
  ["docs/wfm-five-worker-development-acceptance.md", "2bdb7bf9f9f92855f6ce04323af531f0d4a1f96a"],
  ["scripts/qa/wfm-five-worker-dev-acceptance.ts", "fea3ed7ad0d2142a2828cdfdf0725aacc92c489c"],
]);
function isPinnedWfmFiveWorkerDevEvidence(files) {
  if (files.length !== WFM5_DEV_PINNED_BLOBS.size) return false;
  const uniquePaths = new Set(files.map(file => file.filename));
  return uniquePaths.size === WFM5_DEV_PINNED_BLOBS.size
    && files.every(file => file.status === "added"
      && typeof file.sha === "string"
      && WFM5_DEV_PINNED_BLOBS.get(file.filename) === file.sha);
}

// Reviewed exact-blob exception PROPOSAL for #969: offline WFM-691 witness
// packet only. No flags, runtime, DB, live device, human signoff or release.
// The original files must be ADDED unchanged; extra paths fail closed.
const WFM691_WITNESS_PINNED_BLOBS = new Map([
  ["docs/qa/wfm-691-independent-witness-handoff.md", "4cbcc7bb09e21e0d836f4d52fb17750273bdd2bc"],
  ["scripts/qa/wfm-independent-witness.mjs", "ed923d4bead1dab6f98583b59435fc494a773d1b"],
  ["tests/wfm-independent-witness.test.mjs", "5dbfc80577b30365cf17573c1d19693cdb9ce3a0"],
]);
function isPinnedWfm691WitnessDevEvidence(files) {
  if (files.length !== WFM691_WITNESS_PINNED_BLOBS.size) return false;
  const unique = new Set(files.map(file => file.filename));
  return unique.size === WFM691_WITNESS_PINNED_BLOBS.size
    && files.every(file => file.status === "added"
      && typeof file.sha === "string"
      && WFM691_WITNESS_PINNED_BLOBS.get(file.filename) === file.sha);
}

/**
 * Exact, development-only source fixture exception proposal for #965.
 * This is a three-file TEST correction for the already-split CSV import.
 * Every tracked Git blob must match the independently inspected PR #965 HEAD.
 * Any runtime, schema, extra test, changed byte or Git rename remains frozen.
 */
const HCM_INTAKE_REGRESSIONS_PINNED_BLOBS = new Map([
  ["tests/hcm-direct-route-policy-races.test.ts", "c986dc63f7e490a4e8ec3360f56d2f0a49525539"],
  ["tests/hcm-governed-intake.test.ts", "94f9523c257a3b603ab726f61b5b80b11ff6e212"],
  ["tests/hcm-legacy-write-integration.test.ts", "ba929f96c369fc9db00e414ae360bf7ee2c4e4ea"],
]);
function isPinnedHcmIntakeRegressionDevEvidence(files) {
  if (files.length !== HCM_INTAKE_REGRESSIONS_PINNED_BLOBS.size) return false;
  const unique = new Set(files.map(file => file.filename));
  return unique.size === HCM_INTAKE_REGRESSIONS_PINNED_BLOBS.size
    && files.every(file => file.status === "modified"
      && typeof file.sha === "string"
      && HCM_INTAKE_REGRESSIONS_PINNED_BLOBS.get(file.filename) === file.sha);
}

// Owner-approved #925 source-only exception. Entire delta, including schema and
// default-OFF flag, is immutable. No production activation or migration approval.
const APPLICANT_PRIVACY_PINNED_FILES = [
  {
    "filename": "docs/engineering/migration-proposals/recruitment-applicant-privacy.sql",
    "status": "added",
    "sha": "1554b2c899f1606941a81de6fe4320e9c23f85e2"
  },
  {
    "filename": "scripts/qa/nine-stage-mobile-browser.mjs",
    "status": "modified",
    "sha": "22d7208a9bcf632b4a88ae97a06360535478b74f"
  },
  {
    "filename": "src/app/api/recruitment/hire/route.ts",
    "status": "modified",
    "sha": "c9cd681a0ae23a35188c42a853647400957f9d87"
  },
  {
    "filename": "src/app/api/recruitment/privacy/route.ts",
    "status": "added",
    "sha": "33c77eeeb06c449a58e98d9e07b4058b08a2f1f3"
  },
  {
    "filename": "src/app/api/recruitment/route.ts",
    "status": "modified",
    "sha": "d54420453b3e3846a5c0c2c44ea76f308ec3ec69"
  },
  {
    "filename": "src/db/schema.ts",
    "status": "modified",
    "sha": "e52841f16ec4e292213b4c7320255fdabcce1c48"
  },
  {
    "filename": "src/lib/critical-release-flags.ts",
    "status": "modified",
    "sha": "b02ec6daf626d14a8e7e64d043f49c4719f6cce3"
  },
  {
    "filename": "src/lib/data-retention.ts",
    "status": "modified",
    "sha": "9b126db1ac1ebb4d37eab0b2b94c1fdcd56893b8"
  },
  {
    "filename": "src/lib/recruitment-applicant-copy-hold.ts",
    "status": "added",
    "sha": "d9e91de55ed731a7570c87f194370f36ef3af176"
  },
  {
    "filename": "src/lib/recruitment-applicant-privacy.ts",
    "status": "added",
    "sha": "66ffa6cc37c0a3545266b6dd40184d51b9da1779"
  },
  {
    "filename": "src/lib/recruitment-applicant-retention.ts",
    "status": "added",
    "sha": "343d75c78b7027f3372275c4ba95831e6abbe9f2"
  },
  {
    "filename": "tests/recruitment-applicant-privacy.test.ts",
    "status": "added",
    "sha": "a22afde07d4dfae53387180d101565a7084811e4"
  },
  {
    "filename": "tests/recruitment-applicant-retention-db.test.ts",
    "status": "added",
    "sha": "33dbe2855b6e04356a0991dbd457c1a8c24e242d"
  },
  {
    "filename": "tests/recruitment-privacy-route.test.ts",
    "status": "added",
    "sha": "bdd8dc98c93fce0f1720cc4fd5eec4ed86289faf"
  }
];
function isPinnedApplicantPrivacySource(files) {
  if (files.length !== APPLICANT_PRIVACY_PINNED_FILES.length || new Set(files.map(f => f.filename)).size !== files.length) return false;
  return APPLICANT_PRIVACY_PINNED_FILES.every(expected => files.some(file =>
    file.filename === expected.filename && file.status === expected.status && file.sha === expected.sha));
}

// Owner-approved #896 test-only source exception. Other frozen paths remain held.
// Bind it to the exact reviewed Spend PR and head as well as immutable test blobs.
// A new Spend commit requires a new source review; never infer pilot/production approval.
const SPEND_NAVIGATION_APPROVED_PR = 896;
const SPEND_NAVIGATION_APPROVED_HEAD = "25e025e695965e0320a52cee06372304bc39ad58";
const SPEND_NAVIGATION_TEST_BLOBS = new Map([
  ["tests/hcm-documents-policy-center.test.ts", "67e95f68dfa1166e8bd7fcf798d75d9fe28ba4b4"],
  ["tests/performance-self-assessment.test.ts", "11b9dcae1fa140559db69a3ef078ea2286334d35"],
]);
function isPinnedSpendNavigationTests(files, frozenPaths) {
  const candidates = files.filter(file => SPEND_NAVIGATION_TEST_BLOBS.has(file.filename));
  return frozenPaths.length === 2 && candidates.length === 2
    && new Set(candidates.map(file => file.filename)).size === 2
    && frozenPaths.every(path => SPEND_NAVIGATION_TEST_BLOBS.has(path))
    // No rename/copy may smuggle a previously frozen filename through the
    // Set of frozen paths or rebind either pinned test to a new file.
    && files.every(file => file.status !== "renamed" && file.status !== "copied"
      && file.previous_filename == null)
    && candidates.every(file => file.status === "modified"
      && file.sha === SPEND_NAVIGATION_TEST_BLOBS.get(file.filename));
}

export function isApprovedSpendNavigationSource(pr, scope) {
  return pr?.number === SPEND_NAVIGATION_APPROVED_PR &&
    pr?.head?.sha === SPEND_NAVIGATION_APPROVED_HEAD &&
    scope?.spendNavigationTests === true;
}

// Owner-approved #963 source-only isolation hardening. Complete diff and head
// are immutable; this never lifts HCM runtime/worker or production holds.
const HCM_ISOLATION_APPROVED_FILES = [
  {
    "filename": ".github/workflows/multi-entity-browser-qa.yml",
    "status": "modified",
    "sha": "8010de61b6ecd2cc07fba10a59c5a4d186a3a163"
  },
  {
    "filename": "docs/qa/multi-entity-hcm-development-acceptance.md",
    "status": "added",
    "sha": "725af599a2a62ce7fb1f21b2e41f05760bed4bef"
  },
  {
    "filename": "scripts/ess-profile-synthetic-browser.mjs",
    "status": "modified",
    "sha": "405381550ea44af4995dc6152981571b70858f11"
  },
  {
    "filename": "scripts/hcm-request-lifecycle-browser.mjs",
    "status": "modified",
    "sha": "2bfc7cf619d0d75ee56ef17135414eb201c63bed"
  },
  {
    "filename": "src/app/api/hcm/effective-changes/route.ts",
    "status": "modified",
    "sha": "fb4bd6692a33a2130f0ec369fedc854334e718db"
  },
  {
    "filename": "src/app/api/hcm/lifecycle-readiness/route.ts",
    "status": "modified",
    "sha": "a093e0edcbfbed3d07752ee89717abc4a069810f"
  },
  {
    "filename": "src/app/api/hcm/people-operations-inbox/route.ts",
    "status": "modified",
    "sha": "71d8f6510ceb2dce1316a04bebf0bff6553cf4e2"
  },
  {
    "filename": "src/components/hcm-employment-lifecycle-action-center.tsx",
    "status": "modified",
    "sha": "fc7cd323e2ea1c851207cd3b3ff37ed33c4b8c80"
  },
  {
    "filename": "src/components/hcm-people-operations-inbox.tsx",
    "status": "modified",
    "sha": "abf4a0cab717f41618913eb96f581ef2a95775d7"
  },
  {
    "filename": "src/components/workspace/people.tsx",
    "status": "modified",
    "sha": "66265f277742ec0159a7699fe367cba63687ce48"
  },
  {
    "filename": "src/lib/hcm-client-employer-scope.ts",
    "status": "added",
    "sha": "5d85973f9b5a95767a0e63644aa2ec4413094eff"
  },
  {
    "filename": "src/lib/hcm-effective-changes.ts",
    "status": "modified",
    "sha": "5e11f82d184a135012955ddee79998ac0fa4481d"
  },
  {
    "filename": "src/lib/hcm-lifecycle-readiness-server.ts",
    "status": "modified",
    "sha": "2c4665b9ddf691a615dd75484d41c47495f48730"
  },
  {
    "filename": "src/lib/hcm-people-operations-inbox-server.ts",
    "status": "modified",
    "sha": "6a86c8c719f21deba0b97372a273450274475207"
  },
  {
    "filename": "tests/fixtures/hcm-request-lifecycle.jsx",
    "status": "modified",
    "sha": "90681980f7bb997a4fa13bf1b101d04e10a778b5"
  },
  {
    "filename": "tests/hcm-client-employer-scope.test.ts",
    "status": "added",
    "sha": "a9776ee4f4211f57ec4016fcf1cfca8a565e6205"
  },
  {
    "filename": "tests/hcm-people-intelligence.test.ts",
    "status": "modified",
    "sha": "e6dd544c5597bf4a31586fe12723edfa9ad31893"
  },
  {
    "filename": "tests/hcm-people-operations-inbox.test.ts",
    "status": "modified",
    "sha": "bc3d6fe973449b480745675741d642a9031d38bb"
  },
  {
    "filename": "tests/hcm-people-ops-daily-triage.test.ts",
    "status": "modified",
    "sha": "0d01a88ba391588c6c6001fb5ba87b260e2a0960"
  },
  {
    "filename": "tests/multi-entity-isolation-db.test.ts",
    "status": "modified",
    "sha": "361ba2cfcd23e12df3773794ac6439df2767c34a"
  },
  {
    "filename": "tests/workforce-enterprise-analytics.test.ts",
    "status": "modified",
    "sha": "36abb56cf1fd137c2a174b15984e3ace011bf834"
  }
];
export function isApprovedHcmIsolationSource(pr, files) {
  return pr?.number === 963
    && pr?.head?.sha === "2c0dc90e1cc6994928cd43eaabe250380ca554ce"
    && files.length === HCM_ISOLATION_APPROVED_FILES.length
    && new Set(files.map(file => file.filename)).size === files.length
    && files.every(file => file.previous_filename == null)
    && HCM_ISOLATION_APPROVED_FILES.every(expected => files.some(file =>
      file.filename === expected.filename && file.status === expected.status
      && file.sha === expected.sha));
}

// Owner-authorized #902 development-only A5 vault source exception, pinned
// to the exact 24/24-green source HEAD and the ENTIRE 34-file reviewed delta.
// Neither the solo-maintainer setting nor this exception authorizes payroll,
// HCM/WFM unfreeze beyond these bytes, production DDL, external document
// storage, migrations, money movement, or downstream deployment.
// A newer A5 head, changed file, renamed/moved path or hidden extra file
// MUST return to the existing source freeze.
const VAULT902_APPROVED_HEAD = "94435b43f98de209065a373d4959af3db8e14b69";
const VAULT902_APPROVED_FILES = [
  { filename: ".github/workflows/a5-private-object-acceptance.yml", status: "added", sha: "f4c43d83b740afad65763fb24674682664f0ae1f" },
  { filename: ".github/workflows/a5-vault-migration-rehearsal.yml", status: "added", sha: "ad4052c14e5a9dee8908835100cb526a66e643a2" },
  { filename: ".github/workflows/a5-vault-minio-acceptance.yml", status: "added", sha: "92a37ff962a13cf3d6603ffcc4b528c9a358d367" },
  { filename: "docs/engineering/employee-document-vault-migration-plan.md", status: "added", sha: "b890cd26ff47b332340b3928d31c3733f16ea57a" },
  { filename: "docs/engineering/employee-vault-independent-acceptance.md", status: "added", sha: "724d4b948e7bc0176a01b8e551d46e4d6f19bfc3" },
  { filename: "docs/engineering/migration-proposals/employee-document-vault-a5.sql", status: "added", sha: "e24dd2af2a60ad1d33c45dac65e9a7751e5274b4" },
  { filename: "scripts/a5-local-private-object-acceptance.ts", status: "added", sha: "f69bfbf41f7eb7f1ef88be6fe75fce49ec616a02" },
  { filename: "scripts/accept-private-employee-vault-minio.ts", status: "added", sha: "0880aeed4c685f3409c490db84ac211cae0012aa" },
  { filename: "scripts/check-a5-legacy-document-schema.ts", status: "added", sha: "c91cc885eec1c3b584584399e11862766d8570db" },
  { filename: "scripts/rehearse-employee-document-vault-migration.cjs", status: "added", sha: "7d4ec4ca4f4fca2dcc432d9eb41211b7623b026a" },
  { filename: "src/app/api/documents/route.ts", status: "modified", sha: "41236b2e6f734590ea092869261851d3d6b6800c" },
  { filename: "src/app/api/hcm/documents/route.ts", status: "modified", sha: "cdf57b3fff05f228676916497fa91e413f5d0a84" },
  { filename: "src/app/api/self/documents/route.ts", status: "modified", sha: "30ba92e5095e9244a3892906b014a45eba3e0f2a" },
  { filename: "src/components/employee-documents-panel.tsx", status: "modified", sha: "cc4d9ba3c3d7ba726aa739bb98b42575611cd3ac" },
  { filename: "src/components/hcm-documents-panel.tsx", status: "modified", sha: "c79110a5e382e31ea597f16deb697a38a0b55371" },
  { filename: "src/db/schema.ts", status: "modified", sha: "24a1a4138285af40b308b86c7f05584521b5e812" },
  { filename: "src/lib/automation-document-generation.ts", status: "modified", sha: "441bcddb0e7347d5430a665bc0e87e14725b9e13" },
  { filename: "src/lib/data-retention.ts", status: "modified", sha: "475b5a160b0754746b52dce00741c1c244ac4fe2" },
  { filename: "src/lib/document-object-storage.ts", status: "modified", sha: "649f9d862abca126e37f1ba751d285a7093c4c3d" },
  { filename: "src/lib/document-schema-compat.ts", status: "modified", sha: "5792b12e5b250327fd2cac05d170f00a7042b120" },
  { filename: "src/lib/employee-document-vault-verification.ts", status: "added", sha: "8a22aff65a59eae3b3c04dc9ad8d1b292e009c42" },
  { filename: "src/lib/employee-vault-object-reconciliation.ts", status: "added", sha: "0b1813421cdef8f32747145db4697745cc31d3a7" },
  { filename: "src/lib/hcm-documents.ts", status: "modified", sha: "7a40bd59f1a8308d67c3eb7f4ce750545aad4c36" },
  { filename: "tests/a4-a5-retention-schema-regression.test.ts", status: "added", sha: "ce77d4bb40fa178711b29bc0b001c89918cf8b42" },
  { filename: "tests/automation-document-generation.test.ts", status: "modified", sha: "adc93abc5e754b002fbd01fb360432d21737ebb8" },
  { filename: "tests/employee-document-expiry-integration.test.ts", status: "added", sha: "4e4a64d91f28f38093766ac8dbd8174882b35325" },
  { filename: "tests/employee-document-vault-generated.test.ts", status: "added", sha: "869aac6077808bdb42d3d7cfd33f9c9daf4204cc" },
  { filename: "tests/employee-document-vault-verification.test.ts", status: "added", sha: "b5dcfa9491a8fad40031e069cd10cfd64c41bc46" },
  { filename: "tests/employee-document-vault.test.ts", status: "added", sha: "e83c2c8355155d3ea1dbc3942a0a8fd35e60a12b" },
  { filename: "tests/employee-vault-ess-link-isolation.test.ts", status: "added", sha: "8fcf1eff3a03cc5fcb8d12ba34d7c6ecb0e184ba" },
  { filename: "tests/employee-vault-ess-policy-link-isolation.test.ts", status: "added", sha: "b57977a1eb5452a48d54241d348d93ff6a9eca87" },
  { filename: "tests/employee-vault-flag-rollback.test.ts", status: "added", sha: "e08e88196c7e2e3f83582077a7b23aba3491d9b2" },
  { filename: "tests/employee-vault-object-reconciliation.test.ts", status: "added", sha: "1cc825fa34bc580317358f32e3e547d88ead58f7" },
  { filename: "tests/fixtures/minio/Dockerfile", status: "added", sha: "0a40a53628c27562627ef579e021cea995581100" },
];
export function isApprovedVault902Source(pr, files) {
  return pr?.number === 902 && pr?.head?.sha === VAULT902_APPROVED_HEAD &&
    pr?.base?.ref === "main" && Array.isArray(files) &&
    files.length === VAULT902_APPROVED_FILES.length &&
    new Set(files.map(file => file.filename)).size === files.length &&
    files.every(file => file.previous_filename == null &&
      file.status !== "renamed" && file.status !== "copied") &&
    VAULT902_APPROVED_FILES.every(expected => files.some(file =>
      file.filename === expected.filename &&
      file.status === expected.status &&
      file.sha === expected.sha));
}

const FROZEN_LANES = [
  // Treat every component of the exact #969 offline witness set as frozen.
  // Otherwise dropping the test file leaves the docs and QA script outside
  // the existing WFM path classifiers and bypasses the three-file guarantee.
  /^docs\/qa\/wfm-691-independent-witness-handoff\.md$/,
  /^scripts\/qa\/wfm-independent-witness\.mjs$/,
  /^src\/lib\/(?:hcm-|workforce-|wfm-|compensation-|performance-)/,
  /^src\/app\/api\/(?:hcm|workforce|recruitment|talent|compensation|performance|planning)\//,
  /^src\/components\/(?:hcm-|wfm-|workforce-|compensation-|performance-)/,
  /^src\/components\/workspace\/(?:hcm|wfm|talent|worker-360|planning|compensation|performance|coverage|workforce)/,
  /^tests\/(?:hcm-|wfm-|workforce-|compensation-|performance-)/,
  /^scripts\/(?:hcm-|wfm-|workforce-|compensation-|performance-|recruitment-)/,
  /^\.github\/workflows\/(?:hcm-|wfm-|workforce-|compensation-|performance-)/,
  /^drizzle\/[0-9]{4}_(?:hcm|wfm|workforce|compensation|performance)_/,
];

function refuse(message) { throw new Error("REVIEW_GATE_" + message); }
function validPath(path) {
  if (typeof path !== "string" || path.length > 1024 || path.length < 1 ||
      path.startsWith("/") || path.includes("\0") || path.includes("\\") ||
      path.split("/").some(section => section === ".." || section === ".")) {
    refuse("INVALID_CHANGED_PATH");
  }
  return path;
}

export function classifyReviewScope(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length >= MAX_FILES) {
    refuse("FILES_MISSING_OR_TRUNCATED");
  }
  const paths = new Set();
  for (const item of files) {
    if (!item || typeof item !== "object") refuse("INVALID_CHANGED_FILE");
    paths.add(validPath(item.filename));
    if (item.status === "renamed") {
      paths.add(validPath(item.previous_filename));
    }
  }
  const list = [...paths];
  const frozenPaths = list.filter(path => FROZEN_LANES.some(regex => regex.test(path)));
  // Owner-approved #888 compatibility correction, not new HCM functionality.
  // Only this exact modified blob may cross the freeze; any other frozen path,
  // rename, changed byte, absent SHA or duplicate restores the normal hold.
  const legacyEvidencePath = "src/app/api/hcm/employment-term-decisions/[id]/evidence/route.ts";
  const legacyEvidenceFiles = files.filter(file => file.filename === legacyEvidencePath);
  const hrDocumentLegacyCompatibility = frozenPaths.length === 1 &&
    frozenPaths[0] === legacyEvidencePath && legacyEvidenceFiles.length === 1 &&
    legacyEvidenceFiles[0].status === "modified" &&
    legacyEvidenceFiles[0].sha === "49957255191041ee83440bd7f24ea5cfd72d491c";
  const wfm12DevEvidence = isExactWfm12DevelopmentEvidence(files);
  const wfmFiveWorkerDevEvidence = isPinnedWfmFiveWorkerDevEvidence(files);
  const wfm691WitnessDevEvidence = isPinnedWfm691WitnessDevEvidence(files);
  const hcmIntakeRegressionDevEvidence = isPinnedHcmIntakeRegressionDevEvidence(files);
  const applicantPrivacySource = isPinnedApplicantPrivacySource(files);
  const spendNavigationTests = isPinnedSpendNavigationTests(files, frozenPaths);
  const sensitivePaths = list.filter(path =>
    ALWAYS_SENSITIVE.some(regex => regex.test(path)) ||
    ["T2", "T3"].includes(tierForPath(path)));
  return {
    fileCount: files.length,
    requiresIndependentHuman: sensitivePaths.length > 0,
    hcmWfmFrozen: frozenPaths.length > 0,
    wfm12DevEvidence,
    wfmFiveWorkerDevEvidence,
    wfm691WitnessDevEvidence,
    hcmIntakeRegressionDevEvidence,
    hrDocumentLegacyCompatibility,
    applicantPrivacySource,
    spendNavigationTests,
    sensitiveFileCount: sensitivePaths.length,
    frozenFileCount: frozenPaths.length,
  };
}

export function allowedHumanReviewerLogins(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  if (raw.length > 512 || /[\r\n]/.test(raw)) refuse("INVALID_REVIEWER_ALLOWLIST");
  const names = raw.split(",").map(v => v.trim().toLowerCase());
  if (names.length > 10 || names.some(name =>
    !REVIEWER.test(name) || name.endsWith("-bot") || name.endsWith("[bot]"))) {
    refuse("INVALID_REVIEWER_ALLOWLIST");
  }
  const unique = new Set(names);
  if (unique.size !== names.length) refuse("DUPLICATE_REVIEWER_ALLOWLIST");
  return [...unique];
}

function latestDecisiveByLogin(reviews) {
  if (!Array.isArray(reviews) || reviews.length > 500) refuse("REVIEWS_MISSING_OR_TRUNCATED");
  const latest = new Map();
  for (const review of reviews) {
    const login = review?.user?.login;
    if (typeof login !== "string" || !REVIEWER.test(login.toLowerCase()) ||
        !DECISIVE_REVIEW.has(review.state)) continue;
    if (!Number.isSafeInteger(review.id) || review.id <= 0 ||
        typeof review.submitted_at !== "string" ||
        !Number.isFinite(Date.parse(review.submitted_at))) {
      refuse("INVALID_DECISIVE_REVIEW");
    }
    const key = login.toLowerCase();
    const prev = latest.get(key);
    if (!prev || review.id > prev.id) latest.set(key, review);
  }
  return latest;
}

/**
 * Scope is derived ONLY from GitHub's full changed-file list. A source PR
 * cannot supply reviewers or pilot authorization by editing its own files.
 */
export function evaluateIndependentReview({
  pr, files, reviews, expectedHeadSha, reviewerAllowlist = "",
  permissions = {}, pilotStarted = "", pilotEvidenceRef = "",
}) {
  if (!pr || pr.state !== "open" || pr.base?.ref !== "main" ||
      !SHA.test(expectedHeadSha ?? "") ||
      pr.head?.sha !== expectedHeadSha || !SHA.test(pr.head.sha) ||
      typeof pr.user?.login !== "string" ||
      !Number.isSafeInteger(pr.changed_files) ||
      pr.changed_files !== files?.length) {
    refuse("PR_HEAD_OR_FILE_SET_UNVERIFIED");
  }
  const scope = classifyReviewScope(files);
  const blockers = [];
  if (scope.hcmWfmFrozen && !scope.wfm12DevEvidence &&
      !scope.wfmFiveWorkerDevEvidence && !scope.wfm691WitnessDevEvidence &&
       !scope.hcmIntakeRegressionDevEvidence && !scope.hrDocumentLegacyCompatibility && !scope.applicantPrivacySource && !isApprovedSpendNavigationSource(pr, scope) && !isApprovedHcmIsolationSource(pr, files) && !isApprovedVault902Source(pr, files) &&
      (pilotStarted !== "true" ||
       typeof pilotEvidenceRef !== "string" ||
       !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,119}$/.test(pilotEvidenceRef))) {
    blockers.push("PILOT_HCM_WFM_FREEZE_ACTIVE");
  }
  if (scope.requiresIndependentHuman) {
    if (pr.draft) blockers.push("SENSITIVE_PR_STILL_DRAFT");
    const names = allowedHumanReviewerLogins(reviewerAllowlist);
    if (names.length === 0) blockers.push("NAMED_REVIEWER_NOT_CONFIGURED");
    const latest = latestDecisiveByLogin(reviews);
    let accepted = 0;
    let veto = false;
    for (const name of names) {
      if (name === pr.user.login.toLowerCase()) continue;
      const review = latest.get(name);
      if (!review) continue;
      if (review.state === "CHANGES_REQUESTED") veto = true;
      if (review.state !== "APPROVED" ||
          review.commit_id !== expectedHeadSha ||
          review.user?.type !== "User" ||
          !HUMAN_PERMISSIONS.has(permissions[name])) continue;
      accepted += 1;
    }
    if (veto) blockers.push("INDEPENDENT_REVIEW_CHANGE_REQUESTED");
    if (accepted < 1) blockers.push("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED");
  }
  return {
    ok: blockers.length === 0,
    scope,
    approvalCount: scope.requiresIndependentHuman && blockers.includes("CURRENT_HEAD_INDEPENDENT_APPROVAL_REQUIRED") ? 0
      : scope.requiresIndependentHuman ? 1 : 0,
    blockers,
    releaseAuthorized: false,
  };
}
