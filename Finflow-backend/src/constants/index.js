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
};
