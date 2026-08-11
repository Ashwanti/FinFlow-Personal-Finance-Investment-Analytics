const { z } = require("zod");

const { BUDGET_PERIODS } = require("../constants");
const {
  objectIdFor,
  dateInput,
  amountMinor,
  amountMajor,
  requireOneAmount,
} = require("./common.validator");

const period = z.enum(Object.values(BUDGET_PERIODS));
const notes = z.string().trim().max(500);

const categoryId = objectIdFor("a category to budget");

const createBudgetSchema = z
  .object({
    categoryId,
    amount: amountMajor.optional(),
    amountMinor: amountMinor.optional(),
    period: period.default(BUDGET_PERIODS.MONTHLY),
    startDate: dateInput.optional(),
    rollover: z.boolean().optional(),
    notes: notes.optional(),
  })
  .superRefine(requireOneAmount);

const updateBudgetSchema = z
  .object({
    categoryId: categoryId.optional(),
    amount: amountMajor.optional(),
    amountMinor: amountMinor.optional(),
    period: period.optional(),
    startDate: dateInput.optional(),
    rollover: z.boolean().optional(),
    notes: notes.optional(),
    isArchived: z.boolean().optional(),
  })
  .superRefine((data, ctx) => requireOneAmount(data, ctx, { optional: true }))
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

// `at` evaluates a budget as of another date — useful for reviewing a period
// that has already closed.
const listBudgetsSchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  at: dateInput.optional(),
});

const budgetAtSchema = z.object({ at: dateInput.optional() });

module.exports = {
  createBudgetSchema,
  updateBudgetSchema,
  listBudgetsSchema,
  budgetAtSchema,
};
