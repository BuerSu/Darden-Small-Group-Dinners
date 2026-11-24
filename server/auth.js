import { AppError, requireUuid } from "./errors.js";
const cookieName = "darden_host_session";
function tokenFor(req) {
  const bearer = req.get("authorization");
  if (bearer) return /^Bearer\s+(.+)$/i.exec(bearer)?.[1];
  const part = (req.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${cookieName}=`));
  try {
    return part ? decodeURIComponent(part.slice(cookieName.length + 1)) : null;
  } catch {
    return null;
  }
}
export function createAuth(config, request = fetch) {
  async function authRequest(path, options = {}) {
    let response;
    try {
      response = await request(`${config.supabaseUrl}/auth/v1/${path}`, {
        ...options,
        headers: { apikey: config.supabaseKey, ...options.headers },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new AppError(
        503,
        "AUTH_UNAVAILABLE",
        "Sign-in is temporarily unavailable. Please try again.",
      );
    }
    if (!response.ok) {
      if (response.status === 429)
        throw new AppError(
          429,
          "AUTH_RATE_LIMIT",
          "Too many sign-in attempts. Please wait and try again.",
        );
      if (response.status >= 500)
        throw new AppError(
          503,
          "AUTH_UNAVAILABLE",
          "Sign-in is temporarily unavailable.",
        );
      throw new AppError(
        401,
        "SIGN_IN_REQUIRED",
        "Sign in with your Darden account to continue.",
      );
    }
    try {
      return await response.json();
    } catch {
      throw new AppError(
        503,
        "AUTH_UNAVAILABLE",
        "Sign-in is temporarily unavailable.",
      );
    }
  }
  return {
    async identify(req) {
      if (config.authMode === "demo") {
        const id = requireUuid(req.get("x-demo-host-id"), "Demo host ID");
        if (!config.demoHostIds.includes(id))
          throw new AppError(
            403,
            "HOST_NOT_ALLOWED",
            "Choose one of the available demo hosts.",
          );
        return id;
      }
      const token = tokenFor(req);
      if (!token || token.length > 16000)
        throw new AppError(
          401,
          "SIGN_IN_REQUIRED",
          "Sign in to view your hosted dinners.",
        );
      // Verify the token with Supabase; never trust a decoded JWT/user ID header.
      const user = await authRequest("user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (
        !user.email_confirmed_at ||
        !/^[^@\s]+@darden\.virginia\.edu$/i.test(user.email || "")
      ) {
        throw new AppError(
          403,
          "VERIFICATION_REQUIRED",
          "Verify your Darden email before continuing.",
        );
      }
      return requireUuid(user.id, "User ID");
    },
    async login(req, res) {
      if (config.authMode !== "supabase")
        throw new AppError(
          404,
          "NOT_FOUND",
          "Sign-in is not required in the local demo.",
        );
      const { email, password } = req.body || {};
      if (
        typeof email !== "string" ||
        !/^[^@\s]+@darden\.virginia\.edu$/i.test(email.trim()) ||
        typeof password !== "string" ||
        !password ||
        password.length > 1024
      ) {
        throw new AppError(
          400,
          "INVALID_SIGN_IN",
          "Enter your Darden email and password.",
        );
      }
      const session = await authRequest("token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!session.access_token)
        throw new AppError(
          401,
          "SIGN_IN_REQUIRED",
          "Check your sign-in details.",
        );
      res.cookie(cookieName, session.access_token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.secureCookies,
        path: "/api",
        maxAge: Math.min(Number(session.expires_in) || 3600, 3600) * 1000,
      });
      res.json({ signed_in: true });
    },
    logout(_req, res) {
      // This signs out this dashboard. Revoking other app sessions is outside this feature.
      res.clearCookie(cookieName, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.secureCookies,
        path: "/api",
      });
      res.json({ signed_in: false });
    },
  };
}
