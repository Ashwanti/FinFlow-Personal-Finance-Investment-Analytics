const mongoose = require("mongoose");
const { z } = require("zod");

const { MAX_MINOR } = require("../utils/money");

const objectId = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), { message: "Not a valid id" });

const idParam = z.object({ id: objectId });

/** Accepts an ISO date string or a timestamp, always yields a Date. */
const dateInput = z.coerce.date({ message: "Not a valid date" });

const amountMinor = z
  .number({ message: "Amount must be a number" })
  .int("Amount must be a whole number of minor units (paise/cents)")
  .positive("Amount must be greater than zero")
  .max(MAX_MINOR, "Amount is too large");

/** Major units, e.g. 250.5 meaning ₹250.50. Converted to minor before storage. */
const amountMajor = z
  .number({ message: "Amount must be a number" })
  .positive("Amount must be greater than zero")
  .max(MAX_MINOR / 100, "Amount is too large");

const tags = z.array(z.string().trim().min(1).max(30)).max(20);

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
};

/**
 * Requires exactly one of `amount` (major) or `amountMinor` (minor).
 *
 * Accepting both spellings keeps the API pleasant for a frontend that has a
 * decimal in an input box, while integer minor units stay the canonical form.
 * Allowing both at once would make the winner arbitrary, so it is rejected.
 */
const requireOneAmount = (data, ctx, { optional = false } = {}) => {
  const hasMajor = data.amount !== undefined;
  const hasMinor = data.amountMinor !== undefined;

  if (hasMajor && hasMinor) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Provide either 'amount' or 'amountMinor', not both",
    });
  } else if (!hasMajor && !hasMinor && !optional) {
    ctx.addIssue({
      code: "custom",
      path: ["amount"],
      message: "Provide an 'amount' (e.g. 250.50) or an 'amountMinor' (e.g. 25050)",
    });
  }
};

module.exports = {
  objectId,
  idParam,
  dateInput,
  amountMinor,
  amountMajor,
  tags,
  pagination,
  requireOneAmount,
};
