// Safe optimization: only Markdown at known documentation locations can
// bypass heavy CI. MDX may be executable in Next.js, and Markdown under source,
// scripts or test directories can influence applications and test fixtures.
// Unknown/empty comparisons and all non-PR events always run full CI.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_ROOT_DOCS = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
]);

export function isDocsOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every((path) =>
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\0") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    (
      SAFE_ROOT_DOCS.has(path) ||
      /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(path)
    )
  );
}

function main() {
  let docsOnly = false;
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const base = process.env.PR_BASE_SHA || "";
    const head = process.env.PR_HEAD_SHA || "";
    if (!/^[a-f0-9]{40}$/i.test(base) || !/^[a-f0-9]{40}$/i.test(head)) {
      throw new Error("Missing or invalid exact PR base/head SHA; fail closed");
    }
    // Compare exact PR commits, not the synthetic merge checkout.
    // --no-renames includes both removed and added paths on a rename.
    execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", base, head], {
      stdio: "pipe",
    });
    const changed = execFileSync(
      "git", ["diff", "--no-renames", "--name-only", "-z", base, head, "--"],
      { encoding: "utf8" },
    ).split("\0").filter(Boolean);
    docsOnly = isDocsOnly(changed);
    process.stdout.write("Changed paths: " + changed.length + "; Markdown-only: " + docsOnly + "\n");
  } else {
    process.stdout.write("Non-PR event: full CI required\n");
  }
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_OUTPUT is required in CI to preserve fail-closed gates");
  }
  appendFileSync(process.env.GITHUB_OUTPUT, "docs_only=" + docsOnly + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
