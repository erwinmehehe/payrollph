import assert from "node:assert/strict";
import test from "node:test";
import { currentStatusLabel, summarizeUptime, type Snapshot } from "../src/lib/status";

const NOW = Date.parse("2026-03-16T12:00:00Z");
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const snap = (ok: boolean, latencyMs: number, minsAgo: number): Snapshot => ({ ok, latencyMs, createdAt: at(minsAgo) });

test("no samples yields a neutral label rather than a fake 100%", () => {
  const summary = summarizeUptime([], NOW);
  assert.equal(summary.samples, 0);
  assert.equal(summary.uptimePercent, null);
  assert.equal(summary.uptimeLabel, "No samples yet");
});

test("uptime percentage rounds to one decimal", () => {
  // 9 ok of 10 = 90.0%
  const rows = [...Array(9)].map((_, i) => snap(true, 10, i));
  rows.push(snap(false, 40, 9));
  const summary = summarizeUptime(rows, NOW);
  assert.equal(summary.samples, 10);
  assert.equal(summary.ok, 9);
  assert.equal(summary.failed, 1);
  assert.equal(summary.uptimePercent, 90);
  assert.equal(summary.uptimeLabel, "90%");
});

test("snapshots outside the 24h window are excluded", () => {
  const rows = [snap(true, 5, 0), snap(true, 5, 30), snap(false, 5, 3 * 24 * 60)];
  const summary = summarizeUptime(rows, NOW);
  assert.equal(summary.samples, 2, "the 3-day-old sample must not count");
  assert.equal(summary.ok, 2);
});

test("median latency is computed and slowest is exposed", () => {
  // latencies 10, 20, 30 -> median 20, slowest 30
  const rows = [snap(true, 30, 0), snap(true, 10, 1), snap(true, 20, 2)];
  const summary = summarizeUptime(rows, NOW);
  assert.equal(summary.medianLatencyMs, 20);
  assert.equal(summary.slowestMs, 30);
});

test("even sample counts average the middle pair", () => {
  const rows = [snap(true, 10, 0), snap(true, 20, 1), snap(true, 30, 2), snap(true, 40, 3)];
  assert.equal(summarizeUptime(rows, NOW).medianLatencyMs, 25);
});

test("current status is read from the newest snapshot only", () => {
  assert.equal(currentStatusLabel(null).label, "Unknown");
  assert.equal(currentStatusLabel(snap(true, 5, 0)).label, "Operational");
  assert.equal(currentStatusLabel(snap(false, 5, 0)).label, "Degraded");
});
