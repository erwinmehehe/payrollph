import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateParallelPayrollReconciliation } from "../src/lib/private-parallel-payroll-reconciliation";
import { evaluateExternalCertificationEvidence } from "../src/lib/external-certification-evidence";
import { evaluateExternalAcceptanceBindings } from "../src/lib/external-acceptance-bindings";

// Private, offline only. No government/bank request or payroll disbursement.
const args = process.argv.slice(2);
if (args.length !== 5) {
  console.error("Usage: npm run payroll:acceptance:check -- <parallel.json> <external.json> <bindings.json> <private-files-root> <exact-reviewed-40-char-commit-sha>");
  process.exitCode = 2;
} else {
  try {
    const [parallelPath, externalPath, bindingsPath, root, expectedEngineCommitSha] = args;
    function load(filePath: string): unknown {
      const absolute = resolve(filePath);
      const stats = statSync(absolute);
      if (!stats.isFile() || stats.size < 1 || stats.size > 256 * 1024) {
        throw new Error("Evidence manifest must be a nonempty file no larger than 256 KiB.");
      }
      return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    }
    const parallelManifest = load(parallelPath);
    const externalManifest = load(externalPath);
    const bindings = load(bindingsPath);
    const privateRoot = resolve(root);
    const parallelReport = evaluateParallelPayrollReconciliation(parallelManifest, privateRoot);
    const externalReport = evaluateExternalCertificationEvidence(externalManifest, privateRoot);
    const result = evaluateExternalAcceptanceBindings({
      parallelManifest,
      externalManifest,
      bindings,
      parallelReport,
      externalReport,
      expectedEngineCommitSha,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.issues.length) process.exitCode = 1;
    // Never substitute this local check for authentic external sign-off or GA.
  } catch {
    console.error("Private acceptance binding check failed; inspect files locally and never publish sensitive employer evidence.");
    process.exitCode = 1;
  }
}
