import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("optional ESS photo probe is no-content rather than a browser 404", () => {
  const route = readFileSync("src/app/api/self/photo/route.ts", "utf8");
  const app = readFileSync("src/components/self-service-portal.tsx", "utf8");

  // Missing HEAD is normal and must not produce a resource-load warning.
  assert.ok(route.includes("status: head ? 204 : 404"));
  // The GET contract must still report that the image does not exist.
  assert.ok(route.includes("export async function GET()"));
  assert.ok(route.includes("return readPhoto();"));
  // HTTP 204 is successful to fetch(), but never represents an available image.
  assert.ok(app.includes("setPhotoAvailable(res.status === 200)"));
  assert.ok(!app.includes("setPhotoAvailable(res.ok)"));
});
