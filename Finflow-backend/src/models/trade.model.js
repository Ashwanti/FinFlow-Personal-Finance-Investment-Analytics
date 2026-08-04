const mongoose = require("mongoose");

const { TRADE_TYPES } = require("../constants");

/**
 * A buy or sell. Trades are the source of truth; a Holding's quantity, lots
 * and realised P&L are all replayed from them.
 *
 * Deliberately *not* a Transaction. Buying an asset is not spending: money
 * moves from cash into something you still own, and your net worth does not
 * change. Recording it as an expense would be the same mistake as recording a
 * transfer as one — the spending report would blame you for saving.
 *
 * A trade instead adjusts the broker account's cash balance directly, and the
 * position shows up in net worth as market value.
 */
const tradeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    holding: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Holding",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(TRADE_TYPES),
    },
    quantityScaled: {
      type: Number,
      required: true,
      min: [1, "Quantity must be greater than zero"],
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be an integer at 1e-8 scale",
      },
    },
    pricePerUnitMinor: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Price must be an integer number of minor units",
      },
    },
    // Brokerage, STT, GST — real money that leaves regardless of the trade's
    // outcome, so it belongs in cost basis rather than being ignored.
    feesMinor: { type: Number, default: 0, min: 0 },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    date: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 500, default: "" },

    // --- filled in on SELL, by FIFO, when the holding is replayed ---
    costBasisSoldMinor: { type: Number, default: null },
    realizedPnlMinor: { type: Number, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Replay order. createdAt breaks ties so two trades on the same day always
// replay the same way, which keeps FIFO deterministic.
tradeSchema.index({ user: 1, holding: 1, date: 1, createdAt: 1 });
tradeSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model("Trade", tradeSchema);
