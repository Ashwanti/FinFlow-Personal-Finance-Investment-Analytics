const { SPENDABLE_TYPES, TRANSACTION_TYPES } = require("../constants");
const Account = require("../models/account.model");
const Transaction = require("../models/transaction.model");
const { addMonths, enumeratePeriods, startOfMonth } = require("../utils/dates");

/**
 * Phase 3 analytics — pure aggregation over transactions already in the
 * database. No new storage, no external service.
 *
 * The single rule every function here obeys: **transfers are excluded.**
 * Moving ₹10,000 from savings to checking is neither income nor expense, and
 * counting it inflates both sides while leaving net worth unchanged — which
 * makes savings rate, category shares and cashflow all wrong at once.
 * `SPENDABLE_TYPES` is the filter that enforces it.
 */

const spendableMatch = (userId, from, to) => ({
  user: userId,
  type: { $in: SPENDABLE_TYPES },
  date: { $gte: from, $lte: to },
});

/** Signed movement of an account balance, for aggregations. */
const SIGNED_MOVEMENT = {
  $switch: {
    branches: [
      { case: { $eq: ["$type", TRANSACTION_TYPES.INCOME] }, then: "$amountMinor" },
      { case: { $eq: ["$type", TRANSACTION_TYPES.EXPENSE] }, then: { $multiply: ["$amountMinor", -1] } },
      { case: { $eq: ["$transferDirection", "IN"] }, then: "$amountMinor" },
    ],
    default: { $multiply: ["$amountMinor", -1] },
  },
};

/** Defaults to the current month in the user's timezone. */
function resolveRange(user, query = {}) {
  const now = new Date();
  const from = query.from ?? startOfMonth(now, user.timezone);
  const to = query.to ?? now;
  return { from, to };
}

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

// ---------------------------------------------------------------------------

/**
 * Headline numbers: earned, spent, kept.
 *
 * `transferVolumeMinor` is reported separately and deliberately excluded from
 * every other figure, so the number is visible without polluting the totals.
 */
