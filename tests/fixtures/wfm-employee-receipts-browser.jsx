import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EmployeeWorkforcePanel } from "../../src/components/employee-workforce-panel";

// Isolated, browser-executed component fixture. Synthetic only; it does not
// bypass the protected API or assert an employer or device was validated.
const root = createRoot(document.getElementById("root"));
const days = Array.from({ length: 7 }, (_, offset) => {
  const stamp = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(stamp);
  const date = new Date(today + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
});
const digest = () => (window.revision === 1 ? "a" : "b").repeat(64);
window.revision = 1;
window.received = false;
window.forceConflict = false;
window.posts = [];
window.gets = [];
const snapshot = () => ({
  version: 1, date: days[0], source: "pattern", isRestDay: false,
  assignmentId: 1, patternId: 2, overrideId: null, workLocationOrgUnitId: null,
  worksite: { id: 1, name: "Fictional approved site" },
  segments: [{ shiftDefinitionId: 3, shiftCode: "DAY", shiftName: "Day shift",
    segmentOrder: 1, startTime: "09:00", endTime: "17:00",
    breakMinutes: 60, spansMidnight: false }],
});
const receiptView = () => ({
  boundary: "Seeing the schedule does not confirm attendance or consent to pay changes.",
  days: days.map((date, i) => i === 0
    ? { date, snapshot: snapshot(), snapshotHash: digest(),
        state: window.received ? "acknowledged" : window.revision === 1 ? "pending" : "changed",
        acknowledgedAt: window.received ? "2026-10-11T00:00:00.000Z" : null }
    : { date, snapshot: null, snapshotHash: null, state: "unavailable", acknowledgedAt: null }),
});
window.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target === "/api/self/workforce" && (options.method ?? "GET") === "GET") {
    return Response.json({ range: { startDate: days[0], endDate: days[6] },
      schedule: [], punches: [], corrections: [] });
  }
  if (target === "/api/self/schedule-receipts" && (options.method ?? "GET") === "GET") {
    window.gets.push(target);
    return Response.json(receiptView());
  }
  if (target === "/api/self/schedule-receipts" && options.method === "POST") {
    const payload = JSON.parse(options.body);
    window.posts.push(payload);
    if (window.forceConflict) {
      window.forceConflict = false;
      window.revision = 2;
      window.received = false;
      return Response.json({ error: "Source changed" }, { status: 409 });
    }
    window.received = true;
    return Response.json({ created: true, workDate: days[0], snapshotHash: digest(),
      acknowledgedAt: "2026-10-11T00:00:00.000Z" }, { status: 201 });
  }
  throw new Error("Unmocked synthetic API: " + target);
};
window.resetChanged = () => { window.revision = 2; window.received = false; };
root.render(<StrictMode><EmployeeWorkforcePanel /></StrictMode>);
