import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { SqliteRepository } from "../server/repositories/sqlite.js";
import { personId, dinnerId, DEMO_HOST_IDS } from "../server/demo-data.js";
import { loadConfig } from "../server/config.js";
const config = {
  authMode: "demo",
  demoHostIds: DEMO_HOST_IDS,
  secureCookies: false,
};
async function fixture(t, options = {}) {
  const repo = options.repository || new SqliteRepository(":memory:");
  const app = createApp({
    repository: repo,
    config: { ...config, ...options.config },
    logger: { error() {} },
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await repo.close?.();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, opts = {}) =>
    fetch(base + path, {
      ...opts,
      headers: { "X-Demo-Host-Id": personId(1), ...opts.headers },
    });
  return { repo, base, call };
}
test("HTTP serves the PR dashboard and offline local assets without secrets", async (t) => {
  const { call } = await fixture(t);
  const page = await call("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Host dashboard/);
  assert.match(
    page.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal((await call("/styles.css")).status, 200);
  assert.equal((await call("/dashboard.js")).status, 200);
  assert.equal((await call("/.env")).status, 404);
  assert.equal((await call("/server/config.js")).status, 404);
});
test("host API reads persisted dinner and family dietary information", async (t) => {
  const { call } = await fixture(t);
  const res = await call(`/api/host/dinners/${dinnerId(1)}/status`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(data.summary.student_signups, 3);
  assert.equal(data.summary.family_seats, 2);
  assert.equal(data.summary.seats_reserved, 5);
  assert.equal(data.roster.length, 3);
  assert.match(
    data.roster.find((r) => r.family_seats).family_dietary_notes,
    /pescatarian/,
  );
  assert.ok(
    data.roster.every((r) => !("email" in r) && !("phone_number" in r)),
  );
});
test("own event list excludes other hosts; unauthorized and nonexistent dinners return 404", async (t) => {
  const { call } = await fixture(t);
  const { dinners } = await (await call("/api/host/dinners")).json();
  assert.ok(dinners.some((d) => d.id === dinnerId(1)));
  assert.ok(!dinners.some((d) => d.id === dinnerId(2)));
  assert.equal(
    (await call(`/api/host/dinners/${dinnerId(2)}/status`)).status,
    404,
  );
  assert.equal(
    (await call(`/api/host/dinners/${dinnerId(999)}/status`)).status,
    404,
  );
});
test("demo API writes survive a new repository instance", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "darden-host-"));
  const file = join(dir, "demo.sqlite");
  const repo = new SqliteRepository(file);
  const { call } = await fixture(t, { repository: repo });
  t.after(() => rm(dir, { recursive: true, force: true }));
  let res = await call(`/api/host/dinners/${dinnerId(3)}/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", family_seats: 2 }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).summary.seats_reserved, 3);
  const another = new SqliteRepository(file);
  assert.equal(
    (await another.snapshot(dinnerId(3), personId(1))).registrations.filter(
      (r) => r.status === "reserved",
    ).length,
    1,
  );
  await another.close();
});
test("demo mutation enforces capacity atomically and cancellation releases family seats", async (t) => {
  const { call } = await fixture(t);
  const mutate = (action, family_seats = 0) =>
    call(`/api/host/dinners/${dinnerId(1)}/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, family_seats }),
    });
  assert.equal((await mutate("add", 1)).status, 409);
  let data = await (
    await call(`/api/host/dinners/${dinnerId(1)}/status`)
  ).json();
  assert.equal(data.summary.seats_reserved, 5);
  data = await (await mutate("cancel")).json();
  assert.equal(data.summary.seats_reserved, 2);
  data = await (await mutate("reset")).json();
  assert.equal(data.summary.student_signups, 0);
  assert.equal((await mutate("add", -1)).status, 400);
});
test("demo headers, input validation and origin protections are enforced", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (
      await call("/api/host/dinners", {
        headers: { "X-Demo-Host-Id": personId(20) },
      })
    ).status,
    403,
  );
  assert.equal((await call("/api/host/dinners/not-a-uuid/status")).status, 400);
  assert.equal(
    (
      await call("/api/host/dinners", {
        headers: { Origin: "https://unrelated.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/host/dinners/${dinnerId(3)}/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      })
    ).status,
    400,
  );
});
test("Supabase mode does not trust demo-host headers and does not expose simulation writes", async (t) => {
  const options = {
    config: { ...config, authMode: "supabase" },
    auth: { identify: async () => personId(14) },
  };
  const { call } = await fixture(t, options);
  assert.equal(
    (await call(`/api/host/dinners/${dinnerId(1)}/status`)).status,
    404,
  );
  assert.equal(
    (await call(`/api/host/dinners/${dinnerId(2)}/status`)).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/host/dinners/${dinnerId(2)}/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    404,
  );
});
test("unexpected database failures return useful errors without connection details", async (t) => {
  const { call } = await fixture(t, {
    repository: {
      listSnapshots: async () => {
        throw new Error("postgresql://secret:password@db");
      },
    },
  });
  const res = await call("/api/host/dinners");
  const body = await res.text();
  assert.equal(res.status, 503);
  assert.doesNotMatch(body, /password|postgresql/);
});
test("configuration prevents public or production demo identity", () => {
  assert.throws(
    () => loadConfig({ AUTH_MODE: "demo", HOST: "0.0.0.0" }),
    /loopback/,
  );
  assert.throws(
    () => loadConfig({ AUTH_MODE: "demo", NODE_ENV: "production" }),
    /local-only/,
  );
  assert.throws(() => loadConfig({ AUTH_MODE: "supabase" }), /requires/);
});
test("sign-out clears the dashboard cookie without requiring an empty JSON body", async (t) => {
  const { call } = await fixture(t);
  const res = await call("/api/session", { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie"), /darden_host_session=;/);
});