async function summary(user, query = {}) {
  const { from, to } = resolveRange(user, query);

  const [rows, transfers] = await Promise.all([
    Transaction.aggregate([
      { $match: spendableMatch(user._id, from, to) },
      { $group: { _id: "$type", totalMinor: { $sum: "$amountMinor" }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      {
        $match: {
          user: user._id,
          type: TRANSACTION_TYPES.TRANSFER,
          transferDirection: "OUT",
          date: { $gte: from, $lte: to },
        },
      },
      { $group: { _id: null, totalMinor: { $sum: "$amountMinor" }, count: { $sum: 1 } } },
    ]),
  ]);

  const find = (type) => rows.find((row) => row._id === type);
  const incomeMinor = find(TRANSACTION_TYPES.INCOME)?.totalMinor ?? 0;
  const expenseMinor = find(TRANSACTION_TYPES.EXPENSE)?.totalMinor ?? 0;
  const netMinor = incomeMinor - expenseMinor;

  const days = Math.max(1, Math.ceil((to - from) / 86400000));

  return {
    range: { from, to },
    currency: user.baseCurrency,
    incomeMinor,
    expenseMinor,
    netMinor,
    // Share of income kept. Undefined rather than 0 when nothing was earned —
    // "0% saved" would be a claim the data does not support.
    savingsRatePct: incomeMinor > 0 ? round((netMinor / incomeMinor) * 100) : null,
    averageDailySpendMinor: Math.round(expenseMinor / days),
    transactionCount: rows.reduce((total, row) => total + row.count, 0),
    // Shown for transparency; excluded from every figure above.
    transferVolumeMinor: transfers[0]?.totalMinor ?? 0,
    transferCount: transfers[0]?.count ?? 0,
  };
}

/** Where the money went, biggest first, with each slice's share of the total. */
async function spendingByCategory(user, query = {}) {
  const { from, to } = resolveRange(user, query);
  const type = query.type ?? TRANSACTION_TYPES.EXPENSE;

  const rows = await Transaction.aggregate([
    { $match: { ...spendableMatch(user._id, from, to), type } },
    {
      $group: {
        _id: "$category",
        totalMinor: { $sum: "$amountMinor" },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalMinor: -1 } },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
  ]);

  const totalMinor = rows.reduce((sum, row) => sum + row.totalMinor, 0);

  return {
    range: { from, to },
    type,
    currency: user.baseCurrency,
    totalMinor,
    categories: rows.map((row) => ({
      categoryId: row._id,
      name: row.category?.name ?? "Uncategorised",
      icon: row.category?.icon ?? "•",
      color: row.category?.color ?? "#64748b",
      totalMinor: row.totalMinor,
      count: row.count,
      sharePct: totalMinor > 0 ? round((row.totalMinor / totalMinor) * 100) : 0,
    })),
  };
}

/** Income vs expense over time, with empty periods filled in. */
async function cashflow(user, query = {}) {
  const interval = query.interval ?? "month";
  const now = new Date();
  const from = query.from ?? addMonths(startOfMonth(now, user.timezone), -5, user.timezone);
  const to = query.to ?? now;

  const rows = await Transaction.aggregate([
    { $match: spendableMatch(user._id, from, to) },
    {
      $group: {
        _id: {
          period: { $dateTrunc: { date: "$date", unit: interval, timezone: user.timezone } },
          type: "$type",
        },
        totalMinor: { $sum: "$amountMinor" },
      },
    },
  ]);

  const byPeriod = new Map();
  for (const row of rows) {
    const key = row._id.period.toISOString();
    const entry = byPeriod.get(key) ?? { incomeMinor: 0, expenseMinor: 0 };
    if (row._id.type === TRANSACTION_TYPES.INCOME) entry.incomeMinor = row.totalMinor;
    else entry.expenseMinor = row.totalMinor;
    byPeriod.set(key, entry);
  }

  // A month with no activity is a real data point — dropping it would make a
  // gap look like a spike when the chart connects across it.
  const series = enumeratePeriods(from, to, interval, user.timezone).map((period) => {
    const entry = byPeriod.get(period.toISOString()) ?? { incomeMinor: 0, expenseMinor: 0 };
    return {
      period,
      incomeMinor: entry.incomeMinor,
      expenseMinor: entry.expenseMinor,
      netMinor: entry.incomeMinor - entry.expenseMinor,
    };
  });

  return { range: { from, to }, interval, currency: user.baseCurrency, series };
}

/** Assets minus liabilities, right now, broken down by account type. */
async function netWorth(user) {
  const accounts = await Account.find({ user: user._id, isArchived: false }).sort({ type: 1, name: 1 });

  const byType = new Map();
  let totalMinor = 0;
  let assetsMinor = 0;
  let liabilitiesMinor = 0;

  for (const account of accounts) {
    const entry = byType.get(account.type) ?? { type: account.type, totalMinor: 0, accounts: [] };
    entry.totalMinor += account.balanceMinor;
    entry.accounts.push({
      id: account._id,
      name: account.name,
      balanceMinor: account.balanceMinor,
      currency: account.currency,
    });
    byType.set(account.type, entry);

    totalMinor += account.balanceMinor;
    if (account.balanceMinor >= 0) assetsMinor += account.balanceMinor;
    else liabilitiesMinor += account.balanceMinor;
  }

  return {
    currency: user.baseCurrency,
    totalMinor,
    assetsMinor,
    liabilitiesMinor,
    accountCount: accounts.length,
    byType: [...byType.values()].sort((a, b) => b.totalMinor - a.totalMinor),
  };
}

/**
 * Net worth at the end of each of the last N months.
 *
 * Historical balances are not stored, so this walks backwards from today's
 * balance and unwinds each month's movements. Transfers net to zero across the
 * pair of accounts, so they correctly leave the total untouched.
 */
async function netWorthTrend(user, { months = 12 } = {}) {
  const accounts = await Account.find({ user: user._id, isArchived: false }).select(
    "_id balanceMinor"
  );

  const currentMinor = accounts.reduce((sum, account) => sum + account.balanceMinor, 0);
  const accountIds = accounts.map((account) => account._id);

  const now = new Date();
  const from = addMonths(startOfMonth(now, user.timezone), -(months - 1), user.timezone);

  const rows = await Transaction.aggregate([
    { $match: { user: user._id, account: { $in: accountIds }, date: { $gte: from } } },
    {
      $group: {
        _id: { $dateTrunc: { date: "$date", unit: "month", timezone: user.timezone } },
        movementMinor: { $sum: SIGNED_MOVEMENT },
      },
    },
  ]);

  const movementByPeriod = new Map(rows.map((row) => [row._id.toISOString(), row.movementMinor]));
  const periods = enumeratePeriods(from, now, "month", user.timezone);

  const series = [];
  let running = currentMinor;
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    series.unshift({ period: periods[i], netWorthMinor: running });
    running -= movementByPeriod.get(periods[i].toISOString()) ?? 0;
  }

  const openingMinor = series[0]?.netWorthMinor ?? 0;

  return {
    currency: user.baseCurrency,
    currentMinor,
    changeMinor: currentMinor - openingMinor,
    changePct: openingMinor !== 0 ? round(((currentMinor - openingMinor) / Math.abs(openingMinor)) * 100) : null,
    series,
  };
}

/** Everything a dashboard needs, in one round trip. */
async function dashboard(user, query = {}) {
  const [monthSummary, categories, flow, worth, recent] = await Promise.all([
    summary(user, query),
    spendingByCategory(user, query),
    cashflow(user, { interval: "month" }),
    netWorth(user),
    Transaction.find({ user: user._id })
      .populate([
        { path: "account", select: "name type" },
        { path: "category", select: "name icon color" },
      ])
      .sort({ date: -1, createdAt: -1 })
      .limit(10),
  ]);

  return {
    summary: monthSummary,
    topCategories: categories.categories.slice(0, 5),
    cashflow: flow.series,
    netWorth: worth,
    recentTransactions: recent.map((transaction) => transaction.toJSON()),
  };
}

module.exports = {
  summary,
  spendingByCategory,
  cashflow,
  netWorth,
  netWorthTrend,
  dashboard,
};
