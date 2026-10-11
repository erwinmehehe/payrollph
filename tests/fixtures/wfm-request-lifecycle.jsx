import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { WorkforceScheduleGuardrailsPanel } from "../../src/components/workspace/workforce-schedule-guardrails-panel";
import { WorkforceOvertimePanel } from "../../src/components/workspace/workforce-overtime-panel";
import { WorkforceScheduleSwapPanel } from "../../src/components/workspace/workforce-schedule-swap-panel";

const components = { guardrails: WorkforceScheduleGuardrailsPanel, overtime: WorkforceOvertimePanel, swaps: WorkforceScheduleSwapPanel };
window.pending = [];
window.notices = [];
window.saved = 0;
const notify = (message) => window.notices.push(message);
const onSaved = () => { window.saved++; };
// Resolve even aborted reads to test component ownership rather than transport behavior.
window.fetch = (url, options = {}) => new Promise(resolve => {
  window.pending.push({ url: String(url), options, resolve, done: false });
});
window.complete = (index, body, status = 200) => {
  const request = window.pending[index];
  request.done = true;
  request.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
};
const root = createRoot(document.getElementById("root"));
window.renderView = (name, organizationId, canManage = true) => {
  const Component = components[name];
  const data = {
    selectedOrganization: { id: organizationId },
    access: { role: canManage ? "owner" : "hr", companyWide: canManage, orgUnitName: null },
    employees: [1, 2].map(i => ({ id: organizationId * 10 + i, employeeNo: `SYNTHETIC-${organizationId}-${i}`, firstName: "Synthetic", lastName: `Worker ${i}` })),
    orgUnits: [{ id: organizationId * 100, name: "Synthetic department" }],
  };
  flushSync(() => root.render(<StrictMode><Component data={data} canManage={canManage} notify={notify} onSaved={onSaved}/></StrictMode>));
};
