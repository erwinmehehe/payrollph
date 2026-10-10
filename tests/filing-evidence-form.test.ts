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
    if (definition.evidenceMode === "file-format") {
      assert.match(definition.copy.manualEntryNote, /does not prove/, `${definition.form}: typed-in filings must not read as file-format proof`);
    } else {
      assert.match(definition.copy.manualEntryNote, /operational|filing/i, `${definition.form}: operational evidence copy must explain what the acknowledgement proves`);
    }
    assert.ok(definition.copy.unconfirmedNote.length > 0, `${definition.form}: say what is unconfirmed`);
  }
});

test("BIR's card says what source-extract acceptance does not prove", () => {
  const bir = FILING_FORMS.find((item) => item.agency === "BIR" && item.form === "1604-C")!;
  assert.match(bir.copy.scopeNote ?? "", /source extract for BIR validation/);
  assert.match(bir.copy.scopeNote ?? "", /does not replace BIR Alphalist v7\.4 validation/);
  assert.match(bir.copy.scopeNote ?? "", /annual filing acknowledgement/);
  assert.match(bir.copy.unconfirmedNote, /Linaw does not produce that \.DAT/);
  assert.ok(panel.includes("copy.scopeNote"), "the panel must show the scope note");
});

test("BIR 1601-C card allows portal evidence without pretending the worksheet is an upload format", () => {
  const bir = FILING_FORMS.find((item) => item.agency === "BIR" && item.form === "1601-C")!;
  assert.equal(bir.evidenceMode, "operational");
  assert.deepEqual(bir.submissionMethods, ["manual_entry"]);
  assert.equal(bir.requiresFinalCutoff, true);
  assert.match(bir.copy.scopeNote ?? "", /does not claim/);
  assert.match(bir.copy.scopeNote ?? "", /1601-C CSV/);
  assert.match(bir.copy.manualEntryNote, /operational filing/);
});

test("PhilHealth's card says what the receipt does and does not show", () => {
  const ph = FILING_FORMS.find((item) => item.agency === "PhilHealth")!;
  assert.match(ph.copy.answerLabel, /ePAR/);
  assert.match(ph.copy.scopeNote ?? "", /issues the acknowledgement receipt when the premium is paid/);
  assert.match(ph.copy.scopeNote ?? "", /match the amount you actually remitted/);
  assert.match(ph.copy.unconfirmedNote, /not confirmed that Linaw's CSV matches/);
});

test("Pag-IBIG's card separates workflow acceptance from final member posting", () => {
  const pi = FILING_FORMS.find((item) => item.agency === "Pag-IBIG")!;
  assert.match(pi.copy.answerLabel, /OPIN/);
  assert.match(pi.copy.scopeNote ?? "", /does not by itself prove/);
  assert.match(pi.copy.scopeNote ?? "", /finally posted to every member account/);
  assert.match(pi.copy.unconfirmedNote, /publishes MCRF spreadsheet encoding instructions/);
  assert.match(pi.copy.unconfirmedNote, /does not claim that this CSV is the agency-prescribed upload workbook/);
});

test("every Draft button on the exports page sends a kind the generator accepts", () => {
  const exporters = readFileSync("src/lib/exporters.ts", "utf8");
  const list = exporters.match(/const supportedKinds = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const supported = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const kinds = [...exportsView.matchAll(/kind: "([a-z0-9-]+)", detail:/g)].map((match) => match[1]);
  assert.equal(kinds.length, 4);
  for (const kind of kinds) assert.ok(supported.includes(kind), `"${kind}" is not a kind generateGovernmentDraft supports`);
  assert.ok(exportsView.includes("encodeURIComponent(item.kind)"), "the button must send the kind, not the visible label");
});

test("user-facing copy has no em-dashes", () => {
  assert.ok(!panel.includes(EM_DASH), "no em-dashes in the form");
  for (const definition of FILING_FORMS) {
    assert.ok(!JSON.stringify(definition.copy).includes(EM_DASH), `${definition.form} copy has an em-dash`);
  }
});

test("retired per-run 1604-C evidence card cannot create or accept source-only filings", () => {
  assert.ok(panel.includes("retiredBirAlphalistSource"));
  assert.ok(panel.includes("disabled={creating || records === null || !isFinalCutoff || retiredBirAlphalistSource}"));
  const store = readFileSync("src/lib/filing-evidence-store.ts", "utf8");
  assert.ok(store.includes("BIR 1604-C per-run filing evidence is retired."));
  const resolve = readFileSync("src/app/api/compliance/filing-validations/[id]/route.ts", "utf8");
  assert.ok(resolve.includes('existing.form === "1604-C"'));
});
