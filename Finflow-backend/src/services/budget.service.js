const {
  BUDGET_PERIOD_UNITS,
  BUDGET_STATUS,
  BUDGET_WARNING_THRESHOLD,
  CATEGORY_KINDS,
  TRANSACTION_TYPES,
} = require("../constants");
const Budget = require("../models/budget.model");
const Category = require("../models/category.model");
const Transaction = require("../models/transaction.model");
const ApiError = require("../utils/ApiError");
const { enumeratePeriods, periodRange, startOfPeriod } = require("../utils/dates");

/**
 * Budgets are evaluated, never stored as running totals.
 *
 * Spend comes from the same filter the analytics endpoints use — EXPENSE rows
 * only — so a transfer between your own accounts can never consume a budget.
 * Paying a credit card bill is not grocery spending, and a budget that thought
 * otherwise would be useless in exactly the month it mattered.
 */

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function statusFor(spentMinor, availableMinor) {
  if (availableMinor <= 0) return spentMinor > 0 ? BUDGET_STATUS.OVER : BUDGET_STATUS.OK;
  if (spentMinor > availableMinor) return BUDGET_STATUS.OVER;
  if (spentMinor >= availableMinor * BUDGET_WARNING_THRESHOLD) return BUDGET_STATUS.WARNING;
  return BUDGET_STATUS.OK;
}

async function spentBetween(userId, categoryId, from, to) {
  const [row] = await Transaction.aggregate([
    {
      $match: {
        user: userId,
        category: categoryId,
        type: TRANSACTION_TYPES.EXPENSE,
        date: { $gte: from, $lt: to },
      },
    },
    { $group: { _id: null, totalMinor: { $sum: "$amountMinor" }, count: { $sum: 1 } } },
  ]);

  return { spentMinor: row?.totalMinor ?? 0, transactionCount: row?.count ?? 0 };
}

/**
 * Unspent budget carried forward from every completed period since startDate.
 *
 * Walks the finished periods rather than only the previous one, so a budget
 * left alone for three months carries all three.
 */
async function carriedForward(userId, budget, currentStart, timeZone) {
  if (!budget.rollover) return 0;

  const unit = BUDGET_PERIOD_UNITS[budget.period];
  const firstStart = startOfPeriod(budget.startDate, unit, timeZone);
  if (firstStart >= currentStart) return 0;

  // Every period boundary from the budget's start up to (not including) the
  // one being evaluated.
  const periods = enumeratePeriods(firstStart, currentStart, unit, timeZone).filter(
    (start) => start < currentStart
  );
  if (periods.length === 0) return 0;

  const [row] = await Transaction.aggregate([
    {
      $match: {
        user: userId,
        category: budget.category._id ?? budget.category,
        type: TRANSACTION_TYPES.EXPENSE,
        date: { $gte: firstStart, $lt: currentStart },
      },
    },
    { $group: { _id: null, totalMinor: { $sum: "$amountMinor" } } },
  ]);

  const budgetedMinor = budget.amountMinor * periods.length;
  return budgetedMinor - (row?.totalMinor ?? 0);
}

/** A budget plus everything derived from it for one period. */
async function evaluate(user, budget, reference = new Date()) {
  const unit = BUDGET_PERIOD_UNITS[budget.period];
  const { start, end } = periodRange(reference, unit, user.timezone);

  const categoryId = budget.category._id ?? budget.category;
  const [{ spentMinor, transactionCount }, rolloverMinor] = await Promise.all([
    spentBetween(user._id, categoryId, start, end),
    carriedForward(user._id, budget, start, user.timezone),
  ]);

  const availableMinor = budget.amountMinor + rolloverMinor;
  const remainingMinor = availableMinor - spentMinor;

  // Days are counted in whole days of the period, so "per day" advice does not
  // swing with the hour the request happens to be made.
  const totalDays = Math.max(1, Math.round((end - start) / 86400000));
  const elapsedMs = Math.min(Math.max(reference - start, 0), end - start);
  const daysRemaining = Math.max(0, Math.ceil((end - reference) / 86400000));

  return {
    id: budget._id,
    category: budget.category?.name
      ? {
          id: categoryId,
          name: budget.category.name,
          icon: budget.category.icon,
          color: budget.category.color,
        }
      : { id: categoryId },
    period: budget.period,
    rollover: budget.rollover,
    notes: budget.notes,
    isArchived: budget.isArchived,
    range: { from: start, to: end },
    currency: user.baseCurrency,

    amountMinor: budget.amountMinor,
    rolloverMinor,
    availableMinor,
    spentMinor,
    remainingMinor,
    transactionCount,

    usedPct: availableMinor > 0 ? round((spentMinor / availableMinor) * 100) : null,
    status: statusFor(spentMinor, availableMinor),

    daysRemaining,
    // What you can spend per remaining day and stay inside the cap.
    dailyAllowanceMinor: daysRemaining > 0 ? Math.floor(Math.max(remainingMinor, 0) / daysRemaining) : 0,
    /**
     * Where the spend would land if the rest of the period matched the pace so
     * far. Null before any time has elapsed, since dividing by zero elapsed
     * time would project an infinite overspend from a single early purchase.
     */
    projectedSpendMinor:
      elapsedMs > 0 ? Math.round(spentMinor * ((end - start) / elapsedMs)) : null,
    daysTotal: totalDays,
  };
}

