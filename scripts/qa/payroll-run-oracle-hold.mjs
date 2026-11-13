/** Restricted source-withdrawal writer. It cannot grant or renew any credit. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { payrollRenewalProofBuilder } from './payroll-run-credit-renewal-verify.mjs';

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
/** Recognize only this exact source withdrawal; never restore a method credit.
 * Historical receipts are compared against trusted Git, not caller-provided
 * metadata. All fifteen route sources and the shared boundary stay sealed. */
export function verifyOracleSourceHolds(manifest, before = null, read = readFileSync) {
  const candidate = manifest.allApiRouteFiles?.["src/app/api/payroll-runs/[id]/assurance/route.ts"]?.gitBlobSha === "033efd5f84319b510ce7551305dcbdc319eb98ea" || Object.values(manifest.allApiRouteFiles ?? {}).some(file =>
    file.methods?.some(row => row.reviewedUncertified?.kind === "payroll-run-membership-oracle-source-withdrawal"));
  if (!candidate) return new Set();
  // CI consumers can have shallow clones. This immutable projection was copied
  // from ORACLE_BASE; its digest seals the original route blobs and method
  // receipts without requiring a network fetch or trusting candidate metadata.
  const historicalText = read("scripts/qa/payroll-run-oracle-historical-proofs.json", "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(historicalText).digest("hex"),
    "b2d575453d9321b64f0d545f184fb62514520d38fc65b6c944e954c5bbf9bc00", "historical source-withdrawal receipts changed");
  const historical = JSON.parse(historicalText);
  assert.equal(historical.base, ORACLE_BASE);
  const paths = Object.keys(historical.allApiRouteFiles).filter(path => path.startsWith("src/app/api/payroll-runs/")).sort((a, b) => a.localeCompare(b));
  const pins = {};
  for (const path of paths) {
    pins[path] = blob(read(path, "utf8").replaceAll("\r\n", "\n"));
    assert.equal(manifest.allApiRouteFiles[path].gitBlobSha, pins[path], "held route source pin mismatch");
  }
  assert.equal(createHash("sha256").update(JSON.stringify(pins)).digest("hex"),
    "d5517d81ac09acd825cec137be432adee850de267c29cda8b9c9ff3746446115", "unreviewed payroll oracle route revision");
  assert.equal(blob(read("src/lib/payroll-run-membership.ts", "utf8").replaceAll("\r\n", "\n")),
    "75f5a40afd1ee4f608a2fe38be9971f4bc8bed47", "unreviewed shared membership boundary");
  const allowed = new Set();let renewed=0,renewalProof;
  for (const path of paths) for (const old of historical.allApiRouteFiles[path].methods.filter(row => row.status === "COVERED")) {
    const row = manifest.allApiRouteFiles[path].methods.find(row => row.name === old.name);
    const exactWithdrawal={
      kind: "payroll-run-membership-oracle-source-withdrawal", base: ORACLE_BASE,
      oldSourceBlobSha: historical.allApiRouteFiles[path].gitBlobSha, currentSourceBlobSha: pins[path],
      priorProof: old.testedBy, coverageCredits: 0, evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY",
      execution: "NOT_RUN", independentSecurityReview: "PENDING", productionCertified: false,
    };
    if(row.status==='COVERED'){
      // A truthy receipt or removed hold never suffices. All actual job results,
      // executed application/assertion inputs and the original withdrawal must
      // verify before accepting this exact, separately generated renewal.
      renewalProof??=payrollRenewalProofBuilder(read);
      assert.deepEqual(row.testedBy,renewalProof(old.name+' '+manifest.allApiRouteFiles[path].route));
      assert.equal(row.reviewedUncertified,undefined);
      assert.deepEqual(row.historicalOracleSourceWithdrawal,exactWithdrawal);
      renewed++;continue;
    }
    assert.equal(row.status,"GAP","Changed payroll-run source requires a separately reviewed method renewal");
    const hold = row.reviewedUncertified;
    assert.equal(row.testedBy, null);
    assert.deepEqual(hold, exactWithdrawal);
    const prior = before?.allApiRouteFiles?.[path]?.methods.find(method => method.name === old.name);
    if (prior?.status === "COVERED") {
      assert.equal(before.allApiRouteFiles[path].gitBlobSha, historical.allApiRouteFiles[path].gitBlobSha);
      assert.deepEqual(prior.testedBy, old.testedBy, "a different base proof cannot be withdrawn implicitly");
    }
    allowed.add(old.name + " " + path);
  }
  assert.equal(allowed.size+renewed,ORACLE_HELD_METHODS.length,'Every original withdrawal must be held or separately execution-verified');
  return allowed;
}
export function isVerifiedOracleHold(manifest, path, verb) {
  const row=manifest.allApiRouteFiles[path]?.methods.find(method=>method.name===verb);
  if(row?.status!=="GAP" || row.reviewedUncertified?.kind!=="payroll-run-membership-oracle-source-withdrawal") return false;
  assert.ok(verifyOracleSourceHolds(manifest).has(verb+" "+path));
  return true;
}
export function isVerifiedOracleRenewal(manifest,path,verb){
  const row=manifest.allApiRouteFiles[path]?.methods.find(method=>method.name===verb);
  if(row?.status!=='COVERED'||row.testedBy?.kind!=='payroll-run-source-renewal-real-http-pg16')return false;
  assert.ok(ORACLE_HELD_METHODS.includes(verb+' '+manifest.allApiRouteFiles[path].route));
  verifyOracleSourceHolds(manifest);return true;
}
/** Historical receipt checks may be replaced only by a fully verified source
 * withdrawal OR the distinct new executed renewal, never a truthy receipt. */
