import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const runner = resolve(process.cwd(), "scripts/run-postgresql-tls-acceptance.ts");
const secret = "cli-private-fixture-value";
const url = "postgresql://user:" + secret + "@db.example.invalid/payroll?sslmode=require";

function run(authorized: boolean) {
  return spawnSync(process.execPath, ["--import", "tsx", runner], {
    encoding: "utf8", timeout: 15000,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: url,
      ...(authorized ? { PG_TLS_OPERATOR_ACK: "authorized-readonly-tls-acceptance" } : {}),
    },
  });
}

test("operator CLI exits nonzero and does not connect without authorization", () => {
  const result = run(false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /authorization flag missing/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stdout + result.stderr, /db\.example\.invalid/);
});

test("operator CLI rejects an alias secret safely before attempting network I/O", () => {
  const result = run(true);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /protected PostgreSQL TLS acceptance/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stdout + result.stderr, /db\.example\.invalid/);
});
