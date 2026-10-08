import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateProductionCertificationBundle } from "../src/lib/production-certification-gates";

const args = process.argv.slice(2);
if (args.length !== 5) {
  console.error(
    "Usage: npm run payroll:ga:evidence -- <parallel.json> <external.json> <operational.json> <private-files-root> <exact-reviewed-commit-sha>",
  );
  process.exitCode = 2;
} else {
  try {
    const [parallelFile, externalFile, operationalFile, privateRoot, expectedEngineCommitSha] = args;
    const load = (filePath: string): unknown => {
      const absolute = resolve(filePath);
      const stat = statSync(absolute);
      if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024) {
        throw new Error("Private evidence manifest must be a nonempty file no larger than 256 KiB.");
      }
      return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    };
    const result = evaluateProductionCertificationBundle({
      parallelManifest: load(parallelFile),
      externalManifest: load(externalFile),
      operationalManifest: load(operationalFile),
      privateRoot: resolve(privateRoot),
      expectedEngineCommitSha,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.issues.length) process.exitCode = 1;
    // Zero exit ONLY means private structural/arithmetic evidence can be sent
    // to the independent release committee. It never authorizes GA.
  } catch {
    console.error(
      "Private GA evidence could not be assessed. Validate manifests and permissions locally; never paste employer payroll or bank data into CI/GitHub.",
    );
    process.exitCode = 1;
  }
}
