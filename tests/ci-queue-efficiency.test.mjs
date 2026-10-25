import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";
import picomatch from "picomatch";

const policy = JSON.parse(readFileSync(".github/ci-queue-policy.json", "utf8"));
const workflow = (file) => load(readFileSync(".github/workflows/" + file, "utf8"));
const onPr = (w) => Array.isArray(w.on) ? w.on.includes("pull_request") : Object.hasOwn(w.on ?? {}, "pull_request");
const cancelOnlyPr = "${{ github.event_name == 'pull_request' }}";

test("new PR cancellation groups supersede heads without colliding with main or manual attempts", () => {
  for (const file of policy.supersedePrRuns) {
    const w = workflow(file);
    assert.ok(onPr(w), file + ": must actually run on PRs");
    assert.deepEqual(w.concurrency, {
      group: "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}",
      "cancel-in-progress": cancelOnlyPr,
    }, file);
    assert.doesNotMatch(w.concurrency.group, /head\.sha/);
  }
  const ci = workflow("ci.yml");
  assert.equal(ci.concurrency.group, "${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}");
  assert.equal(ci.concurrency["cancel-in-progress"], cancelOnlyPr);
});

test("every PR workflow has concurrency or a documented protected exception", () => {
  for (const file of readdirSync(".github/workflows").filter((f) => f.endsWith(".yml"))) {
    const w = workflow(file);
    if (!onPr(w) || w.concurrency) continue;
    assert.ok(policy.protectedExceptions[file]?.length > 30, file + ": classify before adding automatic cancellation");
  }
  for (const file of Object.keys(policy.protectedExceptions)) {
    assert.ok(!policy.supersedePrRuns.includes(file), file + ": protected workflow cannot enter the CI-only cancellation list");
  }
});

// GitHub evaluates ordered positive and negative path patterns, with later matches
// re-including executable fixtures. The cases below exercise the actual workflow lists.
function selected(file, patterns) {
  let included = false;
  for (const pattern of patterns) {
    const negative = pattern.startsWith("!");
    if (picomatch.isMatch(file, negative ? pattern.slice(1) : pattern, { dot: true })) included = !negative;
  }
  return included;
}

test("optional prose filters retain source, security, SQL, evidence and executable fixtures", () => {
  for (const name of policy.docsOnlyFilters) {
    const w = workflow(name);
    const patterns = w.on.pull_request.paths;
    assert.deepEqual(patterns, policy.documentationPatterns, name);
    for (const file of ["README.md", "docs/qa/explanation.md", "docs/engineering/overview.md", "docs/security/runbook.mdx", "LICENSE"]) {
      assert.equal(selected(file, patterns), false, name + ": skip ordinary prose " + file);
    }
    for (const file of ["src/lib/access.ts", "src/lib/auth.ts", "src/lib/payroll-engine.ts", "src/app/api/payroll-runs/route.ts",
      "src/app/help/page.mdx", "scripts/qa/proof.mjs", "tests/fixtures/body.md", "public/help.md", ".github/workflows/ci.yml",
      "docs/sql/source-baseline-supplement.sql", "docs/engineering/proposal.sql", "docs/qa/evidence.json", "docs/engineering/map.csv",
      "drizzle/0137_history.sql", "src/db/schema.ts", "package-lock.json", "next.config.ts", "Dockerfile"]) {
      assert.equal(selected(file, patterns), true, name + ": required dependency retained " + file);
    }
  }
});

test("all four protected status workflows remain unconditional for PRs", () => {
  for (const file of policy.requiredWorkflows) {
    const w = workflow(file);
    assert.ok(onPr(w), file);
    assert.equal(w.on.pull_request?.paths, undefined, file + ": cannot leave required status pending through a path filter");
    assert.equal(w.on.pull_request?.["paths-ignore"], undefined, file);
    assert.ok(!policy.docsOnlyFilters.includes(file));
  }
  const ci = workflow("ci.yml");
  assert.deepEqual(ci.jobs["test-shard"].strategy.matrix.shard, [0, 1, 2, 3]);
  assert.equal(ci.jobs.check.if, "${{ always() }}");
  assert.deepEqual(ci.jobs.check.needs, ["test-shard", "audit-chain-protection"]);
});

test("intake reuses one exact-source build while retaining both independent database acceptance jobs", () => {
  const jobs = workflow("public-intake-db-acceptance.yml").jobs;
  const build = jobs["build-intake"], matrix = jobs["intake-postgres"];
  assert.deepEqual(matrix.strategy.matrix.postgres, ["16", "18"]);
  assert.equal(matrix.needs, "build-intake");
  assert.deepEqual(build.env, matrix.env, "build-time flags/origins must be identical for both consumers");
  assert.equal(Object.values(jobs).flatMap((j) => j.steps).filter((s) => s.run === "npm run build").length, 1);
  const upload = build.steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const download = matrix.steps.find((s) => s.uses?.startsWith("actions/download-artifact@"));
  assert.equal(upload.with.name, "public-intake-next-${{ github.sha }}");
  assert.equal(download.with.name, upload.with.name);
  assert.equal(upload.with["retention-days"], 1);
  assert.ok(build.steps.some((s) => s.run?.includes("--exclude='.next/cache'")));
  assert.ok(matrix.steps.some((s) => s.run === "npm run db:push"));
  assert.ok(matrix.steps.some((s) => s.run?.includes("tests/careers-http-postgres.test.ts")));
  assert.ok(matrix.steps.some((s) => s.run?.includes("scripts/public-intake-db-acceptance.ts")));
  assert.ok(matrix.steps.some((s) => s.name === "Create disposable test-only independent secrets"));
  assert.ok(!matrix.steps.some((s) => s.uses?.startsWith("actions/cache@")), "never reuse a cross-run .next build cache");
});
