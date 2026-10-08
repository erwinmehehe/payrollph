import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateParallelPayrollReconciliation } from "../src/lib/private-parallel-payroll-reconciliation";

const [manifestPath, privateRoot, modeArg, ...unexpected] = process.argv.slice(2);
if (!manifestPath || !privateRoot || unexpected.length > 0 || (modeArg && modeArg !== "--pilot")) {
  console.error(
    "Usage: npm run payroll:parallel:check -- <private-parallel-manifest.json> <private-evidence-directory> [--pilot]",
  );
  process.exitCode = 2;
} else {
  try {
    const path = resolve(manifestPath);
    if (statSync(path).size > 256 * 1024) throw new Error("Manifest too large.");
    const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
    const report = evaluateParallelPayrollReconciliation(
      manifest,
      resolve(privateRoot),
      { mode: modeArg === "--pilot" ? "pilot" : "certification" },
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.issues.length) process.exitCode = 1;
    // Success means arithmetic agreement in supplied PRIVATE normalized files.
    // It is NOT independent CPA approval or government/bank certification.
  } catch {
    console.error(
      "Private parallel reconciliation could not be completed. Check the manifest and evidence root locally; never paste payroll files into GitHub.",
    );
    process.exitCode = 1;
  }
}
