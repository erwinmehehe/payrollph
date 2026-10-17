import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CANDIDATES = {
  "docs/sql/issue-retention-email-change-tokens-additive-candidate.sql": ["EMAIL_CHANGE_TOKENS_ALREADY_EXISTS_REVIEW_REQUIRED", "EMAIL_CHANGE_TOKENS_POSTFLIGHT_MISMATCH"],
  "docs/sql/issue-compensation-intent-event-fk-additive-candidate.sql": ["COMP_INTENT_FK_ALREADY_PRESENT_REVIEW_REQUIRED", "COMP_INTENT_FK_ORPHAN_ROWS_REVIEW_REQUIRED"],
};

for (const [file, codes] of Object.entries(CANDIDATES)) {
  test(`${file} stays a review-only, additive, fail-closed candidate`, () => {
    const sql = readFileSync(file, "utf8");
    assert.match(sql, /REVIEW-ONLY, UNNUMBERED/);
    assert.match(sql, /Do NOT execute against\s+-- production/);
    assert.equal((sql.match(/^DO \$/gm) ?? []).length, 1, "one atomic DO block");
    for (const code of codes) assert.ok(sql.includes(code), code);
    const code = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(code, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i, "no destructive or DML statements");
    assert.doesNotMatch(code, /IF NOT EXISTS/i, "an existing object must fail closed, not no-op");
  });
}
