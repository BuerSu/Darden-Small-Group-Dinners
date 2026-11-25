import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "../server/app.js";
import { SqliteRepository } from "../server/repositories/sqlite.js";
import { DEMO_HOST_IDS, personId, dinnerId } from "../server/demo-data.js";
const dir = await mkdtemp(join(tmpdir(), "darden-browser-"));
const repository = new SqliteRepository(join(dir, "browser.sqlite"));
const app = createApp({
  repository,
  config: { authMode: "demo", demoHostIds: DEMO_HOST_IDS },
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let checks = 0;
const check = (v, message) => {
  assert.ok(v, message);
  checks++;
  console.log("PASS " + message);
};
async function chooseEvent(id) {
  await page.locator("#eventSelect").selectOption(id);
  await page.waitForFunction(
    (id) =>
      document.getElementById("eventSelect").value === id &&
      !document.getElementById("refreshButton").disabled,
    id,
  );
}
try {
  await page.goto(base);
  await page.locator("#eventTheme").waitFor();
  check(
    (await page.locator("#eventTheme").textContent()) ===
      "Career switches over supper",
    "PR dashboard loads from persistent backend",
  );
  check(
    (await page.locator("#studentCount").textContent()) === "3",
    "three student sign-ups rendered",
  );
  check(
    (await page.locator("#familyCount").textContent()) === "2",
    "family seats are separate",
  );
  check(
    (await page.locator("#rosterList").textContent()).includes(
      "child has a nut allergy",
    ),
    "family dietary details rendered",
  );
  check(
    (await page.locator("#rosterList .roster-person").count()) === 3,
    "roster has one row per student booking",
  );
  await chooseEvent(dinnerId(3));
  check(
    (await page.locator("#statusBadge").textContent()) === "No sign-ups",
    "empty state shows zero sign-ups",
  );
  await page.locator("#familySeats").selectOption("2");
  await page.locator("#addButton").click();
  await page.waitForFunction(
    () =>
      document.getElementById("studentCount").textContent === "1" &&
      !document.getElementById("refreshButton").disabled,
  );
  check(
    (await page.locator("#familyCount").textContent()) === "2",
    "demo sign-up persists a student and two family seats",
  );
  await page.reload();
  await page.locator("#eventTheme").waitFor();
  await chooseEvent(dinnerId(3));
  check(
    (await page.locator("#studentCount").textContent()) === "1",
    "registration survives browser reload",
  );
  await page.locator("#resetButton").click();
  await page.waitForFunction(
    () =>
      document.getElementById("studentCount").textContent === "0" &&
      !document.getElementById("refreshButton").disabled,
  );
  check(
    await page.locator("#rosterEmpty").isVisible(),
    "cancellation updates empty roster",
  );
  await chooseEvent(dinnerId(8));
  check(
    (await page.locator("#statusBadge").textContent()) === "Fully booked",
    "full event state rendered",
  );
  check(
    (await page.locator("#statusBanner").textContent()).includes(
      "only 1 student",
    ),
    "full family party does not falsely meet minimum",
  );
  await page.locator("#hostSelect").selectOption(personId(14));
  await page.waitForFunction(
    () =>
      document.getElementById("eventTheme").textContent ===
        "Food and culture exchange" &&
      !document.getElementById("refreshButton").disabled,
  );
  check(
    (await page.locator("#seatsLeft").textContent()) === "0",
    "switching hosts loads their full dinner",
  );
  const unauthorized = await page.evaluate(
    async ({ base, id, host }) =>
      (
        await fetch(`${base}/api/host/dinners/${id}/status`, {
          headers: { "X-Demo-Host-Id": host },
        })
      ).status,
    { base, id: dinnerId(1), host: personId(14) },
  );
  check(unauthorized === 404, "cross-host roster access is denied");
  await page.locator("#hostSelect").selectOption(personId(1));
  await page.waitForFunction(
    () =>
      document.getElementById("eventTheme").textContent ===
        "Career switches over supper" &&
      !document.getElementById("refreshButton").disabled,
  );
  // Stored untrusted text remains text in the browser, never HTML.
  repository.db
    .prepare("UPDATE profiles SET full_name=? WHERE id=?")
    .run('<img src=x onerror="window.injected=true">', personId(3));
  await page.locator("#refreshButton").click();
  await page.waitForFunction(() =>
    document.getElementById("rosterList").textContent.includes("<img"),
  );
  check(
    (await page.locator("#rosterList img").count()) === 0,
    "stored participant text cannot inject HTML",
  );
  check(
    (await page.evaluate(() => window.injected)) === undefined,
    "stored script cannot execute",
  );
  // Restore screenshot text.
  repository.db
    .prepare("UPDATE profiles SET full_name=? WHERE id=?")
    .run("Priya Shah", personId(3));
  await page.locator("#refreshButton").click();
  await page.waitForFunction(
    () => !document.getElementById("refreshButton").disabled,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/host-dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/host-dashboard-mobile.png",
    fullPage: true,
  });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile layout has no horizontal overflow",
  );
  check(errors.length === 0, "no browser JavaScript errors");
  console.log(`${checks} browser checks passed.`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await repository.close();
  await rm(dir, { recursive: true, force: true });
}
