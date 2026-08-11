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
const app = require("../Finflow-backend/src/app");
const { connectDB } = require("../Finflow-backend/src/config/db");

module.exports = async (req, res) => {
  try {
    // Idempotent and cached inside config/db.js, so this costs nothing on a
    // warm instance.
    await connectDB();
  } catch (err) {
    console.error("Database unavailable:", err.message);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    // Same envelope as every other error the API returns, so a client does not
    // need a special case for "the platform is having a bad day".
    res.end(
      JSON.stringify({
        success: false,
        message: "Database unavailable. Please try again in a moment.",
      })
    );
    return;
  }

  return app(req, res);
};
