import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("package exposes a one-command local bootstrap", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.local, "node scripts/local.mjs");
});

test("local compose file runs only a local postgres service with a persistent volume", () => {
  const compose = read("docker-compose.local.yml");
  assert.match(compose, /postgres:16/);
  assert.match(compose, /5432:5432/);
  assert.match(compose, /POSTGRES_DB:\s*payrollph/);
  assert.match(compose, /payrollph_pgdata:/);
  assert.doesNotMatch(compose, /vercel|neon|render|railway/i);
});

test("local env template enables demo and disables live disbursements", () => {
  const env = read(".env.local.example");
  assert.match(env, /^DATABASE_URL=postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/payrollph$/m);
  assert.match(env, /^DEMO_MODE=true$/m);
  assert.match(env, /^PAYMONGO_DISBURSEMENTS_ENABLED=false$/m);
  assert.doesNotMatch(env, /PAYMONGO_SECRET_KEY=/);
});

test("local bootstrap copies env only when absent, starts postgres, pushes schema, and launches Next", () => {
  const script = read("scripts/local.mjs");
  assert.match(script, /\.env\.local/);
  assert.match(script, /\.env\.local\.example/);
  assert.match(script, /docker-compose\.local\.yml/);
  assert.match(script, /drizzle-kit/);
  assert.ok(script.includes('spawn(npmCommand, ["run", "dev"]'));
  assert.match(script, /PAYMONGO_DISBURSEMENTS_ENABLED/);
});

test("local runner forces safe local database, demo mode, and payouts-off even when an env file already exists", () => {
  const script = read("scripts/local.mjs");
  assert.match(script, /parseEnvFile\(envExamplePath\)/);
  assert.match(script, /DATABASE_URL:\s*safeDefaults\.DATABASE_URL/);
  assert.match(script, /DEMO_MODE:\s*"true"/);
  assert.match(script, /PAYMONGO_DISBURSEMENTS_ENABLED:\s*"false"/);
});

test("generated local environment is ignored by git", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env\.local$/m);
});
