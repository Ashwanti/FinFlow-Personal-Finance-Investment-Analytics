const mongoose = require("mongoose");

const { PRICE_PROVIDERS } = require("../constants");

/**
 * The last known price for an instrument, per provider.
 *
 * Cached rather than fetched on demand for three reasons: free price APIs
 * rate-limit hard and a dashboard render would burn the quota instantly; a
 * vendor outage should degrade to a stale price rather than an error page; and
 * `asOf` lets the API tell the user how old a valuation is instead of
 * presenting yesterday's number as live.
 */
const priceQuoteSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: Object.values(PRICE_PROVIDERS),
    },
    // The provider's identifier, lowercased for stable lookups.
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
    priceMinor: { type: Number, required: true },
    asOf: { type: Date, required: true },

    // Set when the last refresh failed, so the sync job can back off and the
    // API can explain why a price stopped moving.
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
  },
  { timestamps: true }
);

priceQuoteSchema.index({ provider: 1, providerSymbol: 1, currency: 1 }, { unique: true });

module.exports = mongoose.model("PriceQuote", priceQuoteSchema);
