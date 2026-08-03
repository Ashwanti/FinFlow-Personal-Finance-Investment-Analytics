const mongoose = require("mongoose");

const { ACCOUNT_TYPES } = require("../constants");

const accountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(ACCOUNT_TYPES),
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    // What the account held before FinFlow started tracking it.
    openingBalanceMinor: { type: Number, default: 0 },
    /**
     * Kept in sync incrementally by the transaction service, in the same write
     * as the transaction itself. Recomputing from the full history on every
     * read would be correct but gets slower with every row the user adds;
     * `recalculateBalance` exists to repair this from source when needed.
     */
    balanceMinor: { type: Number, default: 0 },
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

accountSchema.index({ user: 1, name: 1 }, { unique: true });

// A credit card's "balance" is what you owe, so it is normally negative and
// correctly reduces net worth when summed.
accountSchema.virtual("isLiability").get(function isLiability() {
  return this.type === ACCOUNT_TYPES.CREDIT_CARD;
});

module.exports = mongoose.model("Account", accountSchema);
