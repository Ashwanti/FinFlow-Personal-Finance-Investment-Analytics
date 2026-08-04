const mongoose = require("mongoose");

/**
 * A lease on a background job, so only one process runs it at a time.
 *
 * Without this, every instance behind a load balancer refreshes every price on
 * its own timer: the vendor sees N times the traffic and the free tier's rate
 * limit arrives N times sooner. The lock lives in MongoDB because that is
 * already a dependency — pulling in Redis for one lease would be a poor trade.
 *
 * It is a *lease*, not a mutex: it carries an expiry so a process that dies
 * mid-run cannot block the job forever. That means the guarantee is "almost
 * always one runner", which is the right level for refreshing a price cache.
 * Anything requiring exactly-once needs a real queue.
 */
const jobLockSchema = new mongoose.Schema(
  {
    // The job's name — one document per job, created on first run.
    name: {
      type: String,
      required: true,
      unique: true,
    },
    // Who holds it. Lets a holder renew or release its own lease without
    // stealing one that has since passed to another process.
    owner: { type: String, required: true },
    acquiredAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    lastFinishedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JobLock", jobLockSchema);
