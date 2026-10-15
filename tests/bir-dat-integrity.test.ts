import assert from "node:assert/strict";
import test from "node:test";
import { assertBir1604cDatIntegrity, buildBir1604cDatCandidate } from "../src/lib/bir-1604c-dat-candidate";
import { buildSyntheticValidationCorpus, syntheticFilingInput } from "../scripts/qa/bir-1604c-validation-corpus";
import { buildReviewedBir1604cCandidate } from "../src/lib/bir-1604c-pre-export";

test("serialized guard accepts complete fictional candidate and rejects every mutated official test case", () => {
  const input = syntheticFilingInput();
  const corpus = buildSyntheticValidationCorpus("a".repeat(40));
  for (const file of corpus.files) {
    if (file.caseId === "ordinary-and-difficult") assert.doesNotThrow(() => assertBir1604cDatIntegrity(file.content, input));
    else assert.throws(() => assertBir1604cDatIntegrity(file.content, input), /integrity/);
  }
});

test("serialized guard rejects each missing, duplicate, altered or misplaced control and a one-cent total drift", () => {
  const input = syntheticFilingInput();
  const content = buildBir1604cDatCandidate(input).content;
  const rows = content.trimEnd().split("\r\n");
  for (const kind of ["C1", "C2"]) {
    const index = rows.findIndex(row => row.startsWith(kind + ","));
    const control = rows[index];
    const variants = [rows.filter((_, i) => i !== index), [...rows, control],
      [rows[0], control, ...rows.slice(1).filter((_, i) => i + 1 !== index)],
      rows.map((row, i) => i === index ? row.replace(/\d{11}\.\d{2}/, "00000000000.01") : row)];
    for (const variant of variants) assert.throws(() => assertBir1604cDatIntegrity(variant.join("\r\n") + "\r\n", input), /integrity/);
  }
  assert.throws(() => assertBir1604cDatIntegrity(content, { ...input, expectedActualWithheld: "195000.01" }), /integrity/);
  assert.throws(() => assertBir1604cDatIntegrity(content, { ...input, expectedEmployees: 4 }), /integrity/);
});

test("quoted commas and escaped quotes survive byte checking; disabled reviewed export returns before inspecting input", () => {
  const input = syntheticFilingInput(); input.records[0].fields.LAST_NAME = 'FICTIONAL, "NAME"';
  assert.doesNotThrow(() => buildBir1604cDatCandidate(input));
  const result = buildReviewedBir1604cCandidate(null as never, false);
  assert.equal(result.ok, false); assert.equal(result.issues[0].code, "FEATURE_DISABLED");
});
