const { z } = require("zod");

const { TRANSACTION_TYPES } = require("../constants");
const {
  objectId,
  objectIdFor,
  dateInput,
  amountMinor,
  amountMajor,
  tags,
  pagination,
  requireOneAmount,
} = require("./common.validator");

// Transfers have their own endpoint, because one row cannot express a two-sided
// movement and pretending otherwise is how transfer bugs start.
const spendableType = z.enum([TRANSACTION_TYPES.INCOME, TRANSACTION_TYPES.EXPENSE]);

const description = z.string().trim().max(200);
const notes = z.string().trim().max(1000);

const accountId = objectIdFor("an account");
const categoryId = objectIdFor("a category");

const createTransactionSchema = z
  .object({
    type: spendableType,
    accountId,
    categoryId,
    amount: amountMajor.optional(),
    amountMinor: amountMinor.optional(),
    date: dateInput,
    description: description.optional(),
    notes: notes.optional(),
    tags: tags.optional(),
  })
  .superRefine(requireOneAmount);

const updateTransactionSchema = z
  .object({
    type: spendableType.optional(),
    accountId: accountId.optional(),
    categoryId: categoryId.optional(),
    amount: amountMajor.optional(),
    amountMinor: amountMinor.optional(),
    date: dateInput.optional(),
    description: description.optional(),
    notes: notes.optional(),
    tags: tags.optional(),
  })
  .superRefine((data, ctx) => requireOneAmount(data, ctx, { optional: true }))
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

const createTransferSchema = z
  .object({
    fromAccountId: objectIdFor("an account to move money from"),
    toAccountId: objectIdFor("an account to move money to"),
    amount: amountMajor.optional(),
    amountMinor: amountMinor.optional(),
    // Only needed when the two accounts hold different currencies.
    toAmount: amountMajor.optional(),
    toAmountMinor: amountMinor.optional(),
    date: dateInput,
    description: description.optional(),
    notes: notes.optional(),
    tags: tags.optional(),
  })
  .superRefine(requireOneAmount)
  .superRefine((data, ctx) => {
    if (data.toAmount !== undefined && data.toAmountMinor !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["toAmount"],
        message: "Provide either 'toAmount' or 'toAmountMinor', not both",
      });
    }
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    path: ["toAccountId"],
    message: "Source and destination accounts must be different",
  });

const updateTransferSchema = z
  .object({
    amount: amountMajor.optional(),
    amountMinor: amountMinor.optional(),
    toAmount: amountMajor.optional(),
    toAmountMinor: amountMinor.optional(),
    date: dateInput.optional(),
    description: description.optional(),
    notes: notes.optional(),
    tags: tags.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

const listTransactionsSchema = z.object({
  type: z.enum(Object.values(TRANSACTION_TYPES)).optional(),
  accountId: objectId.optional(),
  categoryId: objectId.optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  tags: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined)),
  minAmountMinor: z.coerce.number().int().min(0).optional(),
  maxAmountMinor: z.coerce.number().int().min(0).optional(),
  ...pagination,
});

module.exports = {
  createTransactionSchema,
  updateTransactionSchema,
  createTransferSchema,
  updateTransferSchema,
  listTransactionsSchema,
};
