import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebBundyModal } from "../src/components/web-bundy-modal";

test("session-scoped ESS payload enables only the linked employee's Web Bundy controls", () => {
  const selfRoute = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
  const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");
  assert.match(selfRoute, /eq\(employees\.id, session\.employeeId\)/);
  assert.match(selfRoute, /employee:\s*\{\s*(?:\/\/[^\n]*\n\s*)*id: employee\.id,/);
  assert.match(portal, /employee:\s*\{\s*id: number;/);
  assert.match(portal, /<WebBundyModal\s+employeeId=\{data\.employee\.id\}/);
  assert.match(portal, /organizationId=\{data\.employer\?\.id \?\? 0\}/);
  assert.doesNotMatch(portal, /searchParams\.get\(["']employeeId/);
});

test("Web Bundy renders a linked employee's clock controls but waits for authoritative day history", () => {
  const props = {
    organizationId: 15,
    employeeName: "Test Employee",
    onClose: () => {},
    onPunchSuccess: () => {},
  };
  const unlinked = renderToStaticMarkup(createElement(WebBundyModal, props));
  const linked = renderToStaticMarkup(createElement(WebBundyModal, { ...props, employeeId: 11 }));
  assert.match(unlinked, /<button[^>]+disabled=""/);
  // Server render cannot prove there is no existing punch. Never enable a
  // new clock-in until the current employer/employee GET returns successfully.
  assert.match(linked, /Clock IN/);
  assert.match(linked, /<button[^>]+class="primary-button"[^>]*disabled=""/);
  const missingEmployer = renderToStaticMarkup(createElement(WebBundyModal, {
    ...props, organizationId: 0, employeeId: 11,
  }));
  assert.match(missingEmployer, /Employer identity is not linked/);
  assert.match(missingEmployer, /<button[^>]+class="primary-button"[^>]*disabled=""/);
});

test("the server continues to replace any employee-provided ID with the authenticated session identity", () => {
  const route = readFileSync("src/app/api/web-bundy/route.ts", "utf8");
  assert.equal((route.match(/employeeId = user\.employeeId;/g) ?? []).length, 2, "GET and POST must force the session employee ID");
  assert.match(route, /assertMembership\(user\.id, organizationId\)/);
  assert.match(route, /eq\(timePunches\.organizationId, organizationId\)/);
  assert.match(route, /eq\(timePunches\.employeeId, employeeId\)/);
  assert.match(route, /eq\(employees\.id, employeeId\), eq\(employees\.organizationId, organizationId\)/);
  assert.match(route, /enforceSameOriginMutation\(request\)/);
});
