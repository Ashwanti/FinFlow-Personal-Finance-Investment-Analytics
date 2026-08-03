/* eslint-disable no-console */
/** Phase 1 — registration, sessions, refresh rotation, profile, passwords. */
module.exports = async function authSuite(ctx) {
  const { call, check, section, base } = ctx;

  const email = `smoke+${Date.now()}@smoke.test`;
  const password = "Passw0rd123";

  section("Health");
  const health = await call("GET", "/health");
  check("GET /health returns 200", health.status === 200, health.json);
  check("reports database state", health.json?.database === "connected", health.json);

  section("Register");
  const weak = await call("POST", "/api/auth/register", {
    body: { name: "Ada", email: "not-an-email", password: "short" },
  });
  check("rejects bad input with 400", weak.status === 400, weak.json);
  check(
    "returns per-field validation errors",
    Array.isArray(weak.json?.errors) && weak.json.errors.length >= 2,
    weak.json
  );

  const reg = await call("POST", "/api/auth/register", {
    body: { name: "Ada Lovelace", email, password, baseCurrency: "inr" },
  });
  check("creates the account with 201", reg.status === 201, reg.json);
  check("returns an access token", typeof reg.json?.data?.accessToken === "string");
  check("sets an httpOnly refresh cookie", /httponly/i.test(reg.headers.get("set-cookie") || ""));
  check("never leaks passwordHash", !JSON.stringify(reg.json).includes("passwordHash"));
  check("normalises currency to INR", reg.json?.data?.user?.baseCurrency === "INR");
  check("exposes id, not _id", !!reg.json?.data?.user?.id && !reg.json?.data?.user?._id);

  const dupe = await call("POST", "/api/auth/register", {
    body: { name: "Impostor", email: email.toUpperCase(), password },
  });
  check("rejects a duplicate email with 409", dupe.status === 409, dupe.json);

  section("Protected route");
  const noAuth = await call("GET", "/api/me");
  check("GET /api/me without a token is 401", noAuth.status === 401, noAuth.json);

  const badAuth = await call("GET", "/api/me", { token: "garbage.token.here" });
  check("rejects a malformed token with 401", badAuth.status === 401, badAuth.json);

  const me = await call("GET", "/api/me", { token: reg.json.data.accessToken });
  check("GET /api/me with a token is 200", me.status === 200, me.json);
  check("returns the right user", me.json?.data?.user?.email === email);

  section("Login");
  const wrongPass = await call("POST", "/api/auth/login", {
    body: { email, password: "WrongPass123" },
  });
  check("wrong password is 401", wrongPass.status === 401, wrongPass.json);
  check(
    "does not reveal whether the email exists",
    wrongPass.json?.message === "Invalid email or password",
    wrongPass.json
  );

  const unknownUser = await call("POST", "/api/auth/login", {
    body: { email: "ghost@smoke.test", password },
  });
  check(
    "unknown email gives the same 401 message",
    unknownUser.json?.message === wrongPass.json?.message
  );

  const login = await call("POST", "/api/auth/login", { body: { email, password } });
  check("correct credentials return 200", login.status === 200, login.json);
  check("issues a refresh token", typeof login.json?.data?.refreshToken === "string");

  section("Refresh rotation");
  // Express 5 leaves req.body undefined when no body is sent. A cookie-only
  // client must reach the auth check, not die in the validator.
  const noBody = await fetch(`${base}/api/auth/refresh`, { method: "POST" });
  const noBodyJson = await noBody.json();
  check("a bodyless refresh reaches the auth check", noBody.status === 401, noBodyJson);
  check(
    "fails on the missing token, not on validation",
    /missing refresh token/i.test(noBodyJson?.message || ""),
    noBodyJson
  );

  const firstRefresh = login.json.data.refreshToken;
  const rotated = await call("POST", "/api/auth/refresh", { body: { refreshToken: firstRefresh } });
  check("exchanges a refresh token for 200", rotated.status === 200, rotated.json);
  check(
    "issues a different refresh token",
    rotated.json?.data?.refreshToken && rotated.json.data.refreshToken !== firstRefresh
  );

  const replay = await call("POST", "/api/auth/refresh", { body: { refreshToken: firstRefresh } });
  check("replaying the old token is 401", replay.status === 401, replay.json);
  check("flags it as reuse", /reuse detected/i.test(replay.json?.message || ""), replay.json);

  const afterBreach = await call("POST", "/api/auth/refresh", {
    body: { refreshToken: rotated.json.data.refreshToken },
  });
  check("reuse revokes the whole family", afterBreach.status === 401, afterBreach.json);

  section("Profile update");
  const session = await call("POST", "/api/auth/login", { body: { email, password } });
  const token = session.json.data.accessToken;

  const emptyPatch = await call("PATCH", "/api/me", { token, body: {} });
  check("empty PATCH is rejected with 400", emptyPatch.status === 400, emptyPatch.json);

  const patched = await call("PATCH", "/api/me", {
    token,
    body: { name: "Ada L.", baseCurrency: "usd" },
  });
  check("PATCH /api/me returns 200", patched.status === 200, patched.json);
  check("persists the new name", patched.json?.data?.user?.name === "Ada L.");
  check("uppercases the currency", patched.json?.data?.user?.baseCurrency === "USD");

  section("Change password");
  const wrongCurrent = await call("POST", "/api/auth/change-password", {
    token,
    body: { currentPassword: "NotItAtAll1", newPassword: "BrandNew123" },
  });
  check("wrong current password is 401", wrongCurrent.status === 401, wrongCurrent.json);

  const changed = await call("POST", "/api/auth/change-password", {
    token,
    body: { currentPassword: password, newPassword: "BrandNew123" },
  });
  check("change-password returns 200", changed.status === 200, changed.json);
  check("hands back a fresh session", typeof changed.json?.data?.accessToken === "string");

  const oldSession = await call("POST", "/api/auth/refresh", {
    body: { refreshToken: session.json.data.refreshToken },
  });
  check("old sessions are revoked", oldSession.status === 401, oldSession.json);

  const oldLogin = await call("POST", "/api/auth/login", { body: { email, password } });
  check("old password no longer works", oldLogin.status === 401, oldLogin.json);

  const newLogin = await call("POST", "/api/auth/login", {
    body: { email, password: "BrandNew123" },
  });
  check("new password works", newLogin.status === 200, newLogin.json);

  section("Logout");
  const loggedOut = await call("POST", "/api/auth/logout", {
    body: { refreshToken: newLogin.json.data.refreshToken },
  });
  check("logout returns 200", loggedOut.status === 200, loggedOut.json);

  const afterLogout = await call("POST", "/api/auth/refresh", {
    body: { refreshToken: newLogin.json.data.refreshToken },
  });
  check("the revoked token cannot refresh", afterLogout.status === 401, afterLogout.json);

  section("Routing");
  const missing = await call("GET", "/api/does-not-exist");
  check("unknown route returns a JSON 404", missing.status === 404, missing.json);
  check("404 body is shaped like every other error", missing.json?.success === false);
};
