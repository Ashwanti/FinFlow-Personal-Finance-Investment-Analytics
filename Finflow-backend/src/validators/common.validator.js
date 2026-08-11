const mongoose = require("mongoose");
const { z } = require("zod");

const { MAX_MINOR } = require("../utils/money");

/**
 * A required object id, reporting *one* problem at a time.
 *
 * The empty case earns its own message. An unfilled `<select>` submits `""`,
 * which is a perfectly good string, so it used to fall straight through to the
 * format test and come back "Not a valid id" — true, and useless to someone who
 * has simply not chosen an account yet. Missing and malformed are different
 * mistakes and deserve different words.
 *
 * The two checks live in one `superRefine` rather than a `min(1)` followed by a
 * `refine`, because Zod runs every check on a field: an empty value would fail
 * both and the form would be handed "Select an account" and "Not a valid id"
 * for the same box, with nothing to say which to show.
 */
const objectIdWith = (missing) =>
  z.string({ message: missing }).trim().superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: "custom", message: missing });
      return;
    }
    if (!mongoose.isValidObjectId(value)) {
      ctx.addIssue({ code: "custom", message: "Not a valid id" });
    }
  });

const objectId = objectIdWith("Required");

/**
 * The same, with the field named — "Select an account" rather than a bare
 * "Required", which is what a form field wants to say.
 */
const objectIdFor = (label) => objectIdWith(`Select ${label}`);

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
  objectIdFor,
  idParam,
  dateInput,
  amountMinor,
  amountMajor,
  tags,
  pagination,
  requireOneAmount,
};
