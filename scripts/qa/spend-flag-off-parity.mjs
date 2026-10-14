import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const ref = process.env.SPEND_PARITY_BASE ?? "origin/main";
assert.match(ref, /^(origin\/main|[a-f0-9]{40})$/);
await mkdir("qa-artifacts", { recursive: true });
const file = "src/components/wallet-panel.tsx";
const baseline = execFileSync("git", ["show", ref + ":" + file], { encoding: "utf8" });
const current = await readFile(file, "utf8");
const renders = [];
for (const [index, source] of [baseline, current].entries()) {
  const outfile = resolve("qa-artifacts/spend-parity-" + index + ".cjs");
  await build({ stdin: { contents: source, loader: "tsx", resolveDir: resolve("src/components") },
    outfile, bundle: true, platform: "node", jsx: "automatic", external: ["react", "react-dom", "lucide-react"] });
  renders.push(renderToStaticMarkup(React.createElement(require(outfile).ExpensesPanel, {
    organizationId: 1, setNotice() {}, reviewModeEnabled: false,
  })));
}
assert.equal(renders[1], renders[0], "Default-OFF initial expense markup must match current main exactly");
await writeFile("qa-artifacts/spend-off-parity.json", JSON.stringify({ result: "PASS", baseline: ref,
  bytes: Buffer.byteLength(renders[0]), boundary: "Executed SSR initial markup; asynchronous legacy API parity separately tested." }, null, 2));
console.log("PASS: default-OFF ExpensesPanel SSR markup equals baseline main (" + Buffer.byteLength(renders[0]) + " bytes).");
