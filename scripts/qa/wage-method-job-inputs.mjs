/** Find literal repository inputs in workflow command text and historical receipts. */
import assert from "node:assert/strict";

export function literalJobInputs(commands, packageScripts, tracked) {
  const files = new Set();
  const scripts = new Set();
  function visit(command) {
    for (const token of command.matchAll(/[\w.@/\[\]-]+\.[a-zA-Z0-9]+/g)) {
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
