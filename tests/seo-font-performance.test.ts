import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("root layout uses Next font optimization for public typography", () => {
  const layout = read("src/app/layout.tsx");

  assert.ok(layout.includes('import { Inter, JetBrains_Mono } from "next/font/google";'));
  assert.ok(layout.includes('variable: "--font-inter"'));
  assert.ok(layout.includes('variable: "--font-jetbrains-mono"'));
  assert.ok(layout.includes('display: "swap"'));
  assert.ok(layout.includes('className={`${inter.variable} ${jetBrainsMono.variable}`}'));
});

test("root layout does not make runtime Google Fonts stylesheet requests", () => {
  const layout = read("src/app/layout.tsx");

  assert.ok(!layout.includes("fonts.googleapis.com"));
  assert.ok(!layout.includes("fonts.gstatic.com"));
  assert.ok(!layout.includes("family=Inter"));
  assert.ok(!layout.includes("rel=\"preconnect\""));
});

test("design system font variables consume next/font variables with fallbacks", () => {
  const css = read("src/app/globals.css");

  assert.ok(css.includes("--font-sans: var(--font-inter)"));
  assert.ok(css.includes("--font-mono: var(--font-jetbrains-mono)"));
  assert.ok(css.includes("system-ui"));
  assert.ok(css.includes("ui-monospace"));
});

test("font optimization remains global rather than duplicated in components", () => {
  const layout = read("src/app/layout.tsx");
  const css = read("src/app/globals.css");

  assert.equal((layout.match(/next\/font\/google/g) ?? []).length, 1);
  assert.ok(css.includes("font-family: var(--font-sans)"));
  assert.ok(css.includes("font-family: var(--font-mono)"));
});
