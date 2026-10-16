import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { prepare2316Certificate, type CertificateSource } from "./bir-2316-certificate";
export const BIR_2316_TEMPLATE_SHA256 = "8e927e65b096d7a786ba7d36c55c28ee3de3546278880d9de8c11a91d1b48d60";
/** Overlay the unchanged one-page government template. It has no AcroForm fields.
 * Signatures, signature dates and substituted-filing declarations stay blank. */
export async function render2316CertificatePdf(source: CertificateSource, input: unknown) {
  const prepared = prepare2316Certificate(source, input);
  if (!prepared.ok) throw new Error("CERTIFICATE_REVIEW_INCOMPLETE");
  const template = await readFile(process.cwd() + "/assets/bir/2316-september-2021-encs.pdf");
  if (createHash("sha256").update(template).digest("hex") !== BIR_2316_TEMPLATE_SHA256) throw new Error("CERTIFICATE_TEMPLATE_CHANGED");
  const pdf = await PDFDocument.load(template);
  if (pdf.getPageCount() !== 1) throw new Error("CERTIFICATE_TEMPLATE_CHANGED");
  const page = pdf.getPage(0), font = await pdf.embedFont(StandardFonts.Helvetica);
  const scale = 612 / 1176;
  const draw = (value: string, x: number, baseline: number, width: number, right = false, initial = 9) => {
    let size = initial;
    while (font.widthOfTextAtSize(value, size) > width * scale && size > 6) size -= .25;
    if (font.widthOfTextAtSize(value, size) > width * scale) throw new Error("CERTIFICATE_TEXT_DOES_NOT_FIT");
    page.drawText(value, { x: x * scale + (right ? width * scale - font.widthOfTextAtSize(value, size) : 0),
      y: 936 - baseline * scale, size, font, color: rgb(0, 0, 0) });
  };
  const f = prepared.fields;
  const tin = (value: string, baseline: number) => {
    const digits = value.replace(/-/g, "");
    // Template has groups 3 / 3 / 3 / 4 separated by printed hyphens.
    const xs = [176,200,224,273,297,321,369,393,417,463,497,531,565];
    for (let i = 0; i < digits.length; i++) draw(digits[i], xs[i], baseline, 16, false, 9);
  };
  draw(String(source.scope.taxYear), 251, 204, 115);
  const mmdd = (date: string) => date.slice(5,7) + "/" + date.slice(8,10);
  draw(mmdd(source.periodFrom), 752, 204, 115); draw(mmdd(source.periodTo), 995, 204, 115);
  tin(source.employeeTin, 259); tin(source.employerTin, 667);
  draw(source.employeeName, 88, 306, 393); draw(f.rdo, 516, 307, 60);
  draw(f.address, 88, 359, 393); draw(f.zip, 512, 360, 74);
  draw(f.homeAddress, 88, 410, 393); draw(f.homeZip, 512, 410, 74);
  draw(f.foreignAddress, 88, 459, 500);
  draw(source.birthDate!.slice(5,7) + "/" + source.birthDate!.slice(8,10) + "/" + source.birthDate!.slice(0,4), 100, 511, 175);
  draw(f.contact, 335, 511, 252);
  draw(f.minimumDaily, 410, 545, 177, true); draw(f.minimumMonthly, 410, 579, 177, true);
  if (source.mwe) draw("X", 96, 614, 20);
  draw(source.employerName, 83, 713, 502); draw(f.employerAddress, 87, 765, 395); draw(f.employerZip, 511, 766, 75);
  draw("X", prepared.employerType === "main" ? 227 : 388, 800, 20);
  if (prepared.previousStatus === "verified") {
    tin(f.previoustin, 852); draw(f.previousname, 85, 901, 503); draw(f.previousaddress, 85, 950, 397); draw(f.previouszip, 510, 950, 70);
  }
  for (const [key, y] of Object.entries({"44A":903,"44B":939,"51A":1233,"51B":1269})) draw(f[key], 665, y, 240);
  const money = (value: number) => (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ys: Record<string, number> = {"29":294,"30":330,"31":369,"32":407,"33":446,"34":484,"35":521,"36":558,"37":595,"38":631,"39":704,"40":741,"41":779,"42":817,"43":854,"44A":905,"44B":941,"45":989,"46":1026,"47":1064,"48":1102,"49":1139,"50":1177,"51A":1234,"51B":1271,"52":1307};
  for (const [key, y] of Object.entries(ys)) draw(money(prepared.amounts[key]!), 938, y, 182, true, 8);
  const leftYs: Record<string, number> = {"19":1007,"20":1045,"21":1084,"22":1122,"23":1158,"24":1196,"25A":1234,"25B":1272,"26":1310,"27":1348,"28":1386};
  for (const [key, y] of Object.entries(leftYs)) draw(money(prepared.amounts[key]!), 438, y, 147, true, 8);
  page.drawText("DRAFT - UNSIGNED", { x: 100, y: 410, size: 40, font, rotate: degrees(35), color: rgb(.7,.1,.1), opacity: .14 });
  page.drawText("PREPARER PREVIEW - REVIEW AND SIGNATURES REQUIRED - NOT FOR FILING", { x: 38, y: 10, size: 7, font, color: rgb(.65,0,0) });
  pdf.setTitle("Unsigned BIR Form 2316 preparer preview");
  pdf.setSubject("No signatures, substituted-filing election, agency acceptance or tax certification asserted.");
  // Remove any metadata inherited from the blank template; never store full TIN in audit/log metadata.
  pdf.setAuthor("PayrollPH"); pdf.setKeywords(["2316", "unsigned", "draft"]);
  return pdf.save();
}
