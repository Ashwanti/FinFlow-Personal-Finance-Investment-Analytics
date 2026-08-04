const { SPENDABLE_TYPES, TRANSACTION_TYPES } = require("../constants");
const Account = require("../models/account.model");
const Transaction = require("../models/transaction.model");
const { addMonths, enumeratePeriods, nextPeriod, startOfMonth } = require("../utils/dates");
const fx = require("./fx.service");

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
  const rates = await fx.loadRates(user._id, user.baseCurrency);

  const [rows, transfers] = await Promise.all([
    Transaction.aggregate([
      { $match: spendableMatch(user._id, from, to) },
      {
        // Grouped by currency as well as type: summing ₹ and $ as plain
        // numbers would produce a total that is simply wrong.
        $group: {
          _id: { type: "$type", currency: "$currency" },
          totalMinor: { $sum: "$amountMinor" },
          count: { $sum: 1 },
        },
      },
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
      {
        $group: {
          _id: "$currency",
          totalMinor: { $sum: "$amountMinor" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const bucketsFor = (type) =>
    rows
      .filter((row) => row._id.type === type)
      .map((row) => ({ currency: row._id.currency, amountMinor: row.totalMinor }));

  const income = fx.sumConverted(bucketsFor(TRANSACTION_TYPES.INCOME), user.baseCurrency, rates);
  const expense = fx.sumConverted(bucketsFor(TRANSACTION_TYPES.EXPENSE), user.baseCurrency, rates);
  const transferTotal = fx.sumConverted(
    transfers.map((row) => ({ currency: row._id, amountMinor: row.totalMinor })),
    user.baseCurrency,
    rates
  );

  const incomeMinor = income.totalMinor;
  const expenseMinor = expense.totalMinor;
  const netMinor = incomeMinor - expenseMinor;

  const days = Math.max(1, Math.ceil((to - from) / 86400000));

  return {
    range: { from, to },
    currency: user.baseCurrency,
    incomeMinor,
    expenseMinor,
    netMinor,
    // Amounts in currencies with no known rate, left out rather than guessed.
    unconverted: fx.mergeUnconverted(income.unconverted, expense.unconverted),
    // Share of income kept. Undefined rather than 0 when nothing was earned —
    // "0% saved" would be a claim the data does not support.
    savingsRatePct: incomeMinor > 0 ? round((netMinor / incomeMinor) * 100) : null,
    averageDailySpendMinor: Math.round(expenseMinor / days),
    transactionCount: rows.reduce((total, row) => total + row.count, 0),
    // Shown for transparency; excluded from every figure above.
    transferVolumeMinor: transferTotal.totalMinor,
    transferCount: transfers.reduce((total, row) => total + row.count, 0),
  };
}

/** Where the money went, biggest first, with each slice's share of the total. */
async function spendingByCategory(user, query = {}) {
  const { from, to } = resolveRange(user, query);
  const type = query.type ?? TRANSACTION_TYPES.EXPENSE;

  const rates = await fx.loadRates(user._id, user.baseCurrency);

  const rows = await Transaction.aggregate([
    { $match: { ...spendableMatch(user._id, from, to), type } },
    {
      $group: {
        _id: { category: "$category", currency: "$currency" },
        totalMinor: { $sum: "$amountMinor" },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id.category",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
  ]);

  // Fold the per-currency rows back into one entry per category.
  const byCategory = new Map();
  const unconverted = [];

  for (const row of rows) {
    const id = String(row._id.category ?? "uncategorised");
    const entry = byCategory.get(id) ?? {
      categoryId: row._id.category,
      name: row.category?.name ?? "Uncategorised",
      icon: row.category?.icon ?? "•",
      color: row.category?.color ?? "#64748b",
      totalMinor: 0,
      count: 0,
    };

    const converted = fx.convertMinor(row.totalMinor, row._id.currency, user.baseCurrency, rates);
    if (converted === null) {
      unconverted.push({ currency: row._id.currency, amountMinor: row.totalMinor });
    } else {
      entry.totalMinor += converted;
    }

    entry.count += row.count;
    byCategory.set(id, entry);
  }

  const categories = [...byCategory.values()].sort((a, b) => b.totalMinor - a.totalMinor);
  const totalMinor = categories.reduce((sum, entry) => sum + entry.totalMinor, 0);

  return {
    range: { from, to },
    type,
    currency: user.baseCurrency,
    totalMinor,
    unconverted: fx.mergeUnconverted(unconverted),
    categories: categories.map((entry) => ({
      ...entry,
      sharePct: totalMinor > 0 ? round((entry.totalMinor / totalMinor) * 100) : 0,
    })),
  };
}

/** Income vs expense over time, with empty periods filled in. */
async function cashflow(user, query = {}) {
  const interval = query.interval ?? "month";
  const now = new Date();
  const from = query.from ?? addMonths(startOfMonth(now, user.timezone), -5, user.timezone);
  const to = query.to ?? now;

  const rates = await fx.loadRates(user._id, user.baseCurrency);

  const rows = await Transaction.aggregate([
    { $match: spendableMatch(user._id, from, to) },
    {
      $group: {
        _id: {
          period: { $dateTrunc: { date: "$date", unit: interval, timezone: user.timezone } },
          type: "$type",
          currency: "$currency",
        },
        totalMinor: { $sum: "$amountMinor" },
      },
    },
  ]);

  const byPeriod = new Map();
  const unconverted = [];

  for (const row of rows) {
    const key = row._id.period.toISOString();
    const entry = byPeriod.get(key) ?? { incomeMinor: 0, expenseMinor: 0 };

    const converted = fx.convertMinor(row.totalMinor, row._id.currency, user.baseCurrency, rates);
    if (converted === null) {
      unconverted.push({ currency: row._id.currency, amountMinor: row.totalMinor });
    } else if (row._id.type === TRANSACTION_TYPES.INCOME) {
      entry.incomeMinor += converted;
    } else {
      entry.expenseMinor += converted;
    }

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

  return {
    range: { from, to },
    interval,
    currency: user.baseCurrency,
    unconverted: fx.mergeUnconverted(unconverted),
    series,
  };
}

/**
 * Assets minus liabilities, right now.
 *
 * Two components: cash across every account, and the market value of open
 * investment positions. They are kept separate because an INVESTMENT account's
 * balance is uninvested cash sitting at the broker — adding the positions to it
 * would be right, but hiding that they are different things would make a
 * negative cash balance in a margin account impossible to spot.
 */
async function netWorth(user) {
  const accounts = await Account.find({ user: user._id, isArchived: false }).sort({ type: 1, name: 1 });

  const rates = await fx.loadRates(user._id, user.baseCurrency);

  const byType = new Map();
  const unconverted = [];
  let totalMinor = 0;
  let assetsMinor = 0;
  let liabilitiesMinor = 0;

  for (const account of accounts) {
    const balanceMinor = fx.convertMinor(
      account.balanceMinor,
      account.currency,
      user.baseCurrency,
      rates
    );

    const entry = byType.get(account.type) ?? { type: account.type, totalMinor: 0, accounts: [] };
    entry.accounts.push({
      id: account._id,
      name: account.name,
      balanceMinor: account.balanceMinor,
      currency: account.currency,
      // Null when no rate is known, so a client can mark the row rather than
      // showing a converted figure that was never computed.
      convertedMinor: balanceMinor,
    });

    if (balanceMinor === null) {
      unconverted.push({ currency: account.currency, amountMinor: account.balanceMinor });
    } else {
      entry.totalMinor += balanceMinor;
      totalMinor += balanceMinor;
      if (balanceMinor >= 0) assetsMinor += balanceMinor;
      else liabilitiesMinor += balanceMinor;
    }

    byType.set(account.type, entry);
  }

  // Required lazily: portfolio.service reaches back into price lookups, and a
  // top-level require would make the two modules circular.
  const { marketValue } = require("./portfolio.service");
  const investments = await marketValue(user);

  return {
    currency: user.baseCurrency,
    totalMinor: totalMinor + investments.marketValueMinor,
    cashMinor: totalMinor,
    investmentsMinor: investments.marketValueMinor,
    assetsMinor: assetsMinor + investments.marketValueMinor,
    liabilitiesMinor,
    accountCount: accounts.length,
    positionCount: investments.positionCount,
    // Positions with no usable price are excluded from the total rather than
    // valued at zero, so the caller can tell "worth nothing" from "unknown".
    unpricedPositionCount: investments.unpricedCount,
    // Same principle for currencies: balances with no known rate are left out
    // and listed, never converted at a guessed rate.
    unconverted: fx.mergeUnconverted(unconverted, investments.unconverted),
    // Rates old enough to distrust. The total is still computed with them —
    // a stale rate beats none — but the caller is told which ones they are.
    staleRates: await fx.staleRates(user._id),
    byType: [...byType.values()].sort((a, b) => b.totalMinor - a.totalMinor),
  };
}

/**
 * Net worth at the end of each of the last N months.
 *
 * Historical balances are not stored, so this walks backwards from today's
 * balance and unwinds each month's movements. Transfers net to zero across the
 * pair of accounts, so they correctly leave the total untouched.
 *
 * Investments are included, valued from recorded price snapshots. Positions at
 * any past date are replayed exactly from trades; the price is the last
 * snapshot on or before that date. Where no snapshot exists — anything before
 * the instrument was first priced — the position is carried at cost, and the
 * point reports `investmentBasis: "COST"` so a rise is never mistaken for a
 * gain that was actually just the first valuation arriving.
 */
async function netWorthTrend(user, { months = 12 } = {}) {
  const { valuationHistory } = require("./portfolio.service");

  const [accounts, rates] = await Promise.all([
    Account.find({ user: user._id, isArchived: false }).select("_id balanceMinor currency"),
    fx.loadRates(user._id, user.baseCurrency),
  ]);

  const accountIds = accounts.map((account) => account._id);
  const currentCashMinor = accounts.reduce(
    (sum, account) =>
      sum + (fx.convertMinor(account.balanceMinor, account.currency, user.baseCurrency, rates) ?? 0),
    0
  );

  const now = new Date();
  const from = addMonths(startOfMonth(now, user.timezone), -(months - 1), user.timezone);

  const rows = await Transaction.aggregate([
    { $match: { user: user._id, account: { $in: accountIds }, date: { $gte: from } } },
    {
      $group: {
        _id: {
          period: { $dateTrunc: { date: "$date", unit: "month", timezone: user.timezone } },
          currency: "$currency",
        },
        movementMinor: { $sum: SIGNED_MOVEMENT },
      },
    },
  ]);

  const movementByPeriod = new Map();
  for (const row of rows) {
    const key = row._id.period.toISOString();
    const converted =
      fx.convertMinor(row.movementMinor, row._id.currency, user.baseCurrency, rates) ?? 0;
    movementByPeriod.set(key, (movementByPeriod.get(key) ?? 0) + converted);
  }

  const periods = enumeratePeriods(from, now, "month", user.timezone);

  // Cash is unwound backwards from today's balance: each month's movements are
  // removed to reach the balance at the end of the month before.
  const cashByPeriod = [];
  let runningCash = currentCashMinor;
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    cashByPeriod.unshift(runningCash);
    runningCash -= movementByPeriod.get(periods[i].toISOString()) ?? 0;
  }

  // Investments are valued at the end of each period — the same instant the
  // cash figure refers to. The final period is valued as of now.
  const moments = periods.map((period, index) =>
    index === periods.length - 1 ? now : nextPeriod(period, "month", user.timezone)
  );
  const valuations = await valuationHistory(user, moments);

  const series = periods.map((period, index) => {
    const cashMinor = cashByPeriod[index];
    const investment = valuations[index] ?? { valueMinor: 0, costMinor: 0, basis: "NONE" };

    return {
      period,
      cashMinor,
      investmentsMinor: investment.valueMinor,
      investmentCostMinor: investment.costMinor,
      // MARKET, COST, MIXED or NONE — how the investment side was valued.
      investmentBasis: investment.basis,
      netWorthMinor: cashMinor + investment.valueMinor,
    };
  });

  const currentMinor = series.at(-1)?.netWorthMinor ?? currentCashMinor;
  const openingMinor = series[0]?.netWorthMinor ?? 0;

  return {
    currency: user.baseCurrency,
    currentMinor,
    currentCashMinor,
    changeMinor: currentMinor - openingMinor,
    changePct:
      openingMinor !== 0
        ? round(((currentMinor - openingMinor) / Math.abs(openingMinor)) * 100)
        : null,
    includesInvestments: true,
    series,
  };
}

/** Everything a dashboard needs, in one round trip. */
async function dashboard(user, query = {}) {
  const budgetService = require("./budget.service");
  const portfolioService = require("./portfolio.service");

  const [monthSummary, categories, flow, worth, budgets, investments, recent] = await Promise.all([
    summary(user, query),
    spendingByCategory(user, query),
    cashflow(user, { interval: "month" }),
    netWorth(user),
    budgetService.overview(user),
    portfolioService.portfolio(user),
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
    budgets: {
      budgetedMinor: budgets.budgetedMinor,
      spentMinor: budgets.spentMinor,
      remainingMinor: budgets.remainingMinor,
      usedPct: budgets.usedPct,
      overBudgetCount: budgets.overBudgetCount,
      atRiskCount: budgets.atRiskCount,
      alerts: budgets.alerts,
    },
    investments: {
      marketValueMinor: investments.marketValueMinor,
      costBasisMinor: investments.costBasisMinor,
      unrealizedPnlMinor: investments.unrealizedPnlMinor,
      unrealizedPnlPct: investments.unrealizedPnlPct,
      positionCount: investments.positionCount,
      unpricedCount: investments.unpricedCount,
      allocation: investments.allocation,
    },
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
