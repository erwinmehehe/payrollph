/**
 * Browser regression for the public /help role cards on DISPOSABLE LOCAL CI.
 * No login, payroll, tenant, network destinations other than localhost, or
 * real employee records are used. The existing marketing browser workflow
 * provisions a local Next.js dev server and Playwright Chromium.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function check(truth, message) {
  if (!truth) throw new Error(message);
}
function localBase() {
  const value = new URL(process.env.QA_URL || "http://127.0.0.1:3000");
  if (value.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(value.hostname) ||
      (value.pathname !== "/" && value.pathname !== "")) {
    throw new Error("Help browser QA can run only against a localhost HTTP development server.");
  }
  return value.origin;
}
async function opened(page, slug) {
  await page.waitForFunction(
    (id) => document.getElementById(id)?.querySelector("details")?.open === true,
    slug, { timeout: 15000 },
  );
}
async function focused(page, slug) {
  await page.waitForFunction(
    (id) => document.activeElement === document.getElementById(id)?.querySelector("summary"),
    slug, { timeout: 15000 },
  );
}
async function exercise(browser, base, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const response = await page.goto(base + "/help", { waitUntil: "networkidle", timeout: 90000 });
    check(Boolean(response?.ok()), name + ": /help did not load.");
    check(await page.getByRole("heading", { name: "Your first steps in Linaw" }).isVisible(),
      name + ": missing role onboarding heading.");

    const cards = page.locator('section[aria-labelledby="role-onboarding-heading"] article');
    check(await cards.count() === 4, name + ": expected four role cards.");
    for (const role of ["Employees", "Managers", "HR teams", "Payroll teams"]) {
      const card = cards.filter({ has: page.getByRole("heading", { name: role, exact: true }) });
      check(await card.count() === 1, name + ": missing " + role + " role card.");
      check(await card.locator('a[href^="/help#"]').count() >= 3,
        name + ": incomplete guide links for " + role);
    }

    // Establish that the help search has hydrated and is interactive.
    const search = page.getByRole("searchbox", { name: "Search help topics" });
    await search.fill("no-such-onboarding-topic-98765");
    await page.getByRole("heading", { name: "No matching guides" }).waitFor({ timeout: 15000 });
    await search.fill("");

    const employee = cards.filter({ has: page.getByRole("heading", { name: "Employees", exact: true }) });
    const repeatLink = employee.locator('a[href^="/help#"]').first();
    const href = await repeatLink.getAttribute("href");
    check(Boolean(href?.startsWith("/help#")), name + ": guide link missing public hash.");
    const repeatSlug = href.slice("/help#".length);
    await repeatLink.click();
    await opened(page, repeatSlug);
    await focused(page, repeatSlug);

    // Closing the accordion does not alter the fragment. Clicking the same
    // role-card link must re-open it, even though hashchange will not fire.
    await page.locator("#" + repeatSlug + " details summary").click();
    check(!(await page.locator("#" + repeatSlug + " details").evaluate((details) => details.open)),
      name + ": manual close failed.");
    check(new URL(page.url()).hash === "#" + repeatSlug,
      name + ": guide URL unexpectedly changed when collapsed.");
    await repeatLink.click();
    await opened(page, repeatSlug);
    await focused(page, repeatSlug);

    // Filters may hide the target from the article list. A role guide link
    // should reset the search, role filter and focus the newly opened guide.
    await search.fill("no-such-guide-123");
    await page.getByRole("button", { name: "Employees", exact: true }).click();
    const manager = cards.filter({ has: page.getByRole("heading", { name: "Managers", exact: true }) });
    await manager.locator('a[href="/help#manager-handoff"]').click();
    await opened(page, "manager-handoff");
    await focused(page, "manager-handoff");
    check(await search.inputValue() === "", name + ": role-guide navigation failed to clear search.");
    check(await page.getByRole("button", { name: "All roles" }).getAttribute("aria-pressed") === "true",
      name + ": role-guide navigation failed to clear role filter.");

    // Validate a bookmarked deep link after a fresh page load.
    const direct = await page.goto(base + "/help#payroll-checker-evidence", {
      waitUntil: "networkidle", timeout: 90000,
    });
    check(Boolean(direct?.ok()), name + ": deep link did not load.");
    await opened(page, "payroll-checker-evidence");
    await focused(page, "payroll-checker-evidence");

    // Enter-key activation must navigate the public role-card link.
    const firstCard = page.locator('section[aria-labelledby="role-onboarding-heading"] article').first();
    const keyboardLink = firstCard.locator('a[href^="/help#"]').first();
    await keyboardLink.focus();
    check(await keyboardLink.evaluate((element) => element === document.activeElement),
      name + ": role link did not accept focus.");
    await page.keyboard.press("Enter");
    await opened(page, repeatSlug);
    await focused(page, repeatSlug);

    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    check(dimensions.content <= dimensions.viewport + 1,
      name + ": horizontal content overflow: " + JSON.stringify(dimensions));

    const out = path.resolve("qa-artifacts");
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, "help-onboarding-" + name + ".png"), fullPage: true });
    check(errors.length === 0, name + ": page errors: " + errors.join(" | "));
    process.stdout.write("PASS: " + name +
      " role cards, repeated hash, deep link, filter reset, focus, keyboard and overflow.\n");
  } finally {
    await context.close();
  }
}
(async () => {
  const base = localBase();
  const browser = await chromium.launch({ headless: true });
  try {
    await exercise(browser, base, "desktop", { width: 1440, height: 900 });
    await exercise(browser, base, "mobile-390", { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
