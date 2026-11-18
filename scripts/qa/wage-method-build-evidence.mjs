/** Build-only evidence. Does not start a server, send HTTP requests, or award credit. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TENANT_TABLE_PROFILES } from "./tenant-table-env.mjs";
import { buildWageMethodSourcePlan } from "./wage-method-source-plan.mjs";

const profileName = "compliance-posts";
const proofOutput = "qa-artifacts/wage-method-local-build-evidence.json";
const buildFiles = ["BUILD_ID", "build-manifest.json", "app-path-routes-manifest.json", "server/app-paths-manifest.json"];
const hash = (data) => createHash("sha256").update(data).digest("hex");

export function tracedRepositoryPath(root, trace, dependency) {
  assert.ok(typeof dependency === "string" && dependency && !path.isAbsolute(dependency), "Relative trace input expected");
  const relative = path.relative(root, path.resolve(path.dirname(trace), dependency));
  assert.ok(relative && relative !== ".." && !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative), "Build trace leaves the checkout");
  return relative.split(path.sep).join("/");
}

function buildEvidence(plan, flags) {
  const root = realpathSync(process.cwd());
  const buildRoot = path.join(root, ".next");
  const hashes = new Map();
  const digest = (file) => {
    const absolute = path.resolve(file);
    if (!hashes.has(absolute)) hashes.set(absolute, hash(readFileSync(absolute)));
    return hashes.get(absolute);
  };
  const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0"));
  const artifactPins = Object.fromEntries(buildFiles.map((file) => [file, digest(path.join(buildRoot, file))]));
  const cached = new Map();
  const methods = plan.methods.map(({ key }) => {
    const source = key.slice(key.indexOf(" ") + 1);
    const route = source.replace(/^src\//, "").replace(/\.ts$/, ".js");
    if (!cached.has(route)) {
      const trace = path.join(buildRoot, "server", route + ".nft.json");
      if (!existsSync(trace)) cached.set(route, { status: "TRACE_MISSING" });
      else {
        const data = JSON.parse(readFileSync(trace, "utf8"));
        assert.ok(Array.isArray(data.files), "Missing files in build trace");
        const runtimeInputPins = {};
        const generatedPins = {};
        let packages = 0;
        const untracked = [];
        for (const dependency of new Set(data.files)) {
          const relative = tracedRepositoryPath(root, trace, dependency);
          if (relative.startsWith(".next/")) {
            assert.equal(realpathSync(relative), path.resolve(relative), "Build artifact must resolve within the checkout");
            generatedPins[relative] = digest(relative);
            continue;
          }
          if (relative.startsWith("node_modules/")) { packages++; continue; }
          if (tracked.has(relative)) {
            assert.equal(tracedRepositoryPath(root, path.join(root, "trace"), path.relative(root, realpathSync(relative))),
              relative, "Trace input must resolve to its tracked path");
            runtimeInputPins[relative] = digest(relative);
          } else untracked.push(relative);
        }
        cached.set(route, {
          status: untracked.length ? "UNTRACKED_INPUTS" : "TRACE_CAPTURED",
          traceSha256: digest(trace),
          bundleSha256: digest(path.join(buildRoot, "server", route)),
          runtimeInputPins, generatedPins, packages, untracked: untracked.sort(),
        });
      }
    }
    return { key, ...cached.get(route), httpExecution: "NOT_RUN", coverageCredits: 0 };
  });
  return {
    schema: "payrollph-local-build-evidence-v1", sourceHead: plan.sourceHead, scope: "BUILD_ONLY",
    appliedBuildProfile: { name: profileName, flags },
    artifactPins, packageLockSha256: digest("package-lock.json"), methods, coverageCredits: 0,
  };
}

function runLocalBuild() {
  assert.ok(!existsSync(".next"), "Use a checkout without prior .next artifacts");
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    assert.ok(!existsSync(file), "Move local environment files out of the build checkout first");
  }
  const plan = buildWageMethodSourcePlan();
  const flags = { ...TENANT_TABLE_PROFILES[profileName], EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false" };
  assert.ok(Object.values(flags).every((value) => value === "false"), "This local build only accepts the all-off profile");
  const allowed = new Set(["PATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "TEMP", "TMP",
    "USERPROFILE", "LOCALAPPDATA", "APPDATA", "COMSPEC", "HOME", "NUMBER_OF_PROCESSORS"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())));
  Object.assign(env, flags, {
    CI: "true", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/app_db",
    APP_BASE_URL: "https://payroll.example.test", DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true", TENANT_TABLE_PROFILE: profileName,
  });
  const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Local Next.js build failed");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), plan.sourceHead);
  assert.equal(execFileSync("git", ["diff", "--name-only", "HEAD", "--"], { encoding: "utf8" }).trim(), "");
  const evidence = buildEvidence(plan, flags);
  mkdirSync(path.dirname(proofOutput), { recursive: true });
  writeFileSync(proofOutput, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({
    sourceHead: evidence.sourceHead, output: proofOutput, methods: evidence.methods.length,
    traceCaptured: evidence.methods.filter((method) => method.status === "TRACE_CAPTURED").length,
    coverageCredits: 0,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runLocalBuild();
