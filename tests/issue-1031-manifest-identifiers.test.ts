import { strict as assert } from "node:assert";
import { test } from "node:test";
import { postgresIdentifier } from "../scripts/lib/issue-1031-schema-manifest";

test("PostgreSQL FK identifier expectation honors 63 UTF-8 bytes", () => {
  assert.equal(postgresIdentifier("short_fk"), "short_fk");
  assert.equal(Buffer.byteLength(postgresIdentifier("x".repeat(84)), "utf8"), 63);
  assert.equal(postgresIdentifier("x".repeat(63)+"suffix"), "x".repeat(63));
  // Truncation must never split a multibyte code point.
  assert.equal(postgresIdentifier("z".repeat(62)+"🙂"), "z".repeat(62));
  assert.equal(postgresIdentifier("z".repeat(59)+"🙂"), "z".repeat(59)+"🙂");
});
