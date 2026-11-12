/** Restricted source-withdrawal writer. It cannot grant or renew any credit. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ORACLE_BASE = "e2999240e5ee2d820841de5e10193ce9cbc39e6a";
export const ORACLE_HELD_METHODS = Object.freeze([
  "GET payroll-runs", "POST payroll-runs", "GET payroll-runs/[id]/assurance",
  "GET payroll-runs/[id]/close", "POST payroll-runs/[id]/close",
  "GET payroll-runs/[id]/connected-impact", "GET payroll-runs/[id]/explain/[employeeId]",
  "GET payroll-runs/[id]/exports", "POST payroll-runs/[id]/exports",
  "GET payroll-runs/[id]/payout-reconciliation", "POST payroll-runs/[id]/payout-reconciliation",
  "POST payroll-runs/[id]/pilot-signoff", "GET payroll-runs/[id]/pre-run-readiness",
  "POST payroll-runs/[id]/process", "GET payroll-runs/[id]/release-checklist",
  "POST payroll-runs/[id]/release", "POST payroll-runs/[id]/submit-review",
  "GET payroll-runs/[id]/variance", "GET payroll-runs/[id]/xendit-payout",
]);
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const blob = text => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0" + text).digest("hex");
const sourceAtBase = path => execFileSync("git", ["show", ORACLE_BASE + ":" + path], { encoding: "utf8", maxBuffer: 64 << 20 });
export function withdrawRunOracleCredits({ write = false } = {}) {
  const original = JSON.parse(sourceAtBase(MANIFEST));
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const paths = Object.keys(original.allApiRouteFiles).filter(path => path.startsWith("src/app/api/payroll-runs/"));
  assert.equal(paths.length, 15, "full root + fourteen addressed routes required");
  const held = [];
  for (const path of paths) {
    const previous = original.allApiRouteFiles[path], current = manifest.allApiRouteFiles[path];
    const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    assert.ok(source.includes("findPayrollRunForMember"), path + ": missing membership boundary");
    assert.notEqual(blob(source), previous.gitBlobSha, path + ": source has not changed");
    current.gitBlobSha = blob(source);
    for (const old of previous.methods.filter(method => method.status === "COVERED")) {
      const method = current.methods.find(row => row.name === old.name);
      const hold = {
        kind: "payroll-run-membership-oracle-source-withdrawal", base: ORACLE_BASE,
        oldSourceBlobSha: previous.gitBlobSha, currentSourceBlobSha: current.gitBlobSha,
        priorProof: old.testedBy, coverageCredits: 0,
        evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", execution: "NOT_RUN",
        independentSecurityReview: "PENDING", productionCertified: false,
      };
      assert.ok(method.status === "COVERED" || method.status === "GAP");
      if (method.status === "GAP") assert.deepEqual(method.reviewedUncertified, hold, "unexpected existing hold");
      else assert.deepEqual(method.testedBy, old.testedBy, "concurrent proof must not be overwritten");
      method.status = "GAP"; method.testedBy = null; method.reviewedUncertified = hold;
      method.reason = "HELD: employer-membership run lookup changes this route source. Prior proof is historical only; fresh source-pinned PG16 real HTTP legitimate-positive, foreign/missing indistinguishability, forged selectors and unchanged-victim SQL are required. NOT_RUN; zero new credits.";
      held.push(old.name + " " + path);
    }
  }
  assert.equal(held.length, 19);
  const all = Object.values(manifest.allApiRouteFiles).flatMap(file => file.methods);
  for (const [field, status] of [["coveredAfter", "COVERED"], ["gap", "GAP"]])
    manifest.metrics[field] = all.filter(row => row.status === status).length;
  manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + manifest.metrics.gap + " API methods");
  const inventory = "docs/engineering/tenant-isolation-coverage-inventory.md";
  let doc = readFileSync(inventory, "utf8");
  for (const field of ["coveredAfter", "gap"])
    doc = doc.replace(new RegExp("^\\| " + field + " \\| \\d+ \\|$", "m"), "| " + field + " | " + manifest.metrics[field] + " |");
  const lines = doc.split("\n");
  for (const key of held) {
    const [method, ...parts] = key.split(" ");
    const route = parts.join(" ").replace("src/app/api/", "").replace("/route.ts", "");
    const at = lines.findIndex(line => line.startsWith("| [`" + route + "` " + method + "]"));
    assert.ok(at >= 0, "missing tracking row " + key);
    const cells = lines[at].split(" | ");
    cells[cells.length - 2] = "HELD — current-source PG16 renewal NOT_RUN; prior receipt historical only";
    cells[cells.length - 1] = "**GAP** |";
    lines[at] = cells.join(" | ");
  }
  doc = lines.join("\n");
  const prefix = "> **PAYROLL RUN ORACLE — SOURCE HOLD:** ";
  if (doc.startsWith(prefix)) doc = doc.slice(doc.indexOf("\n") + 1).replace(/^\n+/, "");
  doc = prefix + held.length + " prior credits held; " + manifest.metrics.coveredAfter + " COVERED / " + manifest.metrics.gap + " GAP. New source is NOT_RUN until fresh PG16 proof; historical receipts do not certify it.\n\n" + doc;
  if (write) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n"); writeFileSync(inventory, doc);
    const file = "docs/engineering/tenant-isolation-closure-plan.md";
    let closure = readFileSync(file, "utf8");
    const section = closure.split("### Batch DL-01 —")[1]?.split("## Page and server-action closure")[0];
    assert.ok(section);
    const total = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, "PRIVILEGED-OPERATIONS-TOKEN-ONLY": 0, GAP: 0 };
    for (const block of ("### Batch DL-01 —" + section).split("### Batch ").slice(1)) {
      const id = block.split(" ")[0], counts = { ...total };
      for (const key of Object.keys(counts)) counts[key] = 0;
      for (const line of block.split("\n").filter(line => line.startsWith("- `") && line.includes(" — [source](../../src/app/api/"))) {
        const verb = line.split("`")[1].split(" ")[0], path = line.split(" — [source](../../")[1].split("#L")[0];
        const status = manifest.allApiRouteFiles[path].methods.find(row => row.name === verb).status;
        assert.ok(Object.hasOwn(counts, status)); counts[status]++; total[status]++;
      }
      closure = closure.split("\n").map(line => {
        const cells = line.split("|"); if (cells.length !== 10 || cells[2].trim() !== "**" + id + "**") return line;
        for (const [i, key] of ["COVERED", "PUBLIC-BY-DESIGN", "PRIVILEGED-OPERATIONS-TOKEN-ONLY", "GAP"].entries()) cells[i + 4] = " " + counts[key] + " ";
        cells[8] = counts.GAP ? " INCOMPLETE " : " PROVISIONAL — NOT ACCEPTED "; return cells.join("|");
      }).join("\n");
    }
    assert.equal(Object.values(total).reduce((a, n) => a + n, 0), 406);
    closure = closure.replace(/Frozen subtotal[^\n]+/, line => line.replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,
      "**" + total.COVERED + " COVERED + " + total["PUBLIC-BY-DESIGN"] + " PUBLIC-BY-DESIGN + " + total["PRIVILEGED-OPERATIONS-TOKEN-ONLY"] + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + " + total.GAP + " GAP = 406**"));
    if (!closure.startsWith(prefix)) closure = prefix + held.length + " current-source methods need renewed proof. No fresh credit claimed.\n\n" + closure;
    writeFileSync(file, closure);
  }
  else assert.deepEqual(JSON.parse(readFileSync(MANIFEST, "utf8")), manifest, "run hold writer with --write");
  return { write, sourceBase: ORACLE_BASE, held: held.length, covered: manifest.metrics.coveredAfter,
    gap: manifest.metrics.gap, newCredits: 0, execution: "NOT_RUN" };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(["--check", "--write"].includes(process.argv[2]));
  console.log(JSON.stringify(withdrawRunOracleCredits({ write: process.argv[2] === "--write" })));
}
