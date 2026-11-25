import test from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../server/auth.js";
import { personId } from "../server/demo-data.js";
const config = {
  authMode: "supabase",
  supabaseUrl: "https://project.example",
  supabaseKey: "public-key",
  secureCookies: true,
};
const req = (headers) => ({ get: (key) => headers[key.toLowerCase()] });
const user = {
  id: personId(1),
  email: "host@darden.virginia.edu",
  email_confirmed_at: "2026-01-01T00:00:00Z",
};
test("Supabase identity uses server-verified user, ignoring supplied demo identity", async () => {
  let called;
  const auth = createAuth(config, async (url, options) => {
    called = { url, options };
    return Response.json(user);
  });
  assert.equal(
    await auth.identify(
      req({
        authorization: "Bearer jwt-from-login",
        "x-demo-host-id": personId(14),
      }),
    ),
    personId(1),
  );
  assert.match(called.url, /auth\/v1\/user$/);
  assert.equal(called.options.headers.Authorization, "Bearer jwt-from-login");
});
test("missing, invalid and unverified sessions cannot read rosters", async () => {
  const auth = createAuth(config, async () =>
    Response.json({}, { status: 401 }),
  );
  await assert.rejects(
    () => auth.identify(req({})),
    (e) => e.status === 401,
  );
  await assert.rejects(
    () => auth.identify(req({ authorization: "Bearer forged" })),
    (e) => e.status === 401,
  );
  const unverified = createAuth(config, async () =>
    Response.json({ ...user, email_confirmed_at: null }),
  );
  await assert.rejects(
    () => unverified.identify(req({ authorization: "Bearer token" })),
    (e) => e.status === 403,
  );
});
test("session cookie is read but always verified with Supabase", async () => {
  const auth = createAuth(config, async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return Response.json(user);
  });
  assert.equal(
    await auth.identify(
      req({ cookie: "other=x; darden_host_session=test-token" }),
    ),
    personId(1),
  );
});
test("sign-in stores only an HTTP-only cookie and omits tokens from response", async () => {
  const auth = createAuth(config, async (_url, options) => {
    assert.equal(JSON.parse(options.body).email, "host@darden.virginia.edu");
    return Response.json({ access_token: "secret-session", expires_in: 3600 });
  });
  let cookie, response;
  await auth.login(
    {
      body: { email: "host@darden.virginia.edu", password: "example-password" },
    },
    {
      cookie: (...args) => {
        cookie = args;
      },
      json: (value) => {
        response = value;
      },
    },
  );
  assert.equal(cookie[2].httpOnly, true);
  assert.equal(cookie[2].secure, true);
  assert.equal(cookie[2].sameSite, "strict");
  assert.deepEqual(response, { signed_in: true });
});
test("auth transport errors do not disclose upstream details", async () => {
  const auth = createAuth(config, async () => {
    throw new Error("secret URL or token");
  });
  await assert.rejects(
    () => auth.identify(req({ authorization: "Bearer token" })),
    (e) => e.status === 503 && !e.message.includes("secret"),
  );
});
