import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeContributionIssueModal } from "../src/components/employee-contribution-issue-modal";
import { EmployeeTakeHomeEstimator } from "../src/components/employee-take-home-estimator";
import { WebBundyModal } from "../src/components/web-bundy-modal";
import { essText, parseEssLanguage } from "../src/lib/ess-language";

const noop = () => {};

test("English remains the default, Taglish is opt-in and unsupported languages safely fall back to English", () => {
  assert.equal(parseEssLanguage(undefined), "en");
  assert.equal(parseEssLanguage("en"), "en");
  assert.equal(parseEssLanguage("fil"), "fil");
  assert.equal(parseEssLanguage("fr"), "en");
  assert.equal(essText("en", "What if my pay changes?"), "What if my pay changes?");
  assert.equal(essText("fil", "What if my pay changes?"), "Paano kung magbago ang sahod ko?");
  assert.equal(essText("fil", "SSS"), "SSS");
  assert.equal(essText("fil", "PhilHealth"), "PhilHealth");
  assert.equal(essText("fil", "Pag-IBIG"), "Pag-IBIG");
  assert.equal(essText("fil", "UNRECOGNIZED_AGENCY_EVIDENCE_CODE"), "UNRECOGNIZED_AGENCY_EVIDENCE_CODE");
  assert.equal(essText("fil", "₱12,345.67"), "₱12,345.67");
});

test("take-home estimator changes explanatory UI labels without modifying currency or contribution calculation", () => {
  const english = renderToStaticMarkup(createElement(EmployeeTakeHomeEstimator));
  const taglish = renderToStaticMarkup(createElement(EmployeeTakeHomeEstimator, { language: "fil" as const }));
  assert.match(english, /What if my pay changes\?/);
  assert.match(taglish, /Paano kung magbago ang sahod ko\?/);
  assert.match(taglish, /Nilo-load ang kasalukuyang pay baseline mo/);
  const source = readFileSync("src/components/employee-take-home-estimator.tsx", "utf8");
  assert.match(source, /estimateMonthlyTakeHome\(\{/);
  assert.match(source, /asOf: payload\.asOf/);
  assert.match(source, /payload\.note/);
  assert.match(source, /new Intl\.NumberFormat\("en-PH", \{ style: "currency", currency: "PHP" \}\)/);
});

test("contribution reporting translates form labels but keeps agency names and stable issue values", () => {
  const props = { memberId: null, onClose: noop, onSubmitted: noop };
  const english = renderToStaticMarkup(createElement(EmployeeContributionIssueModal, props));
  const taglish = renderToStaticMarkup(createElement(EmployeeContributionIssueModal, { ...props, language: "fil" as const }));
  assert.match(english, /Report a contribution problem/);
  assert.match(taglish, /Mag-report ng problema sa contribution/);
  assert.match(taglish, /Buwan na sakop/);
  assert.match(taglish, /Walang contribution sa agency record ko/);
  assert.match(taglish, /value="missing_posting"/);
  for (const agency of ["SSS", "PhilHealth", "Pag-IBIG"]) {
    assert.match(taglish, new RegExp('value="' + agency + '"'));
  }
  const source = readFileSync("src/components/employee-contribution-issue-modal.tsx", "utf8");
  assert.match(source, /issueType,/);
  assert.match(source, /applicableMonth,/);
  assert.match(source, /description,/);
});

test("Web Bundy remains English by default, keeps clock API actions and Philippine time unchanged", () => {
  const props = { organizationId: 18, employeeId: 5, employeeName: "Sample Employee", onClose: noop, onPunchSuccess: noop };
  const english = renderToStaticMarkup(createElement(WebBundyModal, props));
  const taglish = renderToStaticMarkup(createElement(WebBundyModal, { ...props, language: "fil" as const }));
  assert.match(english, /Sample Employee.*attendance/);
  assert.match(taglish, /Role-controlled ang browser time clock/);
  assert.match(taglish, /Time IN/);
  assert.match(taglish, /Simulan ang break/);
  const source = readFileSync("src/components/web-bundy-modal.tsx", "utf8");
  for (const action of ['"clock_in"', '"break_start"', '"break_end"', '"clock_out"']) {
    assert.ok(source.includes(action));
  }
  assert.match(source, /location: "Web Bundy \(Workstation \/ Mobile Browser\)"/);
  assert.match(source, /philippineClockTime\(new Date\(todayPunch\.timeIn\)\)/);
  assert.match(readFileSync("src/lib/philippine-clock-display.ts", "utf8"), /timeZone: "Asia\/Manila"/);
});

test("every expanded ESS screen receives the chosen language through props without API changes", () => {
  const source = readFileSync("src/components/self-service-portal.tsx", "utf8");
  assert.match(source, /useState<EssLanguage>\("en"\)/);
  assert.match(source, /<option value="en">English<\/option>/);
  assert.match(source, /<option value="fil">Taglish<\/option>/);
  assert.match(source, /<EmployeeTakeHomeEstimator language=\{language\} \/>/);
  assert.match(source, /<EmployeeContributionIssueModal\s+language=\{language\}/);
  assert.match(source, /<WebBundyModal\s+employeeId=\{data\.employee\.id\}\s+language=\{language\}/);
  assert.match(source, /<SectionHeading kicker=\{t\("MY TIME"\)\}/);
  assert.match(source, /<SectionHeading kicker=\{t\("MY LEAVE"\)\}/);
  assert.match(source, /<SectionHeading kicker=\{t\("MY PROFILE"\)\}/);
  assert.match(source, /\{row\.postingStatus\}/);
  assert.match(source, /\{row\.postingReference\}/);
  assert.match(source, /\{issue\.description\}/);
  assert.match(source, /\{request\.status\}/);
  assert.match(source, /\{peso\(row\.employeeShare\)\}/);
});
