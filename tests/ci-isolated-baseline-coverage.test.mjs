import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

const dir = ".github/workflows/";
const workflows = readdirSync(dir).filter((name) => name.endsWith(".yml"))
  .map((name) => ({ name, text: readFileSync(dir + name, "utf8") }));
const pushesSchema = (text) => /npm run db:push|drizzle-kit push/.test(text);
const startsApp = (text) => /npm (run )?start|next start|npm run dev|playwright|security-smoke/.test(text);
const appliesBaseline = (text) => /apply-isolated-baseline|apply-source-baseline-supplement/.test(text);

test("every disposable-DB workflow that starts the app applies the cutover baseline", () => {
  // Request code only verifies the schema (it never creates or alters it), so an app started on a
  // database built by db:push alone fails its catalog checks, exactly as it would in production
  // without the cutover. Apply 0109 + the reviewed supplement the way the cutover does.
  const missing = workflows.filter(({ text }) => pushesSchema(text) && startsApp(text) && !appliesBaseline(text))
    .map(({ name }) => name);
  assert.deepEqual(missing, [], "workflows that push a schema and start the app need scripts/qa/apply-isolated-baseline.mjs");
});

test("the baseline step runs after the schema push and after any explicit 0109 step", () => {
  for (const { name, text } of workflows) {
    // Inspect executable steps, not path-filter strings mentioning the helper.
    for (const [jobName, job] of Object.entries(load(text).jobs ?? {})) {
      const runs = (job.steps ?? []).map((step) => step.run ?? "");
      for (let at = 0; at < runs.length; at++) {
        if (!runs[at].includes("apply-isolated-baseline")) continue;
        const label = name + "/" + jobName;
        assert.ok(runs.slice(0, at).some((run) => /npm run db:push|drizzle-kit push/.test(run)), label + ": baseline must follow a db:push step");
        const audits = runs.flatMap((run, i) => run.includes("apply-audit-0109-isolated") ? [i] : []);
        assert.ok(audits.every((i) => i < at), label + ": an explicit 0109 step must come before the idempotent baseline step");
      }
    }
  }
});

test("the baseline wrapper is idempotent, disposable-only and keeps the reviewed runners' guards", () => {
  const source = readFileSync("scripts/qa/apply-isolated-baseline.mjs", "utf8");
  assert.ok(source.includes('process.env.GITHUB_ACTIONS !== "true"'));
  assert.ok(source.includes("postgresql://postgres:postgres@127.0.0.1:5432/app_db"));
  assert.ok(source.includes("if (!hasAuditHeads) steps.push"), "0109 only when the audit chain is absent");
  assert.ok(source.includes("if (needsSupplement) steps.push"), "supplement only when a migration-only object is missing");
  assert.ok(source.includes("scripts/qa/apply-audit-0109-isolated.mjs") && source.includes("scripts/qa/apply-source-baseline-supplement.mjs"),
    "delegates to the two reviewed runners instead of re-implementing them");
  assert.ok(!/neon|production/i.test(source.replace(/Never used for Neon, production[^\n]*/, "").replace(/\/\*\*[\s\S]*?\*\//, "")),
    "no production or Neon target is ever referenced by code");
});
