import { mkdirSync, writeFileSync } from "node:fs";
import { buildSyntheticValidationCorpus } from "./qa/bir-1604c-validation-corpus";

const pack = buildSyntheticValidationCorpus(process.env.PR_HEAD_SHA ?? "");
const root = "qa-artifacts/bir-validation-corpus";
for (const file of pack.files) {
  mkdirSync(root + "/" + file.caseId, { recursive: true });
  writeFileSync(root + "/" + file.filename, file.content, "ascii");
}
writeFileSync(root + "/manifest.json", JSON.stringify(pack.manifest, null, 2) + "\n");
console.log("5 byte-bound fictional DAT cases generated. Official validator: NOT_RUN; submission: PROHIBITED.");
