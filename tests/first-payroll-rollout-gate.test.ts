import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CRITICAL_RELEASE_FLAGS, criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

test("inline first payroll is off by default and requires exact true", () => {
 const gate=CRITICAL_RELEASE_FLAGS.firstPayrollInline;
 assert.equal(gate.env,"FIRST_PAYROLL_INLINE_ENABLED");
 for (const value of [undefined,"","TRUE","1","false","on"]) {
  assert.equal(criticalReleaseFlagEnabled("firstPayrollInline",{FIRST_PAYROLL_INLINE_ENABLED:value}),false);
 }
 assert.equal(criticalReleaseFlagEnabled("firstPayrollInline",{FIRST_PAYROLL_INLINE_ENABLED:"true"}),true);
});

test("server routes and SSR render all check rollout gate before journey persistence", () => {
 const helper=readFileSync("src/lib/first-payroll-inline-gate.ts","utf8");
 assert.match(helper,/criticalReleaseFlagEnabled\("firstPayrollInline"\)/);
 assert.match(helper,/from\(firstPayrollJourneyProgress\)/);
 assert.match(helper,/if \(!criticalReleaseFlagEnabled\("firstPayrollInline"\)\) return false;/);
 for(const path of ["src/app/api/first-payroll/progress/route.ts","src/app/api/first-payroll/preview/route.ts"]) {
  const source=readFileSync(path,"utf8");
  assert.match(source,/firstPayrollInlineAvailable/);
  assert.match(source,/if \(!\(await firstPayrollInlineAvailable\(\)\)\)/);
 }
 const page=readFileSync("src/app/app/page.tsx","utf8");
 const workspace=readFileSync("src/components/linaw-workspace.tsx","utf8");
 const card=readFileSync("src/components/workspace/first-payroll-readiness.tsx","utf8");
 assert.match(page,/inlineFirstPayrollEnabled = isSelfServe && .*firstPayrollInlineAvailable\(\)/);
 assert.match(workspace,/inlineEnabled=\{inlineFirstPayrollEnabled\}/);
 assert.match(card,/if\(!guided\|\|!inlineEnabled\|\|!organizationId\)return/);
 assert.match(card,/inlineEnabled&&opened===step.key/);
 assert.match(card,/onPage\(step.page\)/);
});
test("only isolated test workflow enables the rollout; no automatic production rollout", () => {
 const flow=readFileSync(".github/workflows/hris-journey-browser-qa.yml","utf8");
 assert.match(flow,/FIRST_PAYROLL_INLINE_ENABLED: "true"/);
 assert.match(flow,/HRIS_JOURNEY_ACCEPTANCE_MODE: synthetic-postgres-only/);
 assert.match(flow,/DATABASE_URL: postgresql:\/\/postgres:postgres@127.0.0.1:5432\/app_db/);
});
