const User = require("../models/user.model");
const { verifyAccessToken } = require("../services/token.service");
const ApiError = require("../utils/ApiError");

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Verifies the access token and attaches the live user document to `req.user`.
 *
 * The user is re-fetched on every request rather than trusted from the token
 * payload, so a deleted account cannot keep making calls until its token
 * happens to expire.
 */
async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return next(ApiError.unauthorized("Missing access token"));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const message =
      err.name === "TokenExpiredError" ? "Access token expired" : "Invalid access token";
    return next(ApiError.unauthorized(message));
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    return next(ApiError.unauthorized("User no longer exists"));
  }

  req.user = user;
  return next();
}

module.exports = { requireAuth };
