const { z } = require("zod");

const { RATE_SCALE } = require("../models/exchangeRate.model");
const { dateInput } = require("./common.validator");

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR")
  .transform((code) => code.toUpperCase());

// Accepted as a decimal because that is how rates are quoted, and scaled to an
// integer immediately — a rate multiplies every figure it touches, so drift in
// it propagates everywhere.
const rate = z
  .number({ message: "Rate must be a number" })
  .positive("Rate must be greater than zero")
  .max(1e6, "Rate is implausibly large");

const rateScaled = z
  .number()
  .int("Scaled rate must be a whole number")
  .positive()
  .max(1e6 * RATE_SCALE);

const upsertRateSchema = z
  .object({
    base: currency,
    quote: currency,
    rate: rate.optional(),
    rateScaled: rateScaled.optional(),
    asOf: dateInput.optional(),
    source: z.string().trim().max(32).optional(),
  })
  .superRefine((data, ctx) => {
    const hasRate = data.rate !== undefined;
    const hasScaled = data.rateScaled !== undefined;

    if (hasRate && hasScaled) {
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "Provide either 'rate' or 'rateScaled', not both",
      });
    } else if (!hasRate && !hasScaled) {
      ctx.addIssue({
        code: "custom",
        path: ["rate"],
        message: "Provide a 'rate' (e.g. 83.5) or a 'rateScaled'",
      });
    }

    if (data.base === data.quote) {
      ctx.addIssue({
        code: "custom",
        path: ["quote"],
        message: "A currency's rate against itself is always 1",
      });
    }
  });

const ratePairSchema = z.object({ base: currency, quote: currency });

module.exports = { upsertRateSchema, ratePairSchema };
