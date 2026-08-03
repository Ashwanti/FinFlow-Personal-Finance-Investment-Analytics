const mongoose = require("mongoose");

const { TRANSACTION_TYPES, TRANSFER_DIRECTIONS } = require("../constants");
const ApiError = require("../utils/ApiError");
const { signedMinor } = require("../utils/money");

/**
 * One row per movement of money.
 *
 * A transfer is stored as **two** rows sharing a `transferGroupId`: an OUT leg
 * on the source account and an IN leg on the destination. That keeps each
 * account's balance derivable from its own rows, while `transferGroupId` lets
 * the pair be shown, edited and deleted as a single thing.
 *
 * Both legs are typed TRANSFER, which is what makes them excludable from every
 * income/expense aggregate in one filter.
 */
const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: Object.values(TRANSACTION_TYPES),
    },
    // Always positive. Direction comes from `type` + `transferDirection`, so a
    // SUM of expenses is a positive "total spent" with no abs() needed.
    amountMinor: {
      type: Number,
      required: true,
      min: [1, "Amount must be greater than zero"],
      validate: {
        validator: Number.isInteger,
        message: "Amount must be an integer number of minor units (paise/cents)",
      },
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    // Required for INCOME and EXPENSE, forbidden on TRANSFER — enforced below.
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    date: { type: Date, required: true },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (tags) => tags.length <= 20,
        message: "A transaction cannot have more than 20 tags",
      },
    },

    // --- transfer legs only ---
    transferGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    transferDirection: {
      type: String,
      enum: [...Object.values(TRANSFER_DIRECTIONS), null],
      default: null,
    },
    counterAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },
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

// Listing is always "this user, newest first", optionally narrowed.
transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ user: 1, account: 1, date: -1 });
transactionSchema.index({ user: 1, category: 1, date: -1 });
transactionSchema.index({ user: 1, type: 1, date: -1 });
transactionSchema.index({ user: 1, transferGroupId: 1 });

/** How this row moves its account's balance: negative for money leaving. */
transactionSchema.virtual("signedAmountMinor").get(function signedAmountMinor() {
  return signedMinor(this);
});

// A category on a transfer would let it leak into spending reports, and a
// missing category on an expense leaves a hole in every breakdown.
//
// Declared async and throwing rather than taking a `next` callback: Mongoose 9
// invokes document pre-hooks without one.
transactionSchema.pre("validate", async function enforceCategoryRules() {
  if (this.type === TRANSACTION_TYPES.TRANSFER) {
    if (this.category) {
      throw ApiError.badRequest("Transfers cannot have a category");
    }
    if (!this.transferDirection || !this.transferGroupId) {
      throw ApiError.badRequest("Transfer legs require a direction and a group id");
    }
  } else {
    if (!this.category) {
      throw ApiError.badRequest("Income and expense transactions require a category");
    }
    if (this.transferGroupId || this.transferDirection) {
      throw ApiError.badRequest("Only transfers may carry transfer fields");
    }
  }
});

module.exports = mongoose.model("Transaction", transactionSchema);
