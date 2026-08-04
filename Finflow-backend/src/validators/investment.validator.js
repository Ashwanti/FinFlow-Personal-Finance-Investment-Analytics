const { z } = require("zod");

const { ASSET_CLASSES, PRICE_PROVIDERS, TRADE_TYPES } = require("../constants");
const { MAX_QUANTITY_SCALED } = require("../utils/quantity");
const { MAX_MINOR } = require("../utils/money");
const { objectId, dateInput, pagination } = require("./common.validator");

const symbol = z.string().trim().min(1, "Symbol is required").max(32);
const assetClass = z.enum(Object.values(ASSET_CLASSES));
const priceProvider = z.enum(Object.values(PRICE_PROVIDERS));

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR")
  .transform((code) => code.toUpperCase());

// Fractional by nature — 0.00431 BTC is a real position — so this is the one
// place a decimal is the natural input. It is scaled to an integer immediately.
const quantity = z
  .number({ message: "Quantity must be a number" })
  .positive("Quantity must be greater than zero")
  .max(MAX_QUANTITY_SCALED / 1e8, "Quantity is too large");

const quantityScaled = z
  .number()
  .int("Scaled quantity must be a whole number")
  .positive()
  .max(MAX_QUANTITY_SCALED);

const priceMajor = z.number().nonnegative("Price cannot be negative").max(MAX_MINOR / 100);
const priceMinorInput = z.number().int().nonnegative().max(MAX_MINOR);

const feesMajor = z.number().nonnegative().max(MAX_MINOR / 100);
const feesMinorInput = z.number().int().nonnegative().max(MAX_MINOR);

const notes = z.string().trim().max(1000);

/** Exactly one spelling of a required pair, mirroring the money validators. */
const requireOne = (data, ctx, majorKey, minorKey, { optional = false } = {}) => {
  const hasMajor = data[majorKey] !== undefined;
  const hasMinor = data[minorKey] !== undefined;

  if (hasMajor && hasMinor) {
    ctx.addIssue({
      code: "custom",
      path: [majorKey],
      message: `Provide either '${majorKey}' or '${minorKey}', not both`,
    });
  } else if (!hasMajor && !hasMinor && !optional) {
    ctx.addIssue({
      code: "custom",
      path: [majorKey],
      message: `Provide '${majorKey}' or '${minorKey}'`,
    });
  }
};

const createHoldingSchema = z
  .object({
    accountId: objectId,
    symbol,
    name: z.string().trim().max(120).optional(),
    assetClass: assetClass.default(ASSET_CLASSES.EQUITY),
    currency: currency.optional(),
    priceProvider: priceProvider.default(PRICE_PROVIDERS.MANUAL),
    providerSymbol: z.string().trim().max(64).optional(),
    manualPrice: priceMajor.optional(),
    manualPriceMinor: priceMinorInput.optional(),
    notes: notes.optional(),
  })
  .superRefine((data, ctx) => {
    requireOne(data, ctx, "manualPrice", "manualPriceMinor", { optional: true });

    // A vendor lookup keyed on the wrong identifier fails silently forever, so
    // the identifier is required up front rather than discovered at sync time.
    if (data.priceProvider && data.priceProvider !== PRICE_PROVIDERS.MANUAL && !data.providerSymbol) {
      ctx.addIssue({
        code: "custom",
        path: ["providerSymbol"],
        message: `The '${data.priceProvider}' provider needs a providerSymbol (its own id for this instrument, e.g. "bitcoin")`,
      });
    }
  });

const updateHoldingSchema = z
  .object({
    accountId: objectId.optional(),
    name: z.string().trim().max(120).optional(),
    assetClass: assetClass.optional(),
    currency: currency.optional(),
    priceProvider: priceProvider.optional(),
    providerSymbol: z.string().trim().max(64).optional(),
    manualPrice: priceMajor.optional(),
    manualPriceMinor: priceMinorInput.optional(),
    notes: notes.optional(),
    isArchived: z.boolean().optional(),
  })
  .superRefine((data, ctx) => requireOne(data, ctx, "manualPrice", "manualPriceMinor", { optional: true }))
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

const listHoldingsSchema = z.object({
  accountId: objectId.optional(),
  assetClass: assetClass.optional(),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const createTradeSchema = z
  .object({
    holdingId: objectId,
    type: z.enum(Object.values(TRADE_TYPES)),
    quantity: quantity.optional(),
    quantityScaled: quantityScaled.optional(),
    price: priceMajor.optional(),
    pricePerUnitMinor: priceMinorInput.optional(),
    fees: feesMajor.optional(),
    feesMinor: feesMinorInput.optional(),
    date: dateInput,
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    requireOne(data, ctx, "quantity", "quantityScaled");
    requireOne(data, ctx, "price", "pricePerUnitMinor");
    requireOne(data, ctx, "fees", "feesMinor", { optional: true });
  });

const updateTradeSchema = z
  .object({
    type: z.enum(Object.values(TRADE_TYPES)).optional(),
    quantity: quantity.optional(),
    quantityScaled: quantityScaled.optional(),
    price: priceMajor.optional(),
    pricePerUnitMinor: priceMinorInput.optional(),
    fees: feesMajor.optional(),
    feesMinor: feesMinorInput.optional(),
    date: dateInput.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    requireOne(data, ctx, "quantity", "quantityScaled", { optional: true });
    requireOne(data, ctx, "price", "pricePerUnitMinor", { optional: true });
    requireOne(data, ctx, "fees", "feesMinor", { optional: true });
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

const listTradesSchema = z.object({
  holdingId: objectId.optional(),
  type: z.enum(Object.values(TRADE_TYPES)).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  ...pagination,
});

const portfolioSchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Bypasses the price cache. Deliberately opt-in, so a dashboard refresh
  // cannot stampede a rate-limited vendor.
  force: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

module.exports = {
  createHoldingSchema,
  updateHoldingSchema,
  listHoldingsSchema,
  createTradeSchema,
  updateTradeSchema,
  listTradesSchema,
  portfolioSchema,
};