// ---------------------------------------------------------------------------

async function assertExpenseCategory(userId, categoryId) {
  const category = await Category.findOne({ _id: categoryId, user: userId });
  if (!category) throw ApiError.notFound("Category not found");

  // Budgeting income makes no sense: a cap on money coming in is a target, not
  // a limit, and every number below assumes spend.
  if (category.kind !== CATEGORY_KINDS.EXPENSE) {
    throw ApiError.badRequest(
      `"${category.name}" is an income category — budgets apply to expense categories only`
    );
  }
  return category;
}

async function list(user, { includeArchived = false, at } = {}) {
  const filter = { user: user._id };
  if (!includeArchived) filter.isArchived = false;

  const budgets = await Budget.find(filter).populate("category", "name icon color kind");
  const reference = at ?? new Date();

  const evaluated = await Promise.all(budgets.map((budget) => evaluate(user, budget, reference)));

  // Most urgent first: over budget, then closest to the cap.
  return evaluated.sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0));
}

async function getOwned(userId, budgetId) {
  const budget = await Budget.findOne({ _id: budgetId, user: userId }).populate(
    "category",
    "name icon color kind"
  );
  if (!budget) throw ApiError.notFound("Budget not found");
  return budget;
}

async function get(user, budgetId, { at } = {}) {
  const budget = await getOwned(user._id, budgetId);
  return evaluate(user, budget, at ?? new Date());
}

async function create(user, input) {
  await assertExpenseCategory(user._id, input.categoryId);

  const exists = await Budget.exists({
    user: user._id,
    category: input.categoryId,
    period: input.period,
  });
  if (exists) {
    throw ApiError.conflict(
      `A ${input.period.toLowerCase()} budget already exists for that category`
    );
  }

  const budget = await Budget.create({
    user: user._id,
    category: input.categoryId,
    amountMinor: input.amountMinor,
    period: input.period,
    // Default to the start of the current period, so a budget created midway
    // through a month governs that whole month rather than a stub of it.
    startDate:
      input.startDate ??
      periodRange(new Date(), BUDGET_PERIOD_UNITS[input.period], user.timezone).start,
    rollover: input.rollover ?? false,
    notes: input.notes ?? "",
  });

  await budget.populate("category", "name icon color kind");
  return evaluate(user, budget);
}

async function update(user, budgetId, updates) {
  const budget = await getOwned(user._id, budgetId);

  if (updates.categoryId && String(updates.categoryId) !== String(budget.category._id)) {
    await assertExpenseCategory(user._id, updates.categoryId);
    budget.category = updates.categoryId;
  }

  for (const field of ["amountMinor", "period", "startDate", "rollover", "notes", "isArchived"]) {
    if (updates[field] !== undefined) budget[field] = updates[field];
  }

  await budget.save();
  await budget.populate("category", "name icon color kind");
  return evaluate(user, budget);
}

async function remove(userId, budgetId) {
  const budget = await getOwned(userId, budgetId);
  await budget.deleteOne();
  return { deleted: true };
}

/** Portfolio-level view of every budget for the current period. */
async function overview(user, { at } = {}) {
  const budgets = await list(user, { at });

  const totals = budgets.reduce(
    (acc, budget) => {
      acc.budgetedMinor += budget.availableMinor;
      acc.spentMinor += budget.spentMinor;
      return acc;
    },
    { budgetedMinor: 0, spentMinor: 0 }
  );

  const overBudget = budgets.filter((budget) => budget.status === BUDGET_STATUS.OVER);
  const atRisk = budgets.filter((budget) => budget.status === BUDGET_STATUS.WARNING);

  return {
    currency: user.baseCurrency,
    budgetCount: budgets.length,
    budgetedMinor: totals.budgetedMinor,
    spentMinor: totals.spentMinor,
    remainingMinor: totals.budgetedMinor - totals.spentMinor,
    usedPct:
      totals.budgetedMinor > 0 ? round((totals.spentMinor / totals.budgetedMinor) * 100) : null,
    overBudgetCount: overBudget.length,
    atRiskCount: atRisk.length,
    // Only the ones needing attention, so a client can render alerts directly.
    alerts: [...overBudget, ...atRisk].map((budget) => ({
      budgetId: budget.id,
      category: budget.category,
      status: budget.status,
      spentMinor: budget.spentMinor,
      availableMinor: budget.availableMinor,
      overspendMinor: Math.max(0, budget.spentMinor - budget.availableMinor),
      usedPct: budget.usedPct,
    })),
    budgets,
  };
}

module.exports = { list, get, create, update, remove, overview, evaluate };
