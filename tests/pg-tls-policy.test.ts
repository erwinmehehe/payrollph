import assert from "node:assert/strict";
import test from "node:test";
import { pinVerifiedPgTls } from "../src/lib/pg-tls-policy";

const secret = "hidden-credential-test-value";
const remoteUrl = "postgresql://fixture:" + secret + "@db.example.invalid:5432/app_db";

test("nonproduction does not rewrite existing development or local URLs", () => {
  for (const mode of ["require", "disable", "no-verify", "prefer", ""]) {
    const url = remoteUrl + "?sslmode=" + mode;
    assert.equal(pinVerifiedPgTls(url, false), url);
  }
});

test("isolated loopback PostgreSQL remains usable during production builds", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const url = "postgresql://test:test@" + host + ":5432/app_db";
    assert.equal(pinVerifiedPgTls(url, true), url);
  }
});

test("canonical strict mode is preserved exactly without credential reformatting", () => {
  const url = remoteUrl + "?sslmode=verify-full&application_name=payrollph";
  assert.equal(pinVerifiedPgTls(url, true), url);
});

test("all deprecated aliases are upgraded to explicit certificate and hostname verification", () => {
  for (const alias of ["prefer", "require", "verify-ca", "REQUIRE"]) {
    const actual = new URL(pinVerifiedPgTls(remoteUrl + "?sslmode=" + alias, true));
    assert.equal(actual.searchParams.get("sslmode"), "verify-full");
    assert.equal(actual.hostname, "db.example.invalid");
    assert.equal(actual.password, secret);
  }
});

test("custom CA, URL options and encoded password survive normalization", () => {
  const source = "postgres://alice:p%40ss%3Aword@db.example.invalid/app_db?application_name=x%20y&sslrootcert=%2Ftmp%2Fca.pem&uselibpqcompat=true&sslmode=require";
  const before = new URL(source);
  const after = new URL(pinVerifiedPgTls(source, true));
  assert.equal(after.username, before.username);
  assert.equal(after.password, before.password);
  assert.equal(after.pathname, before.pathname);
  for (const key of ["application_name", "sslrootcert", "uselibpqcompat"]) {
    assert.equal(after.searchParams.get(key), before.searchParams.get(key));
  }
  assert.equal(after.searchParams.get("sslmode"), "verify-full");
});

test("case-variant strict mode is canonicalized", () => {
  assert.equal(new URL(pinVerifiedPgTls(remoteUrl + "?sslmode=VERIFY-FULL", true)).searchParams.get("sslmode"), "verify-full");
});

test("production remote URL without explicit TLS verification fails closed", () => {
  assert.throws(() => pinVerifiedPgTls(remoteUrl, true), /exactly one explicit sslmode=verify-full/);
});

test("insecure, unsupported or empty TLS modes fail closed", () => {
  for (const mode of ["disable", "allow", "no-verify", "bogus", ""]) {
    assert.throws(() => pinVerifiedPgTls(remoteUrl + "?sslmode=" + mode, true), /TLS configuration rejected/);
  }
});

test("duplicate TLS-mode options cannot silently change driver precedence", () => {
  for (const mode of ["verify-full", "disable"]) {
    assert.throws(() => pinVerifiedPgTls(remoteUrl + "?sslmode=verify-full&sslmode=" + mode, true), /exactly one explicit/);
  }
});

test("separate ssl parameter is rejected instead of overriding sslmode", () => {
  for (const option of ["false", "0", "true"]) {
    assert.throws(() => pinVerifiedPgTls(remoteUrl + "?sslmode=verify-full&ssl=" + option, true), /ambiguous ssl option/);
  }
});

test("malformed and unsupported production URLs fail without exposing secrets", () => {
  for (const url of ["not-a-url-" + secret, "mysql://u:" + secret + "@db.example.invalid/db?sslmode=verify-full"]) {
    try {
      pinVerifiedPgTls(url, true);
      assert.fail("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      assert.doesNotMatch(message, new RegExp(secret));
      assert.doesNotMatch(message, /db\.example\.invalid/);
      assert.match(message, /DATABASE_URL value redacted/);
    }
  }
});

test("invalid TLS configuration never leaks the URL, hostname, or password", () => {
  for (const url of [remoteUrl + "?sslmode=disable", remoteUrl, remoteUrl + "?sslmode=require&ssl=false"]) {
    try {
      pinVerifiedPgTls(url, true);
      assert.fail("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      assert.doesNotMatch(message, new RegExp(secret));
      assert.doesNotMatch(message, /db\.example\.invalid/);
      assert.doesNotMatch(message, /postgresql:\/\//);
    }
  }
});
