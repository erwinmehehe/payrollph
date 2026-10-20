import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import HcmWorkQueue from "../../src/app/hcm/work-items/page";
import { HcmMyTeamClient } from "../../src/components/hcm-my-team";
import { HcmOrgExplorerClient } from "../../src/components/hcm-org-explorer";
import { HcmTeamLeaveCalendar } from "../../src/components/hcm-team-leave-calendar";
import { Worker360Client } from "../../src/components/hcm-worker-360";
import { HcmPeopleOperationsInbox } from "../../src/components/hcm-people-operations-inbox";
import { HcmEmploymentLifecycleActionCenter } from "../../src/components/hcm-employment-lifecycle-action-center";

const components = {
  queue: HcmWorkQueue, team: HcmMyTeamClient, org: HcmOrgExplorerClient,
  calendar: HcmTeamLeaveCalendar, worker: Worker360Client,
  inbox: HcmPeopleOperationsInbox, lifecycle: HcmEmploymentLifecycleActionCenter,
};
window.pending = [];
// Deliberately ignore abort at the transport layer to exercise the components'
// ownership guards rather than relying on the browser to suppress callbacks.
window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
  window.pending.push({ url: String(url), options, resolve, reject, done: false });
});
window.complete = (index, body, status = 200) => {
  const request = window.pending[index];
  request.done = true;
  request.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
};
window.rejectRequest = (index) => {
  const request = window.pending[index];
  request.done = true;
  request.reject(new Error("Synthetic transport rejection"));
};
window.completeMalformed = (index) => {
  const request = window.pending[index];
  request.done = true;
  request.resolve(new Response("{synthetic malformed json", { status: 200 }));
};
const root = createRoot(document.getElementById("root"));
window.renderView = (name, props = {}) => {
  const Component = components[name];
  flushSync(() => root.render(<StrictMode><Component {...props} onOpenWorker={() => true} onPage={() => {}}
    onOpenEmployee={() => {}} onOpenSeparation={() => {}}/></StrictMode>));
};
