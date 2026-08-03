const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const morgan = require("morgan");

const env = require("./config/env");
const { notFound, errorHandler } = require("./middleware/error.middleware");
const routes = require("./routes");

const app = express();

// Behind a proxy (Render, Railway, nginx) req.ip must come from
// X-Forwarded-For, otherwise every client shares one rate-limit bucket.
if (env.isProduction) {
  app.set("trust proxy", 1);
}

// Security & parsing
app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true, // required for the httpOnly refresh cookie
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (!env.isTest) {
  app.use(morgan(env.isProduction ? "combined" : "dev"));
}

// Health check — reports DB state too, so a load balancer does not route
// traffic to an instance that has lost Mongo.
app.get("/health", (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({
    success: dbUp,
    message: dbUp ? "Server is running" : "Database unavailable",
    uptime: Math.floor(process.uptime()),
    database: mongoose.STATES[mongoose.connection.readyState],
  });
});

// Application routes
app.use("/api", routes);

// 404 + global error handler, always last
app.use(notFound);
app.use(errorHandler);

module.exports = app;
