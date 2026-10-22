/** Regression guard for the isolated DL-02 synthetic scanner prerequisite only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/tenant-dl02-qa.yml", "utf8");
const scanner = readFileSync("scripts/qa/tenant-ci-synthetic-proof-scanner.mjs", "utf8");
const serverStep = "Start isolated production-mode localhost server";
const httpStep = "Own-employer success, victim-employer denial and unchanged victim rows over HTTP";
const guardStep = "Guard isolated DL-02 synthetic scanner prerequisite";

function step(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf("      - name: " + name);
  assert.ok(start >= 0, "Missing mandatory DL-02 step: " + name);
  const next = lines.findIndex((line, i) => i > start && /^      - /.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join("\n");
}

function requireSafeScannerStartup(source) {
  const jobEnv = source.match(/^    env:\n([\s\S]*?)^    services:/m)?.[1];
  assert.ok(jobEnv, "DL-02 needs an explicit disposable job environment");
  for (const required of [
    'CI: "true"',
    "DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    "SECURITY_SMOKE_URL: http://127.0.0.1:3000",
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"',
    'XENDIT_PAYOUTS_ENABLED: "false"',
    'MALWARE_SCAN_URL: https://scanner.invalid/scan',
    'REQUIRE_PRIVILEGED_MFA: "true"',
  ]) assert.ok(jobEnv.includes("      " + required), "Preserve fail-closed CI default: " + required);
  const server = step(source, serverStep);
  for (const required of [
    "set -euo pipefail",
    "node --check scripts/qa/tenant-ci-synthetic-proof-scanner.mjs",
    "openssl req -x509 -newkey rsa:2048 -nodes -days 1",
    "subjectAltName=IP:127.0.0.1",
    "export TENANT_SYNTHETIC_SCAN_MODE=isolated-pg16-only",
    "export MALWARE_SCAN_URL=https://127.0.0.1:8443/scan",
    "export MALWARE_SCAN_TOKEN=ci-tenant-proof-scanner-only",
    "export NODE_EXTRA_CA_CERTS=/tmp/tenant-ci-scanner.crt",
    "nohup node scripts/qa/tenant-ci-synthetic-proof-scanner.mjs",
    "curl --silent --fail --cacert /tmp/tenant-ci-scanner.crt https://127.0.0.1:8443/health",
    "nohup npm start -- -H 127.0.0.1",
  ]) assert.ok(server.includes(required), "DL-02 scanner/server setup is missing: " + required);
  assert.ok(server.indexOf("nohup node scripts/qa/tenant-ci-synthetic-proof-scanner.mjs") <
    server.indexOf("curl --silent --fail --cacert /tmp/tenant-ci-scanner.crt") &&
    server.indexOf("curl --silent --fail --cacert /tmp/tenant-ci-scanner.crt") <
    server.indexOf("nohup npm start -- -H 127.0.0.1"),
    "Scanner must be healthy before the localhost application starts");
  assert.doesNotMatch(server, /NODE_TLS_REJECT_UNAUTHORIZED|--insecure|curl -k\b/,
    "Never disable TLS verification for the synthetic scanner");
  const probe = step(source, httpStep);
  assert.match(probe, /^          TENANT_SECOND_PASS_MODE: isolated-ci-only$/m);
  assert.match(probe, /^          TENANT_DL02_PROOF: isolated-ci-only$/m);
  assert.match(probe, /^        run: npx tsx scripts\/qa\/tenant-second-pass-http\.mjs$/m);
  assert.doesNotMatch(probe, /continue-on-error|\|\|\s*true/,
    "Positive statutory proof assertions must remain strict");
}

test("DL-02 scanner fixture starts securely before the real synthetic HTTP proof", () => {
  requireSafeScannerStartup(workflow);
  assert.match(workflow, /'scripts\/qa\/tenant-ci-synthetic-proof-scanner\.mjs'/);
  assert.match(workflow, /'src\/app\/api\/compliance\/statutory-remittances\/payment-evidence\/\*\*'/);
  const guard = step(workflow, guardStep);
  assert.match(guard, /run: node --test tests\/tenant-dl02-scanner-workflow\.test\.mjs/);
  assert.ok(workflow.indexOf("      - name: " + guardStep) <
    workflow.indexOf("      - run: npm run build"), "CI setup guard must run before build");
});

test("removing any scanner prerequisite makes the DL-02 contract fail", () => {
  for (const required of [
    "export TENANT_SYNTHETIC_SCAN_MODE=isolated-pg16-only",
    "export MALWARE_SCAN_URL=https://127.0.0.1:8443/scan",
    "export MALWARE_SCAN_TOKEN=ci-tenant-proof-scanner-only",
    "export NODE_EXTRA_CA_CERTS=/tmp/tenant-ci-scanner.crt",
    "nohup node scripts/qa/tenant-ci-synthetic-proof-scanner.mjs",
    "curl --silent --fail --cacert /tmp/tenant-ci-scanner.crt https://127.0.0.1:8443/health",
  ]) {
    const broken = workflow.replace(required, "");
    assert.notEqual(broken, workflow);
    assert.throws(() => requireSafeScannerStartup(broken), /DL-02 scanner\/server setup is missing|Scanner must be healthy/);
  }
});

test("synthetic scanner remains GitHub Actions, localhost, token, TLS and fixture restricted", () => {
  for (const required of [
    'assert.equal(process.env.CI, "true")',
    'assert.equal(process.env.GITHUB_ACTIONS, "true")',
    'assert.equal(process.env.TENANT_SYNTHETIC_SCAN_MODE, "isolated-pg16-only")',
    'assert.equal(process.env.DEMO_MODE, "false")',
    'assert.equal(db.hostname, "127.0.0.1")',
    'assert.equal(db.port, "5432")',
    'assert.equal(db.pathname, "/app_db")',
    'timingSafeEqual(acceptedToken, receivedToken)',
    'if (count > 8192)',
    'SYNTHETIC-PROOF-TENANT-QA:',
    'server.listen(8443, "127.0.0.1"',
  ]) assert.ok(scanner.includes(required), "Preserve scanner boundary: " + required);
  assert.match(scanner, /clean: false/);
  assert.doesNotMatch(workflow, /NODE_TLS_REJECT_UNAUTHORIZED|continue-on-error/);
});