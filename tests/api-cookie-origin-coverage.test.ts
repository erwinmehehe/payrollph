import assert from "node:assert/strict";
import test from "node:test";
import { auditCookieSessionMutationRoutes, cookieOriginFindings } from "../scripts/audit-cookie-session-mutations";

test("the complete API surface is inventoried; cookie-mutating handlers enforce same origin", () => {
  const result = auditCookieSessionMutationRoutes();
  assert.ok(result.inspectedRoutes >= 200, "API route count unexpectedly shrank; review the scan root");
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings, null, 2));
});

test("cookie mutation without origin guard is rejected and external token endpoint is a separate lane", () => {
  const missing = `export async function POST(request: Request) {
    const user = await getSessionUser();
    if (!user) return Response.json({error: "unauthorized"});
    await changeData();
  }`;
  assert.equal(cookieOriginFindings("src/app/api/sample/route.ts", missing).length, 1);
  const external = `export async function POST(request: Request) {
    if (!verifyWebhookSignature(request)) return Response.json({error: "unauthorized"});
    await handleSignedWebhook();
  }`;
  assert.equal(cookieOriginFindings("src/app/api/webhooks/example/route.ts", external).length, 0);
});

test("an origin check after the session read or ignored denial is rejected", () => {
  const after = `export async function PATCH(request: Request) {
    const user = await getSessionUser();
    const originDenied = enforceSameOriginMutation(request);
    if (originDenied) return originDenied;
  }`;
  assert.equal(cookieOriginFindings("src/app/api/example/route.ts", after).length, 1);
  const ignored = `export async function DELETE(request: Request) {
    enforceSameOriginMutation(request);
    const user = await getSessionUser();
  }`;
  assert.equal(cookieOriginFindings("src/app/api/example/route.ts", ignored).length, 1);
});
