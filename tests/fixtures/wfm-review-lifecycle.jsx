import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { WorkforceScheduleReceiptReview } from "../../src/components/workspace/workforce-schedule-receipt-review";
import { WorkforceRosterBatchReviews } from "../../src/components/workspace/workforce-roster-batch-reviews";

const components = { receipt: WorkforceScheduleReceiptReview, batches: WorkforceRosterBatchReviews };
window.pending = [];
// Ignore abort at the transport layer: ownership must still reject late results.
window.fetch = (url, options = {}) => new Promise(resolve => {
  window.pending.push({ url: String(url), options, resolve, done: false });
});
window.complete = (index, body, status = 200) => {
  const request = window.pending[index];
  request.done = true;
  request.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
};
const root = createRoot(document.getElementById("root"));
window.renderView = (name, props = {}) => {
  const Component = components[name];
  flushSync(() => root.render(<StrictMode><Component {...props} onClose={() => root.render(null)}/></StrictMode>));
};
window.unmountView = () => flushSync(() => root.render(null));
