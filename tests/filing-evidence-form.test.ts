import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFilingOutcome } from "../src/lib/filing-evidence";

const panel = readFileSync("src/components/workspace/filing-evidence.tsx", "utf8");
const exportsView = readFileSync("src/components/workspace/exports.tsx", "utf8");

test("the exports page shows the evidence form for the selected run", () => {
  assert.ok(exportsView.includes("<FilingEvidencePanel"));
  assert.ok(exportsView.includes("key={`${organizationId}-${run.id}`}"), "switching run must reset the form state");
});

test("the form talks to the real endpoints with the fields the API validates", () => {
  assert.ok(panel.includes("/api/compliance/filing-validations?organizationId="));
  assert.ok(panel.includes("/file?organizationId="));
  assert.ok(panel.includes('method: "PATCH"'));

  // Build the exact body the form sends and run it through the server's own parser.
  const sent = {
    organizationId: 1,
    outcome: "accepted",
    submissionMethod: "file_upload",
    agencyReference: "PRN-7654321",
    submittedAt: "2026-09-10",
    note: "",
  };
  for (const key of Object.keys(sent)) assert.ok(panel.includes(key), `form does not send ${key}`);
  assert.equal(parseFilingOutcome(sent).ok, true);
  assert.equal(parseFilingOutcome({ ...sent, outcome: "rejected", agencyReference: "", note: "Column MSC not recognised" }).ok, true);
});

test("the form is honest about what counts and that results are permanent", () => {
  assert.ok(panel.includes("does not prove the file works"), "typed-in filings must be labelled as not proof");
  assert.ok(panel.includes("cannot be edited afterwards"));
  assert.ok(panel.includes("Linaw cannot check SSS for you"));
  assert.ok(panel.includes("does not submit to SSS"), "the card must not imply Linaw files with SSS");
});

test("user-facing copy in the form has no em-dashes", () => {
  assert.ok(!panel.includes("—"), "no em-dashes in user-facing copy");
});
