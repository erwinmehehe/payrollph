import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// encryptGovernmentId() throws "PII_ENCRYPTION_KEY is required before government
// identifiers can be stored" at every employee, contractor, import and
// registration-change write (all call sites pass { required: true }). A
// required secret that is not documented blocks first-time setup silently.
test("the fail-closed PII encryption key is documented for operators", () => {
  const example = readFileSync(".env.local.example", "utf8");
  const readme = readFileSync("README.md", "utf8");
  assert.match(example, /^PII_ENCRYPTION_KEY=$/m);
  assert.match(example, /^PII_ENCRYPTION_KEY_PREVIOUS=$/m);
  assert.match(readme, /\| `PII_ENCRYPTION_KEY` \|/);
  assert.match(readme, /PII_ENCRYPTION_KEY_PREVIOUS/);
  // Sourcing it from the TOTP key would defeat key separation; docs must not imply that.
  assert.match(readme, /no fallback to `TOTP_ENCRYPTION_KEY`/);
});
