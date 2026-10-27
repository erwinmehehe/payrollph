import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MONEY = [
  "treasury-isolation.yml",
  "paymongo-export-isolation.yml",
  "underpayment-posting.yml",
  "tenant-money-lifecycle.yml",
];
const ALL = [...MONEY, "public-intake-db-acceptance.yml"];

function readWorkflow(filename) {
  return readFileSync(
    new URL("../.github/workflows/" + filename, import.meta.url), "utf8",
  );
}

function pullRequestPaths(filename) {
  const workflow = readWorkflow(filename);
  const begin = workflow.indexOf("\n  pull_request:\n");
  assert.ok(begin >= 0, filename + ": missing pull_request");
  const remaining = workflow.slice(begin + "\n  pull_request:\n".length);
  const boundaries = [
    remaining.indexOf("\n  push:\n"),
    remaining.indexOf("\n  workflow_dispatch:\n"),
    remaining.indexOf("\n  schedule:\n"),
  ].filter((index) => index >= 0);
  assert.ok(boundaries.length > 0, filename + ": missing next event boundary");
  const block = remaining.slice(0, Math.min(...boundaries));
  assert.match(block, /^    branches: \[main\]$/m, filename);
  assert.match(block, /^    paths:$/m, filename);
  const paths = [...block.matchAll(/^      - '([^']+)'$/gm)].map((match) => match[1]);
  assert.ok(paths.length > 0, filename + ": missing path filters");
  return paths;
}

// All workflow globs are intentionally limited to literal paths, * and **.
// This matcher tests those supported forms without adding a new dependency.
function matchGlob(pattern, file) {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i++;
      } else {
        regex += "[^/]*";
      }
    } else if (ch === "?") {
      regex += "[^/]";
    } else {
      regex += ".+^$()[]{}|\\".includes(ch) ? "\\" + ch : ch;
    }
  }
  return new RegExp(regex + "$").test(file);
}

function workflowsForFile(path) {
  return ALL.filter((filename) =>
    pullRequestPaths(filename).some((pattern) => matchGlob(pattern, path)));
}

test("optional heavy workflows retain main/manual coverage and self-triggers", () => {
  const disallowed = new Set(["**", "src/**", "scripts/**", "tests/**", "public/**", ".github/**"]);
  for (const filename of ALL) {
    const source = readWorkflow(filename);
    const paths = pullRequestPaths(filename);
    assert.ok(paths.includes(".github/workflows/" + filename), filename);
    assert.ok(paths.every((p) => !p.startsWith("!")), filename + ": unexpected negative pattern");
    assert.ok(paths.every((p) => !disallowed.has(p)), filename + ": broad path filter");
    assert.match(source, /\n  workflow_dispatch:\n/, filename);
    if (MONEY.includes(filename)) {
      assert.match(source, /\n  push:\n    branches: \[main\]/, filename);
    } else {
      assert.doesNotMatch(source, /\n  push:\n/, filename);
    }
  }
});

test("unrelated edits do not launch expensive module-specific workflows", () => {
  for (const path of [
    "README.md",
    ".github/workflows/ci.yml",
    "tests/unrelated.test.ts",
    "src/components/marketing/site-chrome.tsx",
    "src/app/api/health/route.ts",
  ]) assert.deepEqual(workflowsForFile(path), [], path);
});

test("shared auth, schema, and dependency changes keep complete coverage", () => {
  for (const path of [
    "src/lib/auth.ts",
    "src/lib/access.ts",
    "src/db/schema.ts",
    "drizzle/0200_finance.sql",
    "package-lock.json",
    "src/app/api/organizations/route.ts",
  ]) assert.deepEqual(workflowsForFile(path), ALL, path);
});

test("money-sensitive code runs relevant suites without launching public intake", () => {
  for (const path of [
    "src/app/api/payroll-runs/route.ts",
    "src/lib/payroll-engine.ts",
    "src/app/api/approvals/123/route.ts",
  ]) assert.deepEqual(workflowsForFile(path), MONEY, path);
  assert.deepEqual(workflowsForFile("src/lib/paymongo-disbursements.ts"), MONEY.slice(0, 2));
  assert.deepEqual(workflowsForFile("src/lib/underpayment-duplicate.ts"), MONEY.slice(2, 4));
  assert.deepEqual(workflowsForFile("src/app/api/treasury-controls/route.ts"), MONEY.slice(0, 3));
  assert.deepEqual(workflowsForFile(".github/workflows/underpayment-posting.yml"), [MONEY[2]]);
});

