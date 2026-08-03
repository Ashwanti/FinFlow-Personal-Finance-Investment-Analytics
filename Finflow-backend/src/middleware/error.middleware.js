const env = require("../config/env");
const ApiError = require("../utils/ApiError");

/** Reached only when no route matched. */
function notFound(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Turns anything thrown anywhere in the stack into a consistent JSON body.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so controllers do not need a try/catch or an asyncHandler wrapper.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || "Internal Server Error";
  let details = err.details;

  if (err.name === "ValidationError" && err.errors) {
    // Mongoose schema validation
    status = 400;
    message = "Validation failed";
    details = Object.values(err.errors).map((issue) => ({
      field: issue.path,
      message: issue.message,
    }));
  } else if (err.name === "CastError") {
    status = 400;
    message = `Invalid value for '${err.path}'`;
  } else if (err.code === 11000) {
    // Unique index violation — the race that slips past an existence check
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || "value";
    status = 409;
    message = `That ${field} is already in use`;
  } else if (err.name === "JsonWebTokenError") {
    status = 401;
    message = "Invalid token";
  } else if (err.name === "TokenExpiredError") {
    status = 401;
    message = "Token expired";
  }

  if (status >= 500) {
    console.error("💥 Unhandled error:", err);
  }

  const body = { success: false, message };
  if (details) body.errors = details;
  if (!env.isProduction && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
