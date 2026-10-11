import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PayoutProfilesPanel } from "../../src/components/payout-profiles-panel";

window.pending = [];
window.notices = [];
// Synthetic transport intentionally resolves after abort to test ownership.
window.fetch = (url, options = {}) => new Promise(resolve => {
  window.pending.push({url:String(url),options,resolve,done:false});
});
window.complete = (index, body, status = 200) => {
  const request = window.pending[index]; request.done = true;
  request.resolve(new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
};
const root = createRoot(document.getElementById("root"));
const setNotice = message => window.notices.push(message);
window.renderView = props => flushSync(() => root.render(<StrictMode><PayoutProfilesPanel {...props} setNotice={setNotice}/></StrictMode>));
window.unmountView = () => flushSync(() => root.render(null));
