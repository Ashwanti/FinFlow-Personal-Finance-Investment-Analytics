const mongoose = require("mongoose");

/**
 * One row per issued refresh token (i.e. one per active session/device).
 *
 * We store a SHA-256 hash rather than the token itself, so a database leak
 * does not hand an attacker a set of usable sessions. The raw token is high
 * entropy random bytes, so a fast hash is sufficient here — bcrypt is only
 * needed for low-entropy secrets like user-chosen passwords.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // Set when the token is rotated away or explicitly logged out.
    revokedAt: {
      type: Date,
      default: null,
    },
    // Points at the token that replaced this one, so a rotation chain can be
    // followed when investigating a suspected theft.
    replacedByHash: {
      type: String,
      default: null,
    },
    userAgent: String,
    ip: String,
  },
  { timestamps: true }
);

// MongoDB sweeps expired documents automatically, so dead sessions do not
// accumulate forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
