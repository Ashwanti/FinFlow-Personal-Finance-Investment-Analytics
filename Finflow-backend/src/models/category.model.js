const mongoose = require("mongoose");

const { CATEGORY_KINDS } = require("../constants");

const categorySchema = new mongoose.Schema(
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
    // A category belongs to one side of the ledger: "Salary" can never be an
    // expense, and offering it in an expense form is just a way to create bad data.
    kind: {
      type: String,
      required: true,
      enum: Object.values(CATEGORY_KINDS),
    },
    icon: { type: String, default: "•", maxlength: 8 },
    color: { type: String, default: "#64748b", maxlength: 24 },
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

// Names are unique per user per side, so "Other" can exist for both income and
// expense without colliding.
categorySchema.index({ user: 1, kind: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Category", categorySchema);
