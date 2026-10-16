import assert from "node:assert/strict";
import test from "node:test";
import { cookieOriginFindings } from "../scripts/audit-cookie-session-mutations";

const path = "src/app/api/test/route.ts";

test("S-7 exported arrow handlers are audited alongside declared functions", () => {
  const missing = [
    "export const POST = async (request: Request) => {",
    "  const user = await getSessionUser();",
    "  await changeData(user);",
    "};",
  ].join("\n");
  const result = cookieOriginFindings(path, missing);
  assert.equal(result.length, 1);
  assert.equal(result[0].handler, "POST");
  assert.match(result[0].problem, /no same-origin guard/);
  const declared = missing.replace("export const POST = async (request: Request) => {",
    "export async function POST(request: Request) {");
  assert.equal(cookieOriginFindings(path, declared).length, 1);
});

test("S-7 rejects ignored and late guards on exported const handlers", () => {
  const late = [
    "export const PATCH = async (request: Request) => {",
    "  const user = await getSessionUser();",
    "  const denied = enforceSameOriginMutation(request);",
    "  if (denied) return denied;",
    "};",
  ].join("\n");
  assert.equal(cookieOriginFindings(path, late)[0].problem, "Session may be read before same-origin guard");
  const ignored = [
    "export const DELETE = async (request: Request) => {",
    "  enforceSameOriginMutation(request);",
    "  const user = await getSessionUser();",
    "};",
  ].join("\n");
  assert.equal(cookieOriginFindings(path, ignored)[0].problem, "Same-origin guard return path is not visible");
});

test("S-7 accepts guarded arrow and excludes token-only external request", () => {
  const safe = [
    "export const POST = async (request: Request) => {",
    "  const originDenied = enforceSameOriginMutation(request);",
    "  if (originDenied) return originDenied;",
    "  const user = await getSessionUser();",
    "  await changeData(user);",
    "};",
  ].join("\n");
  assert.deepEqual(cookieOriginFindings(path, safe), []);
  const external = [
    "export const POST = async (request: Request) => {",
    '  if (!verifyWebhookSignature(request)) return new Response("denied");',
    "  await handleSignedWebhook();",
    "};",
  ].join("\n");
  assert.deepEqual(cookieOriginFindings(path, external), []);
});

test("S-7 finds mixed exported mutations without scanning local helpers", () => {
  const source = [
    "const PATCH = async () => { await getSessionUser(); };",
    "export const GET = async () => { await getSessionUser(); },",
    "  DELETE = async () => { await getSessionUser(); };",
  ].join("\n");
  assert.deepEqual(cookieOriginFindings(path, source).map((f) => f.handler), ["DELETE"]);
});
