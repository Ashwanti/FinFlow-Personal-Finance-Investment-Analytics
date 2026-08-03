const env = require("../config/env");
const authService = require("../services/auth.service");

const REFRESH_COOKIE = "finflow_refresh";

// Scoped to /api/auth so the cookie is not attached to every other API call.
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? "none" : "lax",
  path: "/api/auth",
  maxAge: env.jwt.refreshTtlMs,
};

const requestContext = (req) => ({
  userAgent: req.get("user-agent"),
  ip: req.ip,
});

/** Cookie first, body second — see the note on refreshSchema. */
const readRefreshToken = (req) =>
  req.cookies?.[REFRESH_COOKIE] || req.validated?.body?.refreshToken || null;

function sendSession(res, status, { user, accessToken, refreshToken }) {
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
  res.status(status).json({
    success: true,
    data: {
      user,
      accessToken,
      // Also returned in the body for clients that cannot store cookies.
      refreshToken,
      expiresIn: env.jwt.accessTtl,
    },
  });
}

async function register(req, res) {
  const session = await authService.register(req.validated.body, requestContext(req));
  sendSession(res, 201, session);
}

async function login(req, res) {
  const session = await authService.login(req.validated.body, requestContext(req));
  sendSession(res, 200, session);
}

async function refresh(req, res) {
  const session = await authService.refresh(readRefreshToken(req), requestContext(req));
  sendSession(res, 200, session);
}

async function logout(req, res) {
  await authService.logout(readRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  res.status(200).json({ success: true, message: "Logged out" });
}

async function logoutAll(req, res) {
  const { revoked } = await authService.logoutAll(req.user._id);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
  res.status(200).json({
    success: true,
    message: `Logged out of ${revoked} session(s)`,
  });
}

async function changePassword(req, res) {
  const session = await authService.changePassword(
    req.user._id,
    req.validated.body,
    requestContext(req)
  );
  sendSession(res, 200, session);
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  changePassword,
  REFRESH_COOKIE,
};
