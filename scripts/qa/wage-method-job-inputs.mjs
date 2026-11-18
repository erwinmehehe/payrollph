/** Find literal repository inputs in workflow command text and historical receipts. */
import assert from "node:assert/strict";

const TABLE_ROWS = [
  "scripts/qa/tenant-table-rows/read/",
  "scripts/qa/tenant-table-rows/write/",
];
const TABLE_CONSUMERS = new Set([
  "scripts/qa/tenant-table-catalog.mjs",
  "scripts/qa/tenant-table-http.mjs",
  "scripts/qa/tenant-write-table-http.mjs",
]);

/** Track directory membership as well as bytes for the reviewed table catalog. */
export function reviewedTableInputs(inputs, tracked, listDirectory) {
  if (![...inputs].some((file) => TABLE_CONSUMERS.has(file))) return [];
  return TABLE_ROWS.flatMap((prefix) => {
    const names = listDirectory(prefix).sort();
    assert.ok(names.length && names.every((name) => /^[a-z][a-z0-9-]*\.mjs$/.test(name)),
      "Unexpected tenant table directory entries: " + prefix);
    const files = names.map((name) => prefix + name);
    const expected = [...tracked].filter((file) => file.startsWith(prefix)).sort();
    assert.deepEqual(files, expected, "Tenant table directory must match tracked inputs: " + prefix);
    return files;
  });
}

export function literalJobInputs(commands, packageScripts, tracked) {
  const files = new Set();
  const scripts = new Set();
  function visit(command) {
    // Workflows use these checkout-root prefixes to construct absolute paths.
    // Expand these literal prefixes only; never evaluate shell expressions.
    const rooted = command.replaceAll("$(pwd)/", "./")
      .replace(/\$\{GITHUB_WORKSPACE\}\/|\$GITHUB_WORKSPACE\//g, "./");
    for (const token of rooted.matchAll(/[\w.@/\[\]-]+\.[a-zA-Z0-9]+/g)) {
      const path = token[0].replace(/^\.\//, "");
      if (tracked.has(path)) files.add(path);
    }
    for (const match of command.matchAll(/\bnpm\s+(?:run(?:-script)?\s+([\w:-]+)|(test|start|stop|restart)\b)/g)) {
      const name = match[1] ?? match[2];
      for (const script of ["pre" + name, name, "post" + name]) {
        if (!Object.hasOwn(packageScripts, script) || scripts.has(script)) continue;
        scripts.add(script);
        visit(packageScripts[script]);
      }
    }
  }
  for (const command of commands) visit(command);
  return [...files].sort();
}

export function historicalReceiptInputs(receipt, read, tracked) {
  if (!receipt) return [];
  const roots = new Set();
  const visited = new Set();
  function visit(value) {
    if (typeof value === "string") {
      if (tracked.has(value)) roots.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (tracked.has(key)) roots.add(key);
        if (/receiptFile$/i.test(key) && typeof entry === "string") visitReceipt(entry);
        else visit(entry);
      }
    }
  }
  function visitReceipt(path) {
    if (visited.has(path)) return;
    assert.ok(tracked.has(path), "Untracked historical receipt: " + path);
    visited.add(path);
    roots.add(path);
    visit(JSON.parse(read(path)));
  }
  visitReceipt(receipt);
  return [...roots].sort();
}
