// A real HTTP API + SQLite DB with the actual frontend JS in a DOM harness.
// This verifies wiring without requiring a browser; it does not verify layout.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { JSDOM, VirtualConsole } from "jsdom";
import { createApp } from "../server/app.js";
import { SqliteRepository } from "../server/repositories/sqlite.js";
import { DEMO_HOST_IDS, personId, dinnerId } from "../server/demo-data.js";
const html = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);
const code = await readFile(
  new URL("../public/dashboard.js", import.meta.url),
  "utf8",
);
async function waitFor(predicate, label) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${label}`);
}
async function setup(t, hostIds = DEMO_HOST_IDS) {
  const repository = new SqliteRepository(":memory:");
  const server = createApp({
    repository,
    config: { authMode: "demo", demoHostIds: hostIds },
    logger: { error() {} },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const windows = [];
  t.after(async () => {
    windows.forEach((w) => w.close());
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await repository.close();
  });
  function open() {
    const errors = [];
    const console = new VirtualConsole();
    console.on("jsdomError", (error) => errors.push(error.message));
    const dom = new JSDOM(html, {
      url: base,
      runScripts: "outside-only",
      virtualConsole: console,
    });
    const w = dom.window;
    windows.push(w);
    w.AbortSignal = AbortSignal;
    w.fetch = (url, options) => fetch(new URL(url, base), options);
    w.eval(code);
    const el = (id) => w.document.getElementById(id);
    const ready = () =>
      waitFor(
        () => el("eventTheme").textContent && !el("refreshButton").disabled,
        "dashboard ready",
      );
    async function choose(id, value) {
      el(id).value = value;
      el(id).dispatchEvent(new w.Event("change", { bubbles: true }));
      await waitFor(() => !el("refreshButton").disabled, "selection update");
    }
    async function click(id, predicate) {
      el(id).click();
      await waitFor(
        predicate || (() => !el("refreshButton").disabled),
        "button request",
      );
    }
    return { w, el, ready, choose, click, errors };
  }
  return { repository, open };
}
test("frontend renders persisted roster, party counts and dietary notes from the HTTP API", async (t) => {
  const { open } = await setup(t);
  const ui = open();
  await ui.ready();
  assert.equal(ui.el("eventTheme").textContent, "Career switches over supper");
  assert.equal(ui.el("studentCount").textContent, "3");
  assert.equal(ui.el("familyCount").textContent, "2");
  assert.equal(ui.el("capacityCounterText").textContent, "5 / 6 reserved");
  assert.equal(ui.el("rosterList").children.length, 3);
  assert.match(ui.el("rosterList").textContent, /child has a nut allergy/);
  assert.match(ui.el("dietarySummary").textContent, /Nut allergy/);
  assert.deepEqual(ui.errors, []);
});
test("frontend add/cancel/reset drives actual DB state and survives a new page instance", async (t) => {
  const { open } = await setup(t);
  const ui = open();
  await ui.ready();
  await ui.choose("eventSelect", dinnerId(3));
  assert.equal(ui.el("statusBadge").textContent, "No sign-ups");
  await ui.choose("familySeats", "2");
  await ui.click(
    "addButton",
    () =>
      ui.el("studentCount").textContent === "1" &&
      !ui.el("refreshButton").disabled,
  );
  assert.equal(ui.el("familyCount").textContent, "2");
  assert.match(
    ui.el("dietarySummary").textContent,
    /no dietary details provided/,
  );
  const second = open();
  await second.ready();
  await second.choose("eventSelect", dinnerId(3));
  assert.equal(second.el("studentCount").textContent, "1");
  assert.equal(second.el("familyCount").textContent, "2");
  await second.click(
    "cancelButton",
    () =>
      second.el("studentCount").textContent === "0" &&
      !second.el("refreshButton").disabled,
  );
  assert.equal(second.el("rosterEmpty").hidden, false);
  await second.click(
    "addButton",
    () =>
      second.el("studentCount").textContent === "1" &&
      !second.el("refreshButton").disabled,
  );
  await second.click(
    "resetButton",
    () =>
      second.el("studentCount").textContent === "0" &&
      !second.el("refreshButton").disabled,
  );
});
test("frontend host/event selection handles full, under-minimum, cancelled and empty events", async (t) => {
  const { open } = await setup(t, [...DEMO_HOST_IDS, personId(20)]);
  const ui = open();
  await ui.ready();
  await ui.choose("eventSelect", dinnerId(8));
  assert.equal(ui.el("statusBadge").textContent, "Fully booked");
  assert.match(ui.el("statusBanner").textContent, /only 1 student/);
  assert.equal(ui.el("addButton").disabled, true);
  await ui.choose("eventSelect", dinnerId(5));
  assert.equal(ui.el("statusBadge").textContent, "Cancelled");
  await ui.choose("hostSelect", personId(14));
  assert.equal(ui.el("eventTheme").textContent, "Food and culture exchange");
  assert.equal(ui.el("seatsLeft").textContent, "0");
  await ui.choose("hostSelect", personId(20));
  assert.equal(ui.el("emptyState").hidden, false);
  assert.equal(ui.el("dashboard").hidden, true);
});
test("stored guest text remains text rather than HTML; no script markup is created", async (t) => {
  const { repository, open } = await setup(t);
  repository.db
    .prepare("UPDATE profiles SET full_name=? WHERE id=?")
    .run('<img src=x onerror="alert(1)">', personId(3));
  const ui = open();
  await ui.ready();
  assert.match(ui.el("rosterList").textContent, /<img/);
  assert.equal(ui.el("rosterList").querySelectorAll("img,script").length, 0);
});
test("frontend exposes a retry control for connection failures and recovers", async (t) => {
  const { repository, open } = await setup(t);
  const original = repository.listSnapshots.bind(repository);
  repository.listSnapshots = async () => {
    throw new Error("database offline");
  };
  const ui = open();
  await waitFor(() => !ui.el("errorMessage").hidden, "connection error");
  assert.equal(ui.el("retryButton").hidden, false);
  assert.equal(ui.el("dashboard").hidden, true);
  repository.listSnapshots = original;
  await ui.click(
    "retryButton",
    () =>
      Boolean(ui.el("eventTheme").textContent) &&
      !ui.el("refreshButton").disabled,
  );
  assert.equal(ui.el("errorMessage").hidden, true);
  assert.equal(ui.el("dashboard").hidden, false);
});
