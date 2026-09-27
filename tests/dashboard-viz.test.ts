import assert from "node:assert/strict";
import test from "node:test";
import { buildDonutSegments, buildSparklinePoints } from "../src/lib/dashboard-viz";

test("sparkline points normalize real payroll values into the requested SVG box", () => {
  assert.equal(buildSparklinePoints([100, 200, 150], 200, 60), "0,60 100,0 200,30");
  assert.equal(buildSparklinePoints([500], 200, 60), "100,30");
});

test("donut segments derive percentages from actual amounts", () => {
  const segments = buildDonutSegments([
    { key: "net", value: 75 },
    { key: "deductions", value: 25 },
  ]);
  assert.deepEqual(segments, [
    { key: "net", value: 75, percent: 75, offset: 0 },
    { key: "deductions", value: 25, percent: 25, offset: 75 },
  ]);
});

test("donut gracefully handles an empty total", () => {
  assert.deepEqual(buildDonutSegments([{ key: "net", value: 0 }]), [
    { key: "net", value: 0, percent: 0, offset: 0 },
  ]);
});
