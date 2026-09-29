import fs from "node:fs/promises";

const base = process.env.PREVIEW_BASE_URL ?? "http://127.0.0.1:3000";
const token = process.env.LINAW_SESSION;
if (!token) throw new Error("LINAW_SESSION is required");

const targets = await fetch("http://127.0.0.1:9222/json");
const pages = await targets.json();
const page = pages.find((item) => item.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("No Chrome page target found");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const listeners = new Map();

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method && listeners.has(msg.method)) {
    for (const fn of listeners.get(msg.method)) fn(msg.params);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function once(method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const set = listeners.get(method) ?? new Set();
    const timer = setTimeout(() => {
      set.delete(handler);
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    const handler = (params) => {
      clearTimeout(timer);
      set.delete(handler);
      resolve(params);
    };
    set.add(handler);
    listeners.set(method, set);
  });
}

async function waitFor(expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result?.result?.value) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

const cookie = await send("Network.setCookie", {
  name: "linaw_session",
  value: token,
  url: base,
  httpOnly: true,
  sameSite: "Lax",
});
if (!cookie?.success) throw new Error("Could not set Linaw session cookie");

const loaded = once("Page.loadEventFired");
await send("Page.navigate", { url: `${base}/?demoRole=owner` });
await loaded;
await waitFor("document.readyState === 'complete'");

await waitFor(`Array.from(document.querySelectorAll("button")).some((el) => el.textContent?.includes("Migration"))`);
const click = await send("Runtime.evaluate", {
  expression: `(() => {
    const button = Array.from(document.querySelectorAll("button")).find((el) => el.textContent?.includes("Migration"));
    if (!button) return false;
    button.click();
    return true;
  })()`,
  returnByValue: true,
});
if (!click?.result?.value) throw new Error("Migration navigation button not found");

await waitFor(`document.body.innerText.includes("Switch payroll without rebuilding everything.")`);
await new Promise((resolve) => setTimeout(resolve, 750));

const metrics = await send("Page.getLayoutMetrics");
const size = metrics?.cssContentSize ?? { width: 1440, height: 1600 };
const screenshot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: {
    x: 0,
    y: 0,
    width: Math.min(1800, Math.ceil(size.width)),
    height: Math.min(4000, Math.ceil(size.height)),
    scale: 1,
  },
});

await fs.writeFile("migration-center-preview.png", Buffer.from(screenshot.data, "base64"));
ws.close();
console.log("migration-center-preview.png");
