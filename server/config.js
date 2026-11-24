import { resolve } from "node:path";
import { DEMO_HOST_IDS } from "./demo-data.js";
import { requireUuid } from "./errors.js";
export function loadConfig(env = process.env) {
  const authMode = env.AUTH_MODE || "demo";
  if (!["demo", "supabase"].includes(authMode))
    throw new Error("AUTH_MODE must be demo or supabase.");
  if (authMode === "demo" && env.NODE_ENV === "production")
    throw new Error(
      "Demo identity is local-only. Use AUTH_MODE=supabase for deployment.",
    );
  const host = env.HOST || (authMode === "demo" ? "127.0.0.1" : "0.0.0.0");
  if (authMode === "demo" && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Demo mode must bind to loopback.");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  if (
    authMode === "supabase" &&
    (!env.DATABASE_URL ||
      !env.SUPABASE_URL ||
      !(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY))
  ) {
    throw new Error(
      "Supabase mode requires DATABASE_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  if (authMode === "supabase") {
    const url = new URL(env.SUPABASE_URL);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("Use HTTPS for Supabase Auth.");
    if (env.NODE_ENV === "production" && env.SECURE_COOKIES !== "true")
      throw new Error("Set SECURE_COOKIES=true behind HTTPS in production.");
  }
  return {
    authMode,
    host,
    port,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL !== "false",
    caFile: env.DATABASE_CA_FILE,
    sqliteFile: resolve(env.DEMO_DB_PATH || "data/host-dashboard.sqlite"),
    demoHostIds: (env.DEMO_HOST_IDS
      ? env.DEMO_HOST_IDS.split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : DEMO_HOST_IDS
    ).map((x) => requireUuid(x, "Demo host ID")),
    supabaseUrl: env.SUPABASE_URL?.replace(/\/$/, ""),
    supabaseKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY,
    secureCookies: env.SECURE_COOKIES === "true",
  };
}
