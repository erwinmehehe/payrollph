import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { findFilingForm, FILING_FORMS, parseFilingOutcome } from "../src/lib/filing-evidence";
import { officialFilingGuidance, PH_FILING_PORTALS } from "../src/lib/ph-filing-portal-guidance";

test("every filing-evidence form has official portal instructions, without claiming a certified worksheet", () => {
  for (const definition of FILING_FORMS) {
    const guide = officialFilingGuidance(definition.agency, definition.form);
    assert.ok(guide, `missing official instructions for ${definition.agency} ${definition.form}`);
    assert.ok(guide?.officialInstructionsUrl.startsWith("https://"));
    assert.ok(guide?.officialPortalUrl.startsWith("https://"));
    assert.equal(guide?.worksheetStatus, "reconciliation-only");
    assert.ok(guide!.acceptanceEvidence.length > 20);
    assert.ok(guide!.acceptanceChecklist.length >= 3, `missing independent pilot checklist: ${definition.agency} ${definition.form}`);
    assert.ok(guide!.acceptanceChecklist.every((item) => item.trim().length > 35));
  }
  assert.equal(PH_FILING_PORTALS.length, FILING_FORMS.length + 1, "BIR 2316 annual certificate has separate guidance");
  assert.equal(officialFilingGuidance("BIR", "2316")?.form, "2316");
});

test("official workflow references remain agency-specific and version proof remains independent", () => {
  assert.match(officialFilingGuidance("SSS", "R-3")!.notes, /no verified agency import acceptance/);
  assert.match(officialFilingGuidance("PhilHealth", "RF-1")!.notes, /not upload-format certification/);
  assert.match(officialFilingGuidance("Pag-IBIG", "MCRF")!.workflow, /eSRS/);
  assert.match(officialFilingGuidance("BIR", "1601-C")!.notes, /No PayrollPH.*import capability/);
  assert.match(officialFilingGuidance("BIR", "1604-C")!.notes, /never certifies an official DAT/);
  assert.deepEqual(findFilingForm("BIR", "1601-C")?.submissionMethods, ["manual_entry"]);
  assert.equal(findFilingForm("BIR", "2316"), null, "2316 is not a supported agency-file upload");
});

test("receipt dates reject impossible and non-ISO calendar input", () => {
  const input = {
    outcome: "accepted", submissionMethod: "manual_entry",
    agencyReference: "BIR-RECEIPT-0001", submittedAt: "2026-10-10",
  };
  const now = new Date("2026-10-11T10:00:00Z");
  assert.equal(parseFilingOutcome(input, now).ok, true);
  for (const submittedAt of ["2026-02-30", "2026-13-01", "2026-00-01", "10/10/2026", "2026-10-11Tbad"]) {
    assert.equal(parseFilingOutcome({ ...input, submittedAt }, now).ok, false, submittedAt);
  }
});

test("agency acceptance never exposes internal verification and SQL errors to a client", () => {
  const route = readFileSync("src/app/api/compliance/filing-validations/[id]/route.ts", "utf8");
  assert.ok(route.includes("Filing acceptance could not be verified against the released source."));
  assert.ok(route.includes("Refresh and regenerate the filing evidence before retrying."));
  assert.ok(!route.includes("error instanceof Error ? error.message"));
  assert.ok(route.includes("recordFilingOutcome({ organizationId, id"));
});

test("2316 issuance stays distinct from annual Alphalist validation in product readiness", () => {
  const guide = officialFilingGuidance("BIR", "2316")!;
  assert.match(guide.officialInstructionsUrl, /2316.*pdf/i);
  assert.match(guide.notes, /separate from the annual Alphalist/);
  assert.match(guide.acceptanceChecklist.join(" "), /January 31/);
  assert.equal(findFilingForm("BIR", "2316"), null, "Form 2316 must not be advertised as a monthly import workflow");
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(readiness.includes('label: "BIR annual Alphalist / ADES acceptance (Form 2316 tracked separately)"'));
  assert.ok(!readiness.includes("BIR Alphalist / 2316 validated in ADES"));
  assert.ok(readiness.includes("Alphalist status never proves its issuance or signatures"));
  const route = readFileSync("src/app/api/compliance/filing-validations/route.ts", "utf8");
  assert.ok(route.includes('officialFilingGuidance("BIR", "2316")'));
  const panel = readFileSync("src/components/workspace/filing-evidence.tsx", "utf8");
  assert.ok(panel.includes("definition?.relatedCertificate"));
  assert.ok(panel.includes("View official BIR Form 2316"));
});

test("eSRS guidance does not confuse a Pag-IBIG MCRF reconciliation CSV with prescribed MSRF upload", () => {
  const guide = officialFilingGuidance("Pag-IBIG", "MCRF")!;
  assert.match(guide.notes, /MSRF.*MCRF/);
  assert.match(guide.acceptanceChecklist.join(" "), /eSRS MSRF upload/);
  const panel = readFileSync("src/components/workspace/filing-evidence.tsx", "utf8");
  assert.ok(panel.includes("official.acceptanceChecklist.map("));
  assert.ok(panel.includes("An operator-entered agency reference records a claim of acceptance."));
});
