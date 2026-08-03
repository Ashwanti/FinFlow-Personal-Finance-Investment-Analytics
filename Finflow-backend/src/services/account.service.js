const Account = require("../models/account.model");
const Transaction = require("../models/transaction.model");
const ApiError = require("../utils/ApiError");

async function list(userId, { includeArchived = false } = {}) {
  const filter = { user: userId };
  if (!includeArchived) filter.isArchived = false;

  const accounts = await Account.find(filter).sort({ createdAt: 1 });
  return accounts.map((account) => account.toJSON());
}

async function getOwned(userId, accountId, { session = null } = {}) {
  const account = await Account.findOne({ _id: accountId, user: userId }).session(session);
  if (!account) throw ApiError.notFound("Account not found");
  return account;
}

async function get(userId, accountId) {
  const account = await getOwned(userId, accountId);
  return account.toJSON();
}

async function create(user, input) {
  const exists = await Account.exists({ user: user._id, name: input.name });
  if (exists) {
    throw ApiError.conflict(`An account named "${input.name}" already exists`);
  }

  const openingBalanceMinor = input.openingBalanceMinor ?? 0;

  const account = await Account.create({
    ...input,
    user: user._id,
    // Accounts inherit the user's base currency unless told otherwise.
    currency: input.currency || user.baseCurrency,
    openingBalanceMinor,
    balanceMinor: openingBalanceMinor,
  });

  return account.toJSON();
}

async function update(userId, accountId, updates) {
  const account = await getOwned(userId, accountId);

  // Existing rows are denominated in the old currency; reinterpreting them would
  // silently rewrite history.
  if (updates.currency && updates.currency !== account.currency) {
    const used = await Transaction.exists({ user: userId, account: accountId });
    if (used) {
      throw ApiError.conflict("Cannot change the currency of an account that has transactions");
    }
  }

  // Editing the opening balance has to move the running balance by the same
  // delta, otherwise the two drift apart.
  if (
    updates.openingBalanceMinor !== undefined &&
    updates.openingBalanceMinor !== account.openingBalanceMinor
  ) {
    account.balanceMinor += updates.openingBalanceMinor - account.openingBalanceMinor;
  }

  Object.assign(account, updates);
  await account.save();
  return account.toJSON();
}

/**
 * Deleting an account with history would orphan its transactions, so those are
 * archived instead. Only an untouched account is truly removed.
 */
async function remove(userId, accountId) {
  const account = await getOwned(userId, accountId);
  const used = await Transaction.exists({
    user: userId,
    $or: [{ account: accountId }, { counterAccount: accountId }],
  });

  if (used) {
    account.isArchived = true;
    await account.save();
    return { deleted: false, archived: true };
  }

  await account.deleteOne();
  return { deleted: true, archived: false };
}

/**
 * Rebuild `balanceMinor` from the opening balance plus every transaction.
 *
 * The incremental balance is the source of truth in normal operation; this is
 * the repair path for when it drifts — a crash mid-write on a standalone
 * MongoDB, or data edited outside the API.
 */
async function recalculateBalance(userId, accountId) {
  const account = await getOwned(userId, accountId);

  const [totals] = await Transaction.aggregate([
    { $match: { user: account.user, account: account._id } },
    {
      $group: {
        _id: null,
        movementMinor: {
          $sum: {
            $switch: {
              branches: [
                { case: { $eq: ["$type", "INCOME"] }, then: "$amountMinor" },
                { case: { $eq: ["$type", "EXPENSE"] }, then: { $multiply: ["$amountMinor", -1] } },
                {
                  case: { $eq: ["$transferDirection", "IN"] },
                  then: "$amountMinor",
                },
              ],
              default: { $multiply: ["$amountMinor", -1] },
            },
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const previousMinor = account.balanceMinor;
  account.balanceMinor = account.openingBalanceMinor + (totals?.movementMinor ?? 0);
  await account.save();

  return {
    account: account.toJSON(),
    previousMinor,
    correctedMinor: account.balanceMinor,
    driftMinor: account.balanceMinor - previousMinor,
    transactionsCounted: totals?.count ?? 0,
  };
}

module.exports = { list, get, getOwned, create, update, remove, recalculateBalance };