export function isVerifiedOracleSupersession(manifest,path,verb){
  return isVerifiedOracleHold(manifest,path,verb)||isVerifiedOracleRenewal(manifest,path,verb);
}
export function verifiedOracleRenewalKeys(manifest){
  verifyOracleSourceHolds(manifest);
  return new Set(ORACLE_HELD_METHODS.flatMap(key=>{
    const at=key.indexOf(' '),verb=key.slice(0,at),path='src/app/api/'+key.slice(at+1)+'/route.ts';
    const row=manifest.allApiRouteFiles[path].methods.find(m=>m.name===verb);
    return row.status==='COVERED'&&row.testedBy?.kind==='payroll-run-source-renewal-real-http-pg16'?[verb+' '+path]:[];
  }));
}

export function withdrawRunOracleCredits({ write = false } = {}) {
  const currentManifest=JSON.parse(readFileSync(MANIFEST,'utf8'));
  if(Object.values(currentManifest.allApiRouteFiles).some(file=>file.methods.some(row=>
    row.status==='COVERED'&&row.testedBy?.kind==='payroll-run-source-renewal-real-http-pg16'))){
    const remaining=verifyOracleSourceHolds(currentManifest);
    assert.equal(write,false,'The original withdrawal writer cannot overwrite verified renewals');
    return {write,sourceBase:ORACLE_BASE,held:remaining.size,covered:currentManifest.metrics.coveredAfter,
      gap:currentManifest.metrics.gap,newCredits:0,execution:'SOURCE_RENEWALS_VERIFIED'};
  }
  const original = JSON.parse(sourceAtBase(MANIFEST));
  const archived = JSON.parse(readFileSync("scripts/qa/payroll-run-oracle-historical-proofs.json", "utf8"));
  const projection = Object.fromEntries(Object.entries(original.allApiRouteFiles)
    .filter(([path]) => path.startsWith("src/app/api/payroll-runs/"))
    .map(([path, file]) => [path, { gitBlobSha: file.gitBlobSha,
      methods: file.methods.map(({ name, status, testedBy }) => ({ name, status, testedBy })) }]));
  assert.deepEqual(archived, { base: ORACLE_BASE, allApiRouteFiles: projection },
    "archived receipts must be an exact projection of the original Git manifest");
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
  const updateLiveBanner = text => text.replace(/(complete Studio POST proposal:\*\* )\d+ methods = \d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP\./g,
    "$1" + manifest.metrics.methods + " methods = " + manifest.metrics.coveredAfter + " COVERED + " + manifest.metrics.publicByDesign + " PUBLIC-BY-DESIGN + " + manifest.metrics.privilegedOperationsTokenOnly + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + " + manifest.metrics.gap + " GAP.");
  doc = updateLiveBanner(doc).replace(/(\*\*RELEASE BLOCKER:\*\* )\d+ API methods/g, "$1" + manifest.metrics.gap + " API methods")
    .replace(/(\*\*NOT ACCEPTED\*\*: )\d+ method gaps/g, "$1" + manifest.metrics.gap + " method gaps");
  const prefix = "> **PAYROLL RUN ORACLE — SOURCE HOLD:** ";
  if (doc.startsWith(prefix)) doc = doc.slice(doc.indexOf("\n") + 1).replace(/^\n+/, "");
  doc = prefix + held.length + " prior credits held; " + manifest.metrics.coveredAfter + " COVERED / " + manifest.metrics.gap + " GAP. Complete method-positive renewal remains NOT_RUN; the separate boundary regression grants zero credits.\n\n" + doc;
  if (write) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n"); writeFileSync(inventory, doc);
    const file = "docs/engineering/tenant-isolation-closure-plan.md";
    let closure = readFileSync(file, "utf8");
    const section = closure.split("### Batch DL-01 —")[1]?.split("## Page and server-action closure")[0];
    assert.ok(section);
    const total = { COVERED: 0, "PUBLIC-BY-DESIGN": 0, "PRIVILEGED-OPERATIONS-TOKEN-ONLY": 0, GAP: 0 }, provisional = [];
    for (const block of ("### Batch DL-01 —" + section).split("### Batch ").slice(1)) {
      const id = block.split(" ")[0], counts = { ...total };
      for (const key of Object.keys(counts)) counts[key] = 0;
      for (const line of block.split("\n").filter(line => line.startsWith("- `") && line.includes(" — [source](../../src/app/api/"))) {
        const verb = line.split("`")[1].split(" ")[0], path = line.split(" — [source](../../")[1].split("#L")[0];
        const status = manifest.allApiRouteFiles[path].methods.find(row => row.name === verb).status;
        assert.ok(Object.hasOwn(counts, status)); counts[status]++; total[status]++;
      }
      if (counts.GAP === 0) provisional.push(id);
      closure = closure.split("\n").map(line => {
        const cells = line.split("|"); if (cells.length !== 10 || cells[2].trim() !== "**" + id + "**") return line;
        for (const [i, key] of ["COVERED", "PUBLIC-BY-DESIGN", "PRIVILEGED-OPERATIONS-TOKEN-ONLY", "GAP"].entries()) cells[i + 4] = " " + counts[key] + " ";
        cells[8] = counts.GAP ? " INCOMPLETE " : " PROVISIONAL — NOT ACCEPTED "; return cells.join("|");
      }).join("\n");
    }
    assert.equal(Object.values(total).reduce((a, n) => a + n, 0), 406);
    const outside = [
      [manifest.metrics.coveredAfter - total.COVERED, "COVERED"],
      [manifest.metrics.publicByDesign - total["PUBLIC-BY-DESIGN"], "PUBLIC-BY-DESIGN"],
      [manifest.metrics.privilegedOperationsTokenOnly - total["PRIVILEGED-OPERATIONS-TOKEN-ONLY"], "PRIVILEGED-OPERATIONS-TOKEN-ONLY"],
      [manifest.metrics.gap - total.GAP, "GAP"],
    ];
    assert.ok(outside.every(([n]) => Number.isSafeInteger(n) && n >= 0));
    closure = closure.replace(/^Frozen subtotal[^\n]+/m, line => line.replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,
      "**" + total.COVERED + " COVERED + " + total["PUBLIC-BY-DESIGN"] + " PUBLIC-BY-DESIGN + " + total["PRIVILEGED-OPERATIONS-TOKEN-ONLY"] + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + " + total.GAP + " GAP = 406**")
      .replace(/\d+ batches remain INCOMPLETE; [^.]+ remain PROVISIONAL — NOT ACCEPTED\./,
        (12 - provisional.length) + " batches remain INCOMPLETE; " + provisional.join(", ") + " remain PROVISIONAL — NOT ACCEPTED.")
      .replace(/Relative to the live \d+-method ledger, the other \*\*\d+ methods\*\* are \*\*[^*]+\*\*\./,
        "Relative to the live " + manifest.metrics.methods + "-method ledger, the other **" + (manifest.metrics.methods - 406) + " methods** are **" + outside.filter(([n]) => n > 0).map(([n, status]) => n + " " + status).join(" + ") + "**."));
    const queueHeading = "## Supplemental payroll-run source-withdrawal renewals";
    if (closure.includes(queueHeading)) closure = closure.replace(new RegExp(queueHeading + "[\\s\\S]*?(?=\\n## |$)"), "").trimEnd();
    const frozen = new Set([...closure.matchAll(/^- `(GET|POST|PATCH|PUT|DELETE) \/api\/([^`]+)` — \[source\]/gm)].map(match => match[1] + " " + match[2]));
    const supplemental = ORACLE_HELD_METHODS.filter(key => !frozen.has(key));
    closure += "\n\n" + queueHeading + "\n\nThese source-withdrawn methods were outside the immutable 406-method queue. Each stays GAP until its own renewed proof; no frozen link is changed.\n\n" +
      supplemental.map(key => "- HELD `" + key.split(" ")[0] + " /api/" + key.split(" ").slice(1).join(" ") + "` — fresh exact-source PG16 HTTP required").join("\n") + "\n";
    closure = updateLiveBanner(closure);
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
