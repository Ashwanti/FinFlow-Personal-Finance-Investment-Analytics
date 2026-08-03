const { z } = require("zod");

const { ACCOUNT_TYPES } = require("../constants");
const { MAX_MINOR } = require("../utils/money");

const name = z.string().trim().min(1, "Name is required").max(60);

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR")
  .transform((code) => code.toUpperCase());

// Signed and allowed to be zero: a credit card can legitimately open in the red.
const balanceMinor = z
  .number()
  .int("Opening balance must be a whole number of minor units")
  .min(-MAX_MINOR)
  .max(MAX_MINOR);

const createAccountSchema = z.object({
  name,
  type: z.enum(Object.values(ACCOUNT_TYPES)),
  currency: currency.optional(),
  openingBalanceMinor: balanceMinor.optional(),
});

const updateAccountSchema = z
  .object({
    name: name.optional(),
    type: z.enum(Object.values(ACCOUNT_TYPES)).optional(),
    currency: currency.optional(),
    openingBalanceMinor: balanceMinor.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

const listAccountsSchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

module.exports = { createAccountSchema, updateAccountSchema, listAccountsSchema };
