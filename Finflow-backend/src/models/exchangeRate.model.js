const mongoose = require("mongoose");

/**
 * How many units of `quote` one unit of `base` buys — USD/INR 83.5 means one
 * dollar is 83.5 rupees.
 *
 * Stored as a scaled integer for the same reason money is: a rate is a
 * multiplier applied to every figure it touches, so float drift in the rate
 * propagates into every converted total rather than staying in one row.
 *
 * Per-user rather than global. Rates are objective market data, but letting
 * one account's edit move another account's net worth would break the isolation
 * every other model here maintains — and a personal-finance user may well want
 * the rate their bank actually gave them rather than the mid-market one.
 */
const RATE_SCALE = 1e8;

const exchangeRateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    base: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    quote: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    rateScaled: {
      type: Number,
      required: true,
      min: [1, "Rate must be greater than zero"],
      validate: {
        validator: Number.isInteger,
        message: "Rate must be an integer at 1e-8 scale",
      },
    },
    asOf: { type: Date, required: true },
    source: { type: String, default: "manual", maxlength: 32 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        ret.rate = ret.rateScaled / RATE_SCALE;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

exchangeRateSchema.index({ user: 1, base: 1, quote: 1 }, { unique: true });

module.exports = mongoose.model("ExchangeRate", exchangeRateSchema);
module.exports.RATE_SCALE = RATE_SCALE;
