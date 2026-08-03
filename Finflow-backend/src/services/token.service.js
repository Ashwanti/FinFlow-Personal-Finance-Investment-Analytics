const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const RefreshToken = require("../models/refreshToken.model");
const ApiError = require("../utils/ApiError");

const REFRESH_TOKEN_BYTES = 48;

/**
 * Access tokens are stateless JWTs and deliberately short-lived, because there
 * is no way to revoke one before it expires.
 *
 * Refresh tokens are the opposite: opaque random strings stored server-side, so
 * they can be revoked instantly. Each use rotates the token, and replaying an
 * already-rotated token is treated as theft.
 */

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), email: user.email }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
    issuer: env.jwt.issuer,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, { issuer: env.jwt.issuer });
}

async function issueRefreshToken(user, context = {}) {
  const token = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.jwt.refreshTtlMs),
    userAgent: context.userAgent,
    ip: context.ip,
  });

  return token;
}

/**
 * Exchange a valid refresh token for a fresh pair, invalidating the old one.
 *
 * If a token that has already been rotated away comes back, the only
 * explanations are a stolen token or a replay, so every session for that user
 * is revoked and they are forced to log in again.
 */
async function rotateRefreshToken(token, context = {}) {
  if (!token) {
    throw ApiError.unauthorized("Missing refresh token");
  }

  const stored = await RefreshToken.findOne({ tokenHash: hashToken(token) }).populate("user");
  if (!stored) {
    throw ApiError.unauthorized("Invalid refresh token");
  }

  if (stored.revokedAt) {
    await RefreshToken.updateMany(
      { user: stored.user, revokedAt: null },
      { revokedAt: new Date() }
    );
    throw ApiError.unauthorized("Refresh token reuse detected — all sessions have been revoked");
  }

  if (stored.expiresAt <= new Date()) {
    throw ApiError.unauthorized("Refresh token expired");
  }

  if (!stored.user) {
    throw ApiError.unauthorized("User no longer exists");
  }

  const refreshToken = await issueRefreshToken(stored.user, context);

  stored.revokedAt = new Date();
  stored.replacedByHash = hashToken(refreshToken);
  await stored.save();

  return {
    user: stored.user,
    accessToken: signAccessToken(stored.user),
    refreshToken,
  };
}

/** Revoke a single session. Silently succeeds if the token is already gone. */
async function revokeRefreshToken(token) {
  if (!token) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(token), revokedAt: null },
    { revokedAt: new Date() }
  );
}

/** Revoke every active session for a user ("log out everywhere"). */
async function revokeAllForUser(userId) {
  const result = await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { revokedAt: new Date() }
  );
  return result.modifiedCount;
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
