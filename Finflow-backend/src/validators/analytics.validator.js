const { z } = require("zod");

const { INTERVALS, TRANSACTION_TYPES } = require("../constants");
const { dateInput } = require("./common.validator");

const rangeSchema = z
  .object({
    from: dateInput.optional(),
    to: dateInput.optional(),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    path: ["from"],
    message: "'from' must be on or before 'to'",
  });

const summarySchema = rangeSchema;

const spendingByCategorySchema = z
  .object({
    from: dateInput.optional(),
    to: dateInput.optional(),
    type: z.enum([TRANSACTION_TYPES.INCOME, TRANSACTION_TYPES.EXPENSE]).optional(),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    path: ["from"],
    message: "'from' must be on or before 'to'",
  });

const cashflowSchema = z
  .object({
    from: dateInput.optional(),
    to: dateInput.optional(),
    interval: z.enum(Object.values(INTERVALS)).default(INTERVALS.MONTH),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    path: ["from"],
    message: "'from' must be on or before 'to'",
  });

const netWorthTrendSchema = z.object({
  months: z.coerce.number().int().min(2).max(60).default(12),
});

module.exports = {
  summarySchema,
  spendingByCategorySchema,
  cashflowSchema,
  netWorthTrendSchema,
};
