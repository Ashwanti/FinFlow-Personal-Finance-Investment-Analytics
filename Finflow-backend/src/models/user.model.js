const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const env = require("../config/env");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true, // creates the unique index; do not also set index: true
      lowercase: true,
      trim: true,
    },
    // `select: false` keeps the hash out of every query result unless a caller
    // explicitly asks for it with .select("+passwordHash").
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    // The currency every report is normalised into. Stored as an ISO-4217 code.
    baseCurrency: {
      type: String,
      default: "INR",
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
    },
    lastLoginAt: {
      type: Date,
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
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

/** Hash a plaintext password. Used by the auth service on register/change. */
userSchema.statics.hashPassword = function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, env.bcryptRounds);
};

/**
 * Compare a candidate password against this user's hash.
 * Requires the document to have been loaded with .select("+passwordHash").
 */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.passwordHash) {
    throw new Error(
      "comparePassword called on a user loaded without passwordHash — use .select('+passwordHash')"
    );
  }
  return bcrypt.compare(candidate, this.passwordHash);
};

module.exports = mongoose.model("User", userSchema);
