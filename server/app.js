import express from "express";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { StatusService } from "./status-service.js";
import { AppError, requireUuid } from "./errors.js";
import { createAuth } from "./auth.js";
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
export function createApp({
  repository,
  config,
  auth = createAuth(config),
  logger = console,
}) {
  const app = express();
  app.disable("x-powered-by");
  const service = new StatusService(repository);
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) {
      res.set("Cache-Control", "no-store");
      // Avoid DNS rebinding against the local no-login demo.
      if (
        config.authMode === "demo" &&
        !["localhost", "127.0.0.1", "[::1]", "::1"].includes(req.hostname)
      ) {
        return next(
          new AppError(
            403,
            "LOCAL_ONLY",
            "Demo mode accepts localhost requests only.",
          ),
        );
      }
      const origin = req.get("origin");
      try {
        if (origin && new URL(origin).host !== req.get("host"))
          throw new Error();
      } catch {
        return next(
          new AppError(
            403,
            "ORIGIN_REJECTED",
            "Cross-origin requests are not allowed.",
          ),
        );
      }
      if (
        ["POST", "PUT", "PATCH"].includes(req.method) &&
        !req.is("application/json")
      ) {
        return next(
          new AppError(
            415,
            "JSON_REQUIRED",
            "Send an application/json request.",
          ),
        );
      }
    }
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  app.get("/api/config", async (_req, res) => {
    const hosts =
      config.authMode === "demo"
        ? await repository.hosts(config.demoHostIds)
        : [];
    hosts.sort(
      (a, b) =>
        config.demoHostIds.indexOf(a.id) - config.demoHostIds.indexOf(b.id),
    );
    res.json({
      auth_mode: config.authMode,
      data_source: config.databaseUrl ? "supabase" : "local",
      demo_hosts: hosts,
      simulation_available:
        Boolean(repository.mutateDemo) && config.authMode === "demo",
    });
  });
  app.post("/api/session", (req, res) => auth.login(req, res));
  app.delete("/api/session", (req, res) => auth.logout(req, res));
  app.use("/api/host", async (req, _res, next) => {
    try {
      req.hostId = await auth.identify(req);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/host/dinners", async (req, res) =>
    res.json({ dinners: await service.list(req.hostId) }),
  );
  app.get("/api/host/dinners/:id/status", async (req, res) => {
    res.json(
      await service.get(req.hostId, requireUuid(req.params.id, "Dinner ID")),
    );
  });
  app.post("/api/host/dinners/:id/demo", async (req, res) => {
    if (config.authMode !== "demo" || !repository.mutateDemo)
      throw new AppError(
        404,
        "NOT_FOUND",
        "Demo controls are unavailable for this database.",
      );
    res.json(
      await service.simulate(
        req.hostId,
        requireUuid(req.params.id, "Dinner ID"),
        req.body?.action,
        req.body?.family_seats ?? 0,
      ),
    );
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "API endpoint not found.")),
  );
  app.get("/Checking event status.html", (_req, res) =>
    res.sendFile(resolve(publicDir, "index.html")),
  );
  app.use(express.static(publicDir, { dotfiles: "deny", index: "index.html" }));
  app.use((_req, _res, next) =>
    next(new AppError(404, "NOT_FOUND", "Page not found.")),
  );
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed")
      error = new AppError(
        400,
        "INVALID_JSON",
        "The request body is not valid JSON.",
      );
    if (error.type === "entity.too.large")
      error = new AppError(
        413,
        "REQUEST_TOO_LARGE",
        "The request is too large.",
      );
    if (error instanceof AppError)
      return res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
    // Database URLs/credentials/query details never appear in HTTP responses or logs.
    logger.error("Host dashboard request failed.", {
      code: error.code || "INTERNAL_ERROR",
    });
    res
      .status(503)
      .json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message:
            "Unable to load dinner information. Check the server connection and try again.",
        },
      });
  });
  return app;
}
