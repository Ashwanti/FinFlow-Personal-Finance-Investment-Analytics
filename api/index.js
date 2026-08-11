/**
 * Vercel serverless entry for the FinFlow API.
 *
 * The Express app is reused untouched — this file only supplies the two things
 * `src/server.js` normally does and a lambda cannot: it makes sure MongoDB is
 * connected before the app sees a request, and it never calls `listen()`,
 * because the platform owns the socket.
 *
 * The background price/FX sync jobs are deliberately *not* started here. A
 * serverless instance is frozen between requests, so an interval either never
 * fires or fires on a random subset of instances. Prices are fetched lazily on
 * read with a TTL cache anyway (see services/price/index.js), so the portfolio
 * still values correctly — the job was only ever there to warm the cache.
 */

const REQUIRED_ENV = ["MONGODB_URI", "JWT_ACCESS_SECRET"];

// Loaded on first request rather than at module scope, and cached after.
//
// config/env.js calls process.exit(1) when a variable is missing, which is
// right for a server you are watching start and useless in a lambda: the
// process dies during import, so nothing gets to answer the request and the
// platform returns a bare 500. Requiring lazily lets the check below run first
// and say what is actually wrong.
let cached = null;

function load() {
  if (!cached) {
    cached = {
      app: require("../Finflow-backend/src/app"),
      connectDB: require("../Finflow-backend/src/config/db").connectDB,
    };
  }
  return cached;
}

function fail(res, status, message, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  // The same envelope as every other error the API returns, so a client needs
  // no special case for "the platform is having a bad day".
  res.end(JSON.stringify({ success: false, message, ...extra }));
}

module.exports = async (req, res) => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing environment variable(s): ${missing.join(", ")}`);
    return fail(
      res,
      503,
      `The API is not configured yet: ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } not set. Add ${
        missing.length === 1 ? "it" : "them"
      } in Vercel under Settings → Environment Variables, then redeploy.`,
      { missingEnv: missing }
    );
  }

  let app;
  let connectDB;
  try {
    ({ app, connectDB } = load());
  } catch (err) {
    console.error("Failed to load the application:", err);
    return fail(res, 500, "The API failed to start. Check the deployment logs.");
  }

  try {
    // Idempotent and cached inside config/db.js, so this costs nothing on a
    // warm instance.
    await connectDB();
  } catch (err) {
    console.error("Database unavailable:", err.message);
    return fail(
      res,
      503,
      "Database unavailable. Check MONGODB_URI, the database user's password, " +
        "and that Network Access allows 0.0.0.0/0."
    );
  }

  return app(req, res);
};
