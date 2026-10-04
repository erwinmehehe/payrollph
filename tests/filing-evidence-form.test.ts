import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FILING_FORMS, parseFilingOutcome } from "../src/lib/filing-evidence";

const panel = readFileSync("src/components/workspace/filing-evidence.tsx", "utf8");
const exportsView = readFileSync("src/components/workspace/exports.tsx", "utf8");
const EM_DASH = String.fromCharCode(0x2014);

test("the exports page shows an evidence form for every supported form", () => {
  assert.ok(exportsView.includes("<FilingEvidencePanel"));
  for (const definition of FILING_FORMS) {
    assert.ok(
      exportsView.includes(`agency: "${definition.agency}", form: "${definition.form}"`),
      `no evidence card for ${definition.agency} ${definition.form}`,
    );
  }
  assert.ok(exportsView.includes("-${item.agency}-${item.form}`}"), "switching run or form must reset the form state");
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
  assert.ok(panel.includes("copy?.manualEntryNote"), "typed-in filings must be labelled as not proof");
  assert.ok(panel.includes("cannot be edited afterwards"));
  assert.ok(panel.includes("Linaw cannot check {agencyLabel} for you"));
  assert.ok(panel.includes("Linaw does not submit to {agencyLabel}"), "the card must not imply Linaw files for you");
  for (const definition of FILING_FORMS) {
    assert.match(definition.copy.manualEntryNote, /does not prove/, `${definition.form}: typed-in filings must not read as proof`);
    assert.ok(definition.copy.unconfirmedNote.length > 0, `${definition.form}: say what is unconfirmed`);
  }
});

test("BIR card identifies the current validator and source-only status", () => {
  const bir = FILING_FORMS.find((item) => item.agency === "BIR")!;
  assert.equal(bir.generatedFileIsAgencyUpload, false);
  assert.match(bir.copy.scopeNote ?? "", /version 7\.4/);
  assert.match(bir.copy.scopeNote ?? "", /file structure and naming convention/);
  assert.match(bir.copy.unconfirmedNote, /future DAT generator/);
  assert.ok(panel.includes("copy.scopeNote"), "the panel must show the scope note");
});

test("PhilHealth card keeps EPRS authoritative and worksheet compatibility unproven", () => {
  const ph = FILING_FORMS.find((item) => item.agency === "PhilHealth")!;
  assert.equal(ph.generatedFileIsAgencyUpload, false);
  assert.match(ph.copy.answerLabel, /ePAR/);
  assert.match(ph.copy.scopeNote ?? "", /EPRS as the authoritative employer reporting and payment workflow/);
  assert.match(ph.copy.manualEntryNote, /does not prove/);
  assert.match(ph.copy.unconfirmedNote, /exact bytes are accepted in EPRS/);
});

test("Pag-IBIG card reflects the prescribed workbook and eSRS workflow", () => {
  const pi = FILING_FORMS.find((item) => item.agency === "Pag-IBIG")!;
  assert.equal(pi.generatedFileIsAgencyUpload, false);
  assert.match(pi.copy.answerLabel, /PIN/);
  assert.match(pi.copy.scopeNote ?? "", /Payment Instruction Form/);
  assert.match(pi.copy.scopeNote ?? "", /generated PIN/);
  assert.match(pi.copy.manualEntryNote, /Excel workbook/);
  assert.match(pi.copy.unconfirmedNote, /Do not upload Linaw's CSV as an MCRF/);
});

test("every Draft button on the exports page sends a kind the generator accepts", () => {
  const exporters = readFileSync("src/lib/exporters.ts", "utf8");
  const list = exporters.match(/const supportedKinds = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const supported = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const kinds = [...exportsView.matchAll(/kind: "([a-z0-9-]+)", detail:/g)].map((match) => match[1]);
  assert.equal(kinds.length, 5);
  for (const kind of kinds) assert.ok(supported.includes(kind), `"${kind}" is not a kind generateGovernmentDraft supports`);
  assert.ok(exportsView.includes("encodeURIComponent(item.kind)"), "the button must send the kind, not the visible label");
});

test("user-facing copy has no em-dashes", () => {
  assert.ok(!panel.includes(EM_DASH), "no em-dashes in the form");
  for (const definition of FILING_FORMS) {
    assert.ok(!JSON.stringify(definition.copy).includes(EM_DASH), `${definition.form} copy has an em-dash`);
  }
});