test("public intake routes and the proposal SQL only run the intake suite", () => {
  const intake = [ALL[4]];
  for (const path of [
    "src/app/api/demo-requests/route.ts",
    "src/app/api/intake-challenge/route.ts",
    "src/app/api/payroll-outsourcing/quote/route.ts",
    "src/app/api/careers/admin/route.ts",
    "src/lib/marketing-consent.ts",
    "scripts/public-intake-db-acceptance.ts",
    "tests/careers-http-postgres.test.ts",
    "docs/engineering/migration-proposals/careers-published.sql",
  ]) assert.deepEqual(workflowsForFile(path), intake, path);
});

test("browser acceptance installs version-pinned headless Chromium without Ubuntu apt updates", () => {
  const browserWorkflows = [
      "employee-import-browser-acceptance.yml",
      "core-modules-browser-acceptance.yml",
      "ess-profile-browser-acceptance.yml",
      "spend-reimbursement-ui.yml",
      "nav-runtime-sweep.yml",
      "preview-browser-qa.yml",
      "multi-entity-browser-qa.yml",
      "hcm-process-monitor-browser-qa.yml",
      "employee-vault-profile-browser-acceptance.yml"
  ];
  for (const filename of browserWorkflows) {
    const source = readWorkflow(filename);
    const installLine = source.split("\n").find(line => line.includes("npm install --no-save") && line.includes("playwright@"));
    assert.ok(installLine, filename + ": missing pinned Playwright installation");
    assert.ok(installLine.includes("--ignore-scripts"), filename + ": lifecycle scripts must remain disabled");
    assert.match(installLine, /playwright@[0-9]+[.][0-9]+[.][0-9]+/, filename + ": Playwright version must be pinned");
    assert.match(source, /timeout 240s npx playwright install --only-shell chromium/, filename + ": cap Chromium-only download");
    assert.doesNotMatch(source, /playwright install --with-deps/, filename + ": avoid apt mirrors on stock GitHub runners");
  }
});

test("Spend component browser runs for its real dependencies, not every source edit", () => {
  const source = readWorkflow("spend-reimbursement-ui.yml");
  const from = source.indexOf("\n  pull_request:\n");
  const to = source.indexOf("\n  workflow_dispatch:\n", from);
  assert.ok(from >= 0 && to > from, "Spend PR event and manual dispatch must remain present");
  const eventBlock = source.slice(from, to);
  const paths = [...eventBlock.matchAll(/^      - '([^']+)'$/gm)].map(match => match[1]);
  assert.ok(paths.length > 0 && !paths.includes("src/**"), "Spend needs narrower PR paths");
  const runsFor = path => paths.some(pattern => matchGlob(pattern, path));
  for (const path of [
    "src/components/wallet-panel.tsx",
    "src/lib/expense-claim-communication.ts",
    "src/lib/scoped-employee-directory.ts",
    "src/app/api/expenses/route.ts",
    "src/app/api/employees/import/route.ts",
    "src/app/globals.css",
    "src/lib/auth.ts",
    "src/db/schema.ts",
    "package-lock.json",
    "src/components/linaw-workspace.tsx",
    ".github/workflows/spend-reimbursement-ui.yml",
    "tests/fixtures/spend-reimbursement-browser.jsx",
  ]) assert.ok(runsFor(path), "missing Spend trigger for " + path);
  for (const path of [
    "README.md",
    "docs/qa/unrelated.md",
    "src/app/hcm/business-processes/page.tsx",
    "src/app/api/wfm/schedules/route.ts",
    "src/lib/hcm-business-process-read.ts",
    ".github/workflows/ci.yml",
    "tests/other.test.ts",
  ]) assert.equal(runsFor(path), false, "irrelevant Spend trigger " + path);
});

