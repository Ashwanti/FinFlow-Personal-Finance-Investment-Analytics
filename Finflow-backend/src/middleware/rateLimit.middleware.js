const rateLimit = require("express-rate-limit");

const env = require("../config/env");
const ApiError = require("../utils/ApiError");

const handler = (req, res, next) =>
  next(ApiError.tooManyRequests("Too many attempts. Please try again later."));

const base = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
  // Disabled in tests so the suite is not throttled by its own fixtures.
  skip: () => env.isTest,
};

/** Guards login/register against credential stuffing and brute force. */
const authLimiter = rateLimit({ ...base, limit: 20 });

/** Refresh is called often by a live frontend, so it gets more headroom. */
const refreshLimiter = rateLimit({ ...base, limit: 60 });

module.exports = { authLimiter, refreshLimiter };
