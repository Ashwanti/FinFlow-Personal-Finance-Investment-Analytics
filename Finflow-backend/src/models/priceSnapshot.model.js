const mongoose = require("mongoose");

const { PRICE_PROVIDERS } = require("../constants");

/**
 * One recorded price per instrument per day.
 *
 * PriceQuote holds only the *latest* price, which is all a live portfolio
 * needs. But a net worth trend needs what a position was worth back then, and
 * that cannot be reconstructed after the fact — so it has to be written down as
 * it happens.
 *
 * This does not invent history. A snapshot exists only from the day the
 * instrument was first priced; the trend falls back to cost basis for periods
 * before that and says which basis it used, rather than back-filling today's
 * price across months it was never worth that much.
 */
const priceSnapshotSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: Object.values(PRICE_PROVIDERS),
    },
    providerSymbol: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    // Truncated to UTC midnight: one row per instrument per day. Finer
    // granularity would grow without bound for a series only ever read at
    // period boundaries.
    date: { type: Date, required: true },
    priceMinor: { type: Number, required: true },
  },
  { timestamps: true }
);

// Re-pricing the same instrument on the same day overwrites rather than
// appends, so the row is the day's last known price.
priceSnapshotSchema.index(
  { provider: 1, providerSymbol: 1, currency: 1, date: 1 },
  { unique: true }
);

/** Lookup order for "the price as of date T". */
priceSnapshotSchema.index({ provider: 1, providerSymbol: 1, currency: 1, date: -1 });

module.exports = mongoose.model("PriceSnapshot", priceSnapshotSchema);
