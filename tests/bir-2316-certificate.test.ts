import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { CERTIFICATE_ITEMS, prepare2316Certificate } from "../src/lib/bir-2316-certificate";
import { historical2316Employer } from "../src/lib/bir-2316-employer";
import { render2316CertificatePdf } from "../src/lib/bir-2316-pdf";
import { certificateReview, certificateSource } from "./fixtures/bir-2316-certificate";
import { certificateSourceDigest } from "../src/lib/bir-2316-source-digest";
test("review token is stable across SQL ordering and changes with source identity, scope, totals or withholding", () => {
  const source = { ...certificateSource, withholding: { ...certificateSource.withholding!, entryIds: [2,1] } };
  const digest = certificateSourceDigest(source);
  assert.equal(certificateSourceDigest({ ...source, withholding: { ...source.withholding, entryIds: [1,2] } }), digest);
  for (const change of [{ employerName: "Changed registry identity" }, { legalEntityId: 2 }, { scope: { ...source.scope, organizationId: 2 } },
    { summary: { ...source.summary, grossCompensation: "600000.01" } }, { withholding: { ...source.withholding, actualPresentWithheld: "42500.01" } }]) assert.notEqual(certificateSourceDigest({ ...source, ...change }), digest);
});
test("complete explicit mapping reconciles all numbered amounts; browser withholding cannot override ledger", () => {
  const input = { ...certificateReview(), actualPresentWithheld: "99999999.00" };
  const result = prepare2316Certificate(certificateSource, input);
  assert.equal(result.ok, true); assert.equal(result.amounts["25A"], 4250000);
  assert.equal(result.amounts["38"], 10000000); assert.equal(result.amounts["52"], 50000000);
  assert.equal(result.amounts["28"], 4250000); assert.deepEqual(result.issues, []);
});
test("missing mapping, false zero evidence, one cent variance, malformed dates and unsigned acknowledgement block", () => {
  for (const change of [
    { detailItems: {} }, { peraCredit: "" }, { previousEmployer: { status: "" } }, { acknowledged: false },
    { detailItems: { ...certificateReview().detailItems, "39": "500000.01" } },
    { detailItems: { ...certificateReview().detailItems, "44A": "1.00", "39": "499999.00" } },
    { detailItems: { ...certificateReview().detailItems, "30": "1.00", "35": "9999.00" } },
    { previousEmployer: { status: "none-confirmed", taxWithheld: "5.00" } },
  ]) assert.equal(prepare2316Certificate(certificateSource, { ...certificateReview(), ...change }).ok, false);
  assert.equal(prepare2316Certificate({ ...certificateSource, birthDate: "2025-99-01" }, certificateReview()).ok, false);
  assert.equal(prepare2316Certificate({ ...certificateSource, withholding: undefined }, certificateReview()).ok, false);
  assert.equal(prepare2316Certificate({ ...certificateSource, withholding: { ...certificateSource.withholding!, issues: ["UNSETTLED_ADJUSTMENT"] } }, certificateReview()).ok, false);
});
test("previous employer and PERA need references and reconcile against approved combined source", () => {
  const review = { ...certificateReview(), previousEmployer: { status: "verified", name: "Prior Fictional Co.", tin: "987654321-0001", address: "Prior Street", zip: "1000", reference: "Fictional prior 2316", taxableCompensation: "100000.00", taxWithheld: "19900.00" }, peraCredit: "100.00" };
  assert.equal(prepare2316Certificate(certificateSource, review).ok, false, "current present-only annualization must not accept extra credit");
  assert.ok(prepare2316Certificate(certificateSource, { ...review, previousEmployer: { ...review.previousEmployer, taxWithheld: "0.00" }, peraCredit: "0.00" }).issues.includes("APPROVED_COMBINED_TAX_DUE_MISMATCH"));
  const source = { ...certificateSource, summary: { ...certificateSource.summary, taxDue: "62500.00" } };
  const prepared = prepare2316Certificate(source, review);
  assert.equal(prepared.ok, true); assert.equal(prepared.amounts["23"], 60000000); assert.equal(prepared.amounts["25B"], 1990000); assert.equal(prepared.amounts["27"], 10000);
});
test("historical employer resolves frozen inactive entity after employee transfer; no tenant or org fallback", () => {
  const legacy = { name: "Workspace", legalName: null, birTin: "999999999", birBranchCode: "0000" };
  const entities = [{ id: 7, organizationId: 1, legalName: "Historical Co.", birTin: "123456789", birBranchCode: "0001" }, { id: 8, organizationId: 1, legalName: "New employer", birTin: "987654321", birBranchCode: "0002" }];
  const input = { organizationId: 1, snapshot: { sourceFingerprint: { employeeLegalEntityId: 7 } }, entities, legacy };
  assert.deepEqual(historical2316Employer(input), { ok: true, name: "Historical Co.", tin: "123456789-0001", legalEntityId: 7 });
  for (const change of [{ organizationId: 2 }, { entities: [entities[1]] }, { snapshot: {} }, { snapshot: { sourceFingerprint: { employeeLegalEntityId: null } } }, { entities: [{ ...entities[0], birBranchCode: "" }] }]) assert.equal(historical2316Employer({ ...input, ...change }).ok, false);
  assert.equal(historical2316Employer({ ...input, entities: [], snapshot: { sourceFingerprint: { employeeLegalEntityId: null } } }).ok, true);
});
test("actual prescribed template output has all mapped values and leaves signature fields untouched", async () => {
  const bytes = await render2316CertificatePdf(certificateSource, certificateReview());
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1); assert.equal(pdf.getPage(0).getWidth(), 612); assert.equal(pdf.getPage(0).getHeight(), 936);
  assert.equal(pdf.getForm().getFields().length, 0, "original template has no AcroForm; do not invent certified fields");
  const contents = pdf.getPage(0).node.Contents();
  assert.ok(contents && "size" in contents);
  let operations = "";
  for (let i = 0; i < contents.size(); i++) { const stream = pdf.context.lookup(contents.get(i)); if (stream instanceof PDFRawStream) operations += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"); }
  for (const value of ["Santos, Maria", "Synthetic Employer Co.", "500,000.00", "100,000.00", "42,500.00", "DRAFT - UNSIGNED"]) assert.ok(operations.toUpperCase().includes(Buffer.from(value, "latin1").toString("hex").toUpperCase()), value + " must be painted in PDF content");
  assert.match(pdf.getTitle()!, /Unsigned/);
  if (process.env.BIR_2316_PDF_QA === "true") { await mkdir("qa-artifacts/bir-1604c", { recursive: true }); await writeFile("qa-artifacts/bir-1604c/2316-unsigned-synthetic.pdf", bytes); }
  await assert.rejects(render2316CertificatePdf(certificateSource, {}), /REVIEW_INCOMPLETE/);
});
test("every detail amount is painted inside its corresponding original government-template box", async () => {
  // Box bounds independently extracted from the blank BIR PDF's rectangle
  // operators, in official item order. These are not renderer coordinates.
  const boxes = [[779.38,15.181],[760.44,15.093],[740.68,14.91],[720.61,14.756],[700.39,14.994],[681.05,14.899],[662.17,14.822],[642.92,14.629],[623.51,14.788],
    [566.47,14.994],[547.13,14.899],[527.84,15.229],[508.41,15.215],[489.19,15.374],[461.8,15.374],[443.83,15.374],[418.11,14.801],[398.67,15.401],[379.23,15.401],[359.79,15.401],[340.35,15.401],[320.91,15.401],[291.75,15.401],[272.31,15.401]];
  const detailItems = Object.fromEntries(CERTIFICATE_ITEMS.map((key,i) => [key, ((i + 1) * 10 + i / 100).toFixed(2)]));
  const sum = (keys: readonly string[]) => keys.reduce((total,key) => total + Math.round(Number(detailItems[key]) * 100),0) / 100;
  const exempt = sum(CERTIFICATE_ITEMS.slice(0,9)), taxable = sum(CERTIFICATE_ITEMS.slice(9));
  const source = { ...certificateSource, mwe: true, summary: { grossCompensation: (exempt + taxable).toFixed(2), nonTaxable: exempt.toFixed(2), taxableIncome: taxable.toFixed(2), taxDue: "0.00", withheldBeforeYearEnd: "0.00", yearEndAdjustment: "0.00" }, withholding: { actualPresentWithheld: "0.00", appliedAdjustment: "0.00", issues: [], entryIds: [1] } };
  const review = certificateReview();
  const bytes = await render2316CertificatePdf(source, { ...review, detailItems, text: { ...review.text, minimumDaily: "700.00", minimumMonthly: "18200.00", "44A": "Fictional A", "44B": "Fictional B", "51A": "Fictional C", "51B": "Fictional D" } });
  const pdf = await PDFDocument.load(bytes), contents = pdf.getPage(0).node.Contents();
  assert.ok(contents && "size" in contents);
  let operations = "";
  for (let i = 0; i < contents.size(); i++) { const stream = pdf.context.lookup(contents.get(i)); if (stream instanceof PDFRawStream) operations += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"); }
  const painted = [...operations.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<([0-9A-F]+)> Tj/gi)].map(m => ({ x: Number(m[1]), y: Number(m[2]), text: Buffer.from(m[3],"hex").toString("latin1") }));
  CERTIFICATE_ITEMS.forEach((key,i) => {
    const value = painted.find(p => p.text === detailItems[key]);
    assert.ok(value, "Item " + key + " text exists");
    assert.ok(value.x > 484 && value.x < 585 && value.y > boxes[i][0] && value.y + 8 <= boxes[i][0] + boxes[i][1], "Item " + key + " fits its original box");
  });
});
