const mongoose = require("mongoose");

const { BUDGET_PERIODS } = require("../constants");

/**
 * A spending cap on one category for a repeating period.
 *
 * Budgets store only the rule. Everything else — how much is spent, what is
 * left, whether you are over — is computed from transactions on read, using
 * the same aggregation the analytics endpoints use. Storing a running "spent"
 * figure would need updating on every transaction create, edit, delete and
 * re-categorisation, and would silently rot the first time one of those paths
 * missed it.
 */
const budgetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: [1, "A budget must be greater than zero"],
      validate: {
        validator: Number.isInteger,
        message: "Budget must be an integer number of minor units (paise/cents)",
      },
    },
    period: {
      type: String,
      required: true,
      enum: Object.values(BUDGET_PERIODS),
      default: BUDGET_PERIODS.MONTHLY,
    },
    // Periods before this are not budgeted, so rollover cannot reach back
    // further than the day the user started budgeting.
    startDate: {
      type: Date,
      required: true,
    },
    /**
     * Carry unspent budget into the next period (envelope budgeting).
     *
     * The carry is allowed to go negative: overspending in one period really
     * does leave you with less to spend in the next, and clamping it at zero
     * would quietly forgive the overspend.
     */
    rollover: {
      type: Boolean,
      default: false,
    },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
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

// One active budget per category per period length.
budgetSchema.index({ user: 1, category: 1, period: 1 }, { unique: true });

module.exports = mongoose.model("Budget", budgetSchema);
