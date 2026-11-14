import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync("scripts/qa/tenant-hcm-org-explorer-page-http.mjs", "utf8");
const browser = readFileSync("scripts/qa/tenant-hcm-org-explorer-browser.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-hcm-org-explorer-page-qa.yml", "utf8");

test("the real browser runs after hard refusal and against the same signed-in PG16 fixture", () => {
  const guard = runner.indexOf("requireFictionalEnvironment();");
  const seal = runner.indexOf("verifySources();");
  const database = runner.indexOf('import("../../src/db/index.ts")');
  const seeded = runner.indexOf('const victim = await seed("VICTIM");');
  const browserCall = runner.indexOf("await proveOrgExplorerHydratedBrowser({");
  const revoked = runner.indexOf("const [revoked] = await db.update(");
  assert.ok(guard >= 0 && seal > guard && database > seal && seeded > database &&
    browserCall > seeded && revoked > browserCall,
  "Browser cannot run before local PG16, source-sealed three-employer fixture");
  assert.match(runner, /organizationId: b\.org\.id, userId: companyHr\.user\.id/);
  assert.match(runner, /login: \{ email: companyHr\.user\.email, password: browserLoginPassword,/);
  assert.match(runner, /totpSecret: browserTotpSecret \}, operatorUserId: companyHr\.user\.id/);
  assert.match(runner, /passwordHash: hashPassword\(browserLoginPassword\)/);
  assert.match(runner, /a, b, victim, unchanged, afterBrowserLogin/);
  assert.match(runner, /async function afterBrowserLogin\(\)/);
  assert.match(runner, /clientBrowserInteractionsProven: true/);
  assert.match(runner, /browserEvidence,/);
});

test("fictional Chromium refuses remote env and verifies actual A-B-A history clicks", () => {
  assert.match(browser, /TENANT_ORG_EXPLORER_BROWSER_PROOF/);
  assert.match(browser, /fictional-chromium-only/);
  assert.match(browser, /process\.env\.APP_BASE_URL/);
  assert.match(browser, /process\.env\.DATABASE_URL/);
  assert.match(browser, /await import\("playwright"\)/);
  assert.doesNotMatch(browser, /context\.addCookies/);
  assert.match(browser, /const BROWSER_ORIGIN = "http:\/\/localhost:3000"/);
  assert.match(browser, /context\.request\.post\(BROWSER_ORIGIN \+ "\/api\/auth\/login"/);
  assert.match(browser, /generateTotp\(login\.totpSecret\)/);
  assert.match(browser, /const cookies = await context\.cookies\(BROWSER_ORIGIN\)/);
  assert.match(browser, /await afterBrowserLogin\(\)/);
  assert.match(browser, /context\.request\.get\(BROWSER_ORIGIN \+ "\/api\/account"/);
  assert.match(browser, /return address\.origin === BROWSER_ORIGIN \? route\.continue\(\) : route\.abort\(\)/);
  assert.match(browser, /for \(const actor of \[a, b, a\]\)/);
  assert.match(browser, /actor\.position\.code/);
  assert.match(browser, /Recorded worker reference #/);
  assert.match(browser, /await unchanged\("Chromium authorized "/);
  assert.match(browser, /page\.goto\(routeFor\(victim\)/);
  assert.match(browser, /assert\.equal\(denied\?\.status\(\), 404/);
  assert.match(browser, /await unchanged\("Chromium foreign victim SSR refusal"\)/);
  assert.match(browser, /pageActionCredits: 0, apiMethodCredits: 0/);
  assert.match(browser, /independentlyAccepted: false, productionCertified: false/);
});

test("workflow installs only localhost Chromium and reruns full source-pinned PG16 proof", () => {
  assert.match(workflow, /TENANT_ORG_EXPLORER_BROWSER_PROOF: fictional-chromium-only/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm install --no-save --ignore-scripts playwright@1\.55\.0/);
  assert.match(workflow, /npx playwright install --only-shell chromium/);
  assert.match(workflow, /node --check scripts\/qa\/tenant-hcm-org-explorer-browser\.mjs/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-hcm-org-explorer-page-http\.mjs/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.doesNotMatch(workflow, /secrets\./);
});
