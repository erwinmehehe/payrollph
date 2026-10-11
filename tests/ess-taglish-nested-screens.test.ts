import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeWorkforcePanel } from "../src/components/employee-workforce-panel";
import { EmployeeDocumentsPanel } from "../src/components/employee-documents-panel";
import { EmployeeProfileExtras } from "../src/components/employee-profile-extras";
import { essText, parseEssLanguage } from "../src/lib/ess-language";

const read = (path: string) => readFileSync(path, "utf8");

test("English is still the default; Taglish remains opt-in with safe fallback", () => {
  assert.equal(parseEssLanguage(null), "en");
  assert.equal(parseEssLanguage("en"), "en");
  assert.equal(parseEssLanguage("fil"), "fil");
  assert.equal(parseEssLanguage("ar"), "en");
  assert.equal(essText("en", "Request a correction"), "Request a correction");
  assert.equal(essText("fil", "Request a correction"), "Mag-request ng pagwawasto");
  assert.equal(essText("fil", "SSS"), "SSS");
  assert.equal(essText("fil", "Pag-IBIG"), "Pag-IBIG");
  assert.equal(essText("fil", "₱12,345.67"), "₱12,345.67");
  assert.equal(essText("fil", "APPROVED_BACKEND_STATUS"), "APPROVED_BACKEND_STATUS");
});

test("workforce schedule and correction UI translate labels but preserve Philippine time and source evidence", () => {
  const english = renderToStaticMarkup(createElement(EmployeeWorkforcePanel));
  const taglish = renderToStaticMarkup(createElement(EmployeeWorkforcePanel, { language: "fil" as const }));
  assert.match(english, /Effective workforce schedule/);
  assert.match(english, /Manager approval required/);
  assert.match(taglish, /Kasalukuyang workforce schedule/);
  assert.match(taglish, /Kailangan ang approval ng manager/);
  assert.match(taglish, /PAGWAWASTO NG ATTENDANCE/);
  const source = read("src/components/employee-workforce-panel.tsx");
  assert.match(source, /timeZone: "Asia\/Manila"/);
  assert.match(source, /toManilaInput\(punch\.timeIn\)/);
  assert.match(source, /action: "request_correction"/);
  assert.match(source, /reason: reason\.trim\(\)/);
  assert.match(source, /\{row\.reason\}/);
  assert.match(source, /\{row\.decisionNote\}/);
  assert.match(source, /\{day\.label\}/);
});

test("document labels are optional Taglish; the assigned signed policy and acknowledgement statement stay verbatim", () => {
  const english = renderToStaticMarkup(createElement(EmployeeDocumentsPanel, { organizationId: 12 }));
  const taglish = renderToStaticMarkup(createElement(EmployeeDocumentsPanel, { organizationId: 12, language: "fil" as const }));
  assert.match(english, /Loading your documents and policies/);
  assert.match(taglish, /Nilo-load ang mga dokumento at policy mo/);
  assert.equal(essText("fil", "Policies & required documents"), "Mga policy at kinakailangang dokumento");
  assert.equal(essText("en", "Policies & required documents"), "Policies & required documents");
  const source = read("src/components/employee-documents-panel.tsx");
  assert.match(source, /\{policy\.content\}/);
  assert.match(source, /I acknowledge that I have received and read this exact policy version\./);
  assert.match(source, /action: "acknowledge-policy"/);
  assert.match(source, /assignmentId: assignment\.assignmentId/);
  assert.match(source, /Content evidence/);
  assert.match(source, /\{policy\.contentSha256\.slice\(0, 16\)\}/);
  assert.match(source, /\{row\.name\}/);
  assert.match(source, /\{row\.status\}/);
  assert.match(source, /form\.set\("requirementId", String\(selectedRequirement\.requirementId\)\)/);
});

test("profile photo, ID and password labels are localized without altering masked identifiers or official input values", () => {
  const base = {
    employee: { firstName: "Maria", lastName: "Santos", employeeNo: "E007", region: "NCR" },
    photoAvailable: false,
    photoVersion: 0,
    onPhotoChanged: () => {},
  };
  const english = renderToStaticMarkup(createElement(EmployeeProfileExtras, base));
  const taglish = renderToStaticMarkup(createElement(EmployeeProfileExtras, { ...base, language: "fil" as const }));
  assert.match(english, /Profile picture/);
  assert.match(english, /Change password/);
  assert.match(taglish, /Larawan sa profile/);
  assert.match(taglish, /Palitan ang password/);
  assert.match(taglish, /Mga government ID number at credential/);
  const source = read("src/components/employee-profile-extras.tsx");
  assert.match(source, /value\?\.masked/);
  assert.match(source, /normalizeEssIdentifier\(idKind, idValue\)/);
  assert.match(source, /kind: idKind, value: normalized\.value/);
  assert.match(source, /currentPassword, newPassword: nextPassword, confirmPassword/);
  assert.match(source, /Do not enter a PhilSys Number \(PSN\)/);
});

test("the existing English-first language choice flows through nested screens; payroll computations and evidence are unchanged", () => {
  const source = read("src/components/self-service-portal.tsx");
  assert.match(source, /useState<EssLanguage>\("en"\)/);
  assert.match(source, /<EmployeeWorkforcePanel language=\{language\} \/>/);
  assert.match(source, /<EmployeeDocumentsPanel organizationId=\{data\.employer\.id\} language=\{language\} \/>/);
  assert.match(source, /<EmployeeProfileExtras\s+language=\{language\}/);
  assert.match(source, /ESS_LANGUAGE_STORAGE_KEY/);
  const dictionary = read("src/lib/ess-language.ts");
  assert.match(dictionary, /if \(language !== "fil"\) return english;/);
  const names = Array.from(dictionary.matchAll(/^\s*"([^"]+)":/gm), (match) => match[1]);
  assert.equal(new Set(names).size, names.length, "dictionary must not contain ambiguous duplicate keys");
  assert.match(source, /\{peso\(row\.employeeShare\)\}/);
  assert.match(source, /\{row\.postingReference\}/);
  assert.match(source, /\{issue\.description\}/);
});
