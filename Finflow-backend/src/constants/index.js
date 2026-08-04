const TRANSACTION_TYPES = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
  TRANSFER: "TRANSFER",
};

/**
 * Transfers move money between accounts you already own, so they are neither
 * income nor expense. Every spending aggregate must filter to these two types
 * only — counting a transfer makes the dashboard claim you earned and spent
 * money that never entered or left your net worth.
 */
const SPENDABLE_TYPES = [TRANSACTION_TYPES.INCOME, TRANSACTION_TYPES.EXPENSE];

const TRANSFER_DIRECTIONS = {
  OUT: "OUT",
  IN: "IN",
};

const CATEGORY_KINDS = {
  INCOME: "INCOME",
  EXPENSE: "EXPENSE",
};

const ACCOUNT_TYPES = {
  BANK: "BANK",
  CASH: "CASH",
  WALLET: "WALLET",
  CREDIT_CARD: "CREDIT_CARD",
  INVESTMENT: "INVESTMENT",
};

const INTERVALS = {
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
};

/** Budget periods, named for users but mapped onto $dateTrunc units. */
const BUDGET_PERIODS = {
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY",
};

const BUDGET_PERIOD_UNITS = {
  WEEKLY: INTERVALS.WEEK,
  MONTHLY: INTERVALS.MONTH,
  YEARLY: INTERVALS.YEAR,
};

const BUDGET_STATUS = {
  OK: "OK",
  WARNING: "WARNING",
  OVER: "OVER",
};

// Share of the cap at which a budget starts warning.
const BUDGET_WARNING_THRESHOLD = 0.8;

const ASSET_CLASSES = {
  EQUITY: "EQUITY",
  MUTUAL_FUND: "MUTUAL_FUND",
  ETF: "ETF",
  BOND: "BOND",
  CRYPTO: "CRYPTO",
  OTHER: "OTHER",
};

const TRADE_TYPES = {
  BUY: "BUY",
  SELL: "SELL",
};

/**
 * Where a holding's current price comes from.
 *
 * `manual` is the default and needs no network: the user states the price.
 * Everything else is a vendor adapter that can fail, rate-limit or go stale,
 * which is why price data lives in a cache with an explicit asOf rather than
 * being fetched inline on a page load.
 */
const PRICE_PROVIDERS = {
  MANUAL: "manual",
  COINGECKO: "coingecko",
};

/** Seeded on registration so a new account is usable immediately. */
const DEFAULT_CATEGORIES = [
  { name: "Salary", kind: CATEGORY_KINDS.INCOME, icon: "💼", color: "#16a34a" },
  { name: "Freelance", kind: CATEGORY_KINDS.INCOME, icon: "🧾", color: "#0ea5e9" },
  { name: "Interest", kind: CATEGORY_KINDS.INCOME, icon: "🏦", color: "#14b8a6" },
  { name: "Refunds", kind: CATEGORY_KINDS.INCOME, icon: "↩️", color: "#84cc16" },
  { name: "Rent", kind: CATEGORY_KINDS.EXPENSE, icon: "🏠", color: "#f97316" },
  { name: "Groceries", kind: CATEGORY_KINDS.EXPENSE, icon: "🛒", color: "#22c55e" },
  { name: "Food & Dining", kind: CATEGORY_KINDS.EXPENSE, icon: "🍽️", color: "#ef4444" },
  { name: "Transport", kind: CATEGORY_KINDS.EXPENSE, icon: "🚗", color: "#3b82f6" },
  { name: "Utilities", kind: CATEGORY_KINDS.EXPENSE, icon: "💡", color: "#eab308" },
  { name: "Health", kind: CATEGORY_KINDS.EXPENSE, icon: "🩺", color: "#ec4899" },
  { name: "Entertainment", kind: CATEGORY_KINDS.EXPENSE, icon: "🎬", color: "#a855f7" },
  { name: "Shopping", kind: CATEGORY_KINDS.EXPENSE, icon: "🛍️", color: "#f43f5e" },
  { name: "Education", kind: CATEGORY_KINDS.EXPENSE, icon: "📚", color: "#6366f1" },
  { name: "Other", kind: CATEGORY_KINDS.EXPENSE, icon: "•", color: "#64748b" },
];

module.exports = {
  TRANSACTION_TYPES,
  SPENDABLE_TYPES,
  TRANSFER_DIRECTIONS,
  CATEGORY_KINDS,
  ACCOUNT_TYPES,
  INTERVALS,
  DEFAULT_CATEGORIES,
  BUDGET_PERIODS,
  BUDGET_PERIOD_UNITS,
  BUDGET_STATUS,
  BUDGET_WARNING_THRESHOLD,
  ASSET_CLASSES,
  TRADE_TYPES,
  PRICE_PROVIDERS,
};
