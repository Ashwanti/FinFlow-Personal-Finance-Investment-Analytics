const mongoose = require("mongoose");

const { ASSET_CLASSES, PRICE_PROVIDERS } = require("../constants");

/**
 * One open lot: a quantity bought at a unit cost, still unsold.
 *
 * Lots are kept rather than a single average cost because realised profit
 * depends on *which* units you sold. Selling 10 of 30 shares bought at three
 * different prices has three different answers, and tax treatment everywhere
 * cares which one you use. FIFO is applied on sale.
 */
const lotSchema = new mongoose.Schema(
  {
    trade: { type: mongoose.Schema.Types.ObjectId, ref: "Trade" },
    quantityScaled: { type: Number, required: true },
    /**
     * Total cost of the units still in this lot, fees included — so cost basis
     * is what you actually parted with, not the headline price.
     *
     * The total is authoritative rather than a per-unit figure: a per-unit cost
     * has to be rounded to an integer, and multiplying it back by the quantity
     * then loses paise on any lot whose cost does not divide evenly.
     */
    costMinor: { type: Number, required: true },
    // Derived from the two fields above, kept for display only.
    unitCostMinor: { type: Number, required: true },
    date: { type: Date, required: true },
  },
  { _id: false }
);

const holdingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // The broker/exchange account the position sits in. Cash for trades moves
    // through this account's balance.
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    name: { type: String, trim: true, maxlength: 120, default: "" },
    assetClass: {
      type: String,
      required: true,
      enum: Object.values(ASSET_CLASSES),
      default: ASSET_CLASSES.EQUITY,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },

    // --- pricing ---
    priceProvider: {
      type: String,
      enum: Object.values(PRICE_PROVIDERS),
      default: PRICE_PROVIDERS.MANUAL,
    },
    // The vendor's own identifier, which rarely matches the ticker
    // ("bitcoin", not "BTC").
    providerSymbol: { type: String, trim: true, default: "" },
    // Used when priceProvider is manual, and as the fallback whenever a vendor
    // lookup fails — a stale price the user set beats no valuation at all.
    manualPriceMinor: { type: Number, default: null },

    // --- derived from trades, rebuilt by holding.service.rebuild() ---
    quantityScaled: { type: Number, default: 0 },
    costBasisMinor: { type: Number, default: 0 },
    realizedPnlMinor: { type: Number, default: 0 },
    feesMinor: { type: Number, default: 0 },
    openLots: { type: [lotSchema], default: [] },

    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    isArchived: { type: Boolean, default: false },
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

// One position per instrument per account: buying more of something you
// already hold adds a lot, it does not create a second holding.
holdingSchema.index({ user: 1, account: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model("Holding", holdingSchema);
