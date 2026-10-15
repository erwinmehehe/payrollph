import assert from "node:assert/strict";
import test from "node:test";
import { validateProbeConfig } from "../scripts/verify-postgresql-tls-operator";

const password = "sensitive-only-in-test";
const base = "postgresql://fake:" + password + "@db.example.invalid:5432/payroll";

test("operator probe accepts only explicit, strict production TLS configuration", () => {
  const result = validateProbeConfig(base + "?sslmode=verify-full");
  assert.equal(result.host, "db.example.invalid");
  assert.equal(result.port, 5432);
  assert.equal(result.caFile, null);
  assert.ok(result.canonicalUrl.includes("sslmode=verify-full"));
});

test("operator probe rejects aliases even if runtime code normalizes them", () => {
  for (const mode of ["require", "prefer", "verify-ca", "VERIFY-FULL", "disable", "no-verify", ""]) {
    assert.throws(() => validateProbeConfig(base + "?sslmode=" + mode), /TLS.*(rejected|configuration)/i);
  }
});

test("operator probe refuses duplicate, absent, or conflicting TLS parameters", () => {
  for (const suffix of ["", "?sslmode=verify-full&sslmode=verify-full", "?sslmode=verify-full&ssl=false"]) {
    assert.throws(() => validateProbeConfig(base + suffix), /TLS.*(rejected|configuration)/i);
  }
});

test("operator probe refuses localhost and client TLS options it cannot verify", () => {
  for (const url of [
    "postgresql://test:test@localhost/postgres?sslmode=verify-full",
    base + "?sslmode=verify-full&sslcert=%2Ftmp%2Fclient.pem",
    base + "?sslmode=verify-full&sslkey=%2Ftmp%2Fclient.key",
    base + "?sslmode=verify-full&sslrootcert=system",
    base + "?sslmode=verify-full&sslrootcert=%2Ftmp%2Fca.pem&sslrootcert=%2Ftmp%2Fanother.pem",
  ]) {
    assert.throws(() => validateProbeConfig(url), /TLS.*rejected/i);
  }
});

test("invalid operator configuration messages never leak credentials or hostname", () => {
  for (const badUrl of [base, base + "?sslmode=disable", base + "?sslmode=verify-full&ssl=false"]) {
    try { validateProbeConfig(badUrl); assert.fail("must reject"); }
    catch (error) {
      const msg = String((error as Error).message);
      assert.doesNotMatch(msg, new RegExp(password));
      assert.doesNotMatch(msg, /db\.example\.invalid/);
      assert.doesNotMatch(msg, /postgresql:\/\//);
    }
  }
});
