import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateExternalCertificationEvidence } from "../src/lib/external-certification-evidence";

const [manifestPath, evidenceRoot] = process.argv.slice(2);
if (!manifestPath || !evidenceRoot) {
  console.error(
    "Usage: npm run payroll:evidence:check -- <private-manifest.json> <private-evidence-directory>",
  );
  process.exitCode = 2;
} else {
  try {
    const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as unknown;
    const report = evaluateExternalCertificationEvidence(manifest, resolve(evidenceRoot));
    console.log(JSON.stringify(report, null, 2));
    if (report.issues.length > 0) process.exitCode = 1;
    // A zero exit code means the package is structurally ready for INDEPENDENT
    // HUMAN verification, not externally certified or portal/bank accepted.
  } catch (error) {
    console.error("Evidence package could not be checked:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