test("Employee Vault synthetic browser includes the higher-ID victim employer required by the shared fixture", () => {
  const workflow = readWorkflow("employee-vault-profile-browser-acceptance.yml");
  const fixture = readFileSync(new URL("../scripts/hcm-people-home-synthetic-fixture.ts", import.meta.url), "utf8");
  assert.match(workflow, /^      HCM_PEOPLE_HOME_ORG_IDS: "1,2,3"$/m,
    "The fixture seeds three distinct employers; the vault QA must enable the real victim too");
  assert.match(workflow, /npx tsx scripts\/hcm-people-home-synthetic-fixture\.ts/,
    "Vault job must keep running the shared synthetic tenant fixture");
  assert.match(fixture, /assert\.equal\(process\.env\.HCM_PEOPLE_HOME_ORG_IDS, "1,2,3"\)/,
    "Keep the declared allowlist consistent with the fixture's fail-closed scope");
  assert.match(fixture, /assert\.ok\(victim\.id > beta\.id && victimWorker\.id > betaSecond\.id/,
    "The foreign employer and its worker must remain independently seeded higher-ID victims");
});

test("Core Modules browser authenticates each flag server independently before asserting role denial", () => {
  const browser = readFileSync(new URL("../scripts/core-modules-synthetic-browser.mjs", import.meta.url), "utf8");
  const source = readWorkflow("core-modules-browser-acceptance.yml");
  assert.match(browser, /const authKey = `\$\{role\}:\$\{state\}`/,
    "A saved session must belong to one role and one local flag server");
  assert.match(browser, /roleAuthState\.get\(authKey\)/);
  assert.match(browser, /roleAuthState\.set\(authKey, await context\.storageState\(\)\)/);
  assert.doesNotMatch(browser, /roleAuthState\.(?:get|set|has)\(role(?:,|\))/,
    "Never reuse the flag-OFF server's role-only cookie as proof on flag-ON");
  assert.match(browser, /totpCode: generateTotp\(/,
    "Both local servers must use the real MFA login path");
  assert.match(browser, /const session = await page\.evaluate\(/,
    "The signed-in principal must be verified using the real browser cookie");
  assert.match(browser, /fetch\("\/api\/auth\/me"/,
    "Check the authenticated principal on the current browser origin");
  assert.match(browser, /assert\.equal\(session\.body\.user\?\.role, role/,
    "A 401 cannot be mistaken for a valid 403 role denial");
  assert.match(browser, /const deniedStatus = await page\.evaluate\(/);
  assert.match(browser, /assert\.equal\(deniedStatus, 403/,
    "Keep the exact unauthorized-role denial requirement");
  assert.doesNotMatch(browser, /context\.request\.patch\(base \+ "\/api\/tenant-modules"/,
    "Never use a separate Node request cookie jar for this browser-denial check");
  assert.match(browser, /credentials: "same-origin"/,
    "Browser requests must carry the session cookie for this exact origin");
  const auth = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /secure: process\.env\.NODE_ENV === "production"/,
    "Test must preserve the production Secure-cookie behavior");
  assert.match(source, /REQUIRE_PRIVILEGED_MFA: 'true'/);
  assert.match(source, /CORE_MODULE_NAVIGATION_ENABLED=false npm run start/,
    "The browser must continue comparing independently configured flag-on and flag-off servers");
});

test("Employee Import browser checks a real per-server MFA principal before strict role denial", () => {
  const browser = readFileSync(new URL("../scripts/employee-import-synthetic-browser.mjs", import.meta.url), "utf8");
  const workflow = readWorkflow("employee-import-browser-acceptance.yml");
  const route = readFileSync(new URL("../src/app/api/employees/import/route.ts", import.meta.url), "utf8");
  assert.match(browser, /const authKey = `\$\{role\}:\$\{state\}`/,
    "Flag-on/off sessions must remain distinct for each fictional role");
  assert.match(browser, /authenticatedStates\.get\(authKey\)/);
  assert.match(browser, /authenticatedStates\.set\(authKey, signedInState\)/);
  assert.doesNotMatch(browser, /authenticatedStates\.(?:get|set)\(role(?:,|\))/,
    "Never reuse the flag-off cookie for the flag-on role-denial proof");
  assert.match(browser, /totpCode: generateTotp\(/, "Retain real MFA login");
  assert.match(browser, /assert\.equal\(login\.status\(\), 200/,
    "Do not accept failed or throttled authentication");
  assert.match(browser, /const session = await page\.evaluate\(/);
  assert.match(browser, /fetch\("\/api\/auth\/me"/);
  assert.match(browser, /assert\.equal\(session\.body\.user\?\.role, role/);
  assert.match(browser, /assert\.equal\(session\.body\.user\?\.email, role/);
  assert.match(browser, /const deniedStatus = await page\.evaluate\(/);
  assert.match(browser, /fetch\("\/api\/employees\/import"/);
  assert.match(browser, /credentials: "same-origin"/,
    "Use the authenticated browser's cookies rather than the Node request jar");
  assert.match(browser, /assert\.equal\(deniedStatus, 403/,
    "A missing-authentication 401 must never count as role isolation");
  assert.doesNotMatch(browser, /context\.request\.post\(base \+ "\/api\/employees\/import"/);
  assert.match(workflow, /REQUIRE_PRIVILEGED_MFA: 'true'/);
  assert.match(workflow, /EMPLOYEE_IMPORT_PREVIEW_ENABLED=false npm run start/);
  assert.match(route, /assertOrganizationRole\(/);
  assert.match(route, /PEOPLE_ADMIN_ROLES/);
});
