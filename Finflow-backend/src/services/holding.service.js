const { ACCOUNT_TYPES, TRADE_TYPES } = require("../constants");
const Account = require("../models/account.model");
const Holding = require("../models/holding.model");
const Trade = require("../models/trade.model");
const ApiError = require("../utils/ApiError");
const { valueMinor, unitPriceMinor, proportionalMinor } = require("../utils/quantity");

/**
 * Rebuilds a holding's position by replaying every trade in order.
 *
 * Replay rather than incremental updates: FIFO makes an edit or delete in the
 * middle of the history change which lots later sales consumed, so unwinding
 * one trade in place means re-deriving everything after it anyway. Replaying
 * is O(trades) on a list that is small for a personal portfolio, and it cannot
 * drift — every call produces the same answer from the same trades.
 */
async function rebuild(holdingId, session = null) {
  const holding = await Holding.findById(holdingId).session(session);
  if (!holding) throw ApiError.notFound("Holding not found");

  const trades = await Trade.find({ holding: holding._id })
    .sort({ date: 1, createdAt: 1 })
    .session(session);

  const lots = [];
  let realizedPnlMinor = 0;
  let feesMinor = 0;

  for (const trade of trades) {
    feesMinor += trade.feesMinor;

    if (trade.type === TRADE_TYPES.BUY) {
      const gross = valueMinor(trade.pricePerUnitMinor, trade.quantityScaled);
      // Fees are folded into the lot's cost, so the position only shows a
      // profit once it has covered what the trade actually cost.
      const total = gross + trade.feesMinor;

      lots.push({
        trade: trade._id,
        quantityScaled: trade.quantityScaled,
        costMinor: total,
        unitCostMinor: unitPriceMinor(total, trade.quantityScaled),
        date: trade.date,
      });

      trade.costBasisSoldMinor = null;
      trade.realizedPnlMinor = null;
    } else {
      let remaining = trade.quantityScaled;
      let costBasisSoldMinor = 0;

      // FIFO: the oldest units go first.
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const taken = Math.min(remaining, lot.quantityScaled);

        // Split the lot's stored total rather than multiplying a rounded unit
        // cost, so consuming a whole lot costs exactly what it cost to buy.
        const takenCostMinor = proportionalMinor(lot.costMinor, taken, lot.quantityScaled);

        costBasisSoldMinor += takenCostMinor;
        lot.costMinor -= takenCostMinor;
        lot.quantityScaled -= taken;
        remaining -= taken;

        if (lot.quantityScaled <= 0) {
          lots.shift();
        } else {
          lot.unitCostMinor = unitPriceMinor(lot.costMinor, lot.quantityScaled);
        }
      }

      // Selling more than was ever bought is rejected at write time; if it
      // still happens (imported data, a deleted buy), the untraceable part is
      // treated as zero-cost rather than silently dropped.
      const proceedsMinor =
        valueMinor(trade.pricePerUnitMinor, trade.quantityScaled) - trade.feesMinor;

      trade.costBasisSoldMinor = costBasisSoldMinor;
      trade.realizedPnlMinor = proceedsMinor - costBasisSoldMinor;
      realizedPnlMinor += trade.realizedPnlMinor;
    }

    await trade.save({ session });
  }

  holding.openLots = lots;
  holding.quantityScaled = lots.reduce((sum, lot) => sum + lot.quantityScaled, 0);
  holding.costBasisMinor = lots.reduce((sum, lot) => sum + lot.costMinor, 0);
  holding.realizedPnlMinor = realizedPnlMinor;
  holding.feesMinor = feesMinor;

  await holding.save({ session });
  return holding;
}

async function getOwned(userId, holdingId, { session = null } = {}) {
  const holding = await Holding.findOne({ _id: holdingId, user: userId }).session(session);
  if (!holding) throw ApiError.notFound("Holding not found");
  return holding;
}

async function assertInvestmentAccount(userId, accountId) {
  const account = await Account.findOne({ _id: accountId, user: userId });
  if (!account) throw ApiError.notFound("Account not found");

  if (account.type !== ACCOUNT_TYPES.INVESTMENT) {
    throw ApiError.badRequest(
      `"${account.name}" is a ${account.type} account — holdings belong in an INVESTMENT account`
    );
  }
  if (account.isArchived) {
    throw ApiError.badRequest(`Account "${account.name}" is archived`);
  }
  return account;
}

async function list(userId, { includeArchived = false, accountId, assetClass } = {}) {
  const filter = { user: userId };
  if (!includeArchived) filter.isArchived = false;
  if (accountId) filter.account = accountId;
  if (assetClass) filter.assetClass = assetClass;

  const holdings = await Holding.find(filter)
    .populate("account", "name type currency")
    .sort({ symbol: 1 });

  return holdings;
}

async function create(userId, input) {
  const account = await assertInvestmentAccount(userId, input.accountId);

  const symbol = input.symbol.toUpperCase();
  const exists = await Holding.exists({ user: userId, account: account._id, symbol });
  if (exists) {
    throw ApiError.conflict(`A holding for ${symbol} already exists in "${account.name}"`);
  }

  const holding = await Holding.create({
    user: userId,
    account: account._id,
    symbol,
    name: input.name ?? "",
    assetClass: input.assetClass,
    currency: input.currency || account.currency,
    priceProvider: input.priceProvider,
    providerSymbol: input.providerSymbol ?? "",
    manualPriceMinor: input.manualPriceMinor ?? null,
    notes: input.notes ?? "",
  });

  await holding.populate("account", "name type currency");
  return holding;
}

async function update(userId, holdingId, updates) {
  const holding = await getOwned(userId, holdingId);

  // The currency decides how every existing lot's cost is read, so changing it
  // under trades would reinterpret history rather than correct it.
  if (updates.currency && updates.currency !== holding.currency) {
    const traded = await Trade.exists({ holding: holding._id });
    if (traded) {
      throw ApiError.conflict("Cannot change the currency of a holding that has trades");
    }
  }

  if (updates.accountId && String(updates.accountId) !== String(holding.account)) {
    const account = await assertInvestmentAccount(userId, updates.accountId);
    holding.account = account._id;
  }

  for (const field of [
    "name",
    "assetClass",
    "currency",
    "priceProvider",
    "providerSymbol",
    "manualPriceMinor",
    "notes",
    "isArchived",
  ]) {
    if (updates[field] !== undefined) holding[field] = updates[field];
  }

  await holding.save();
  await holding.populate("account", "name type currency");
  return holding;
}

/**
 * A holding with trades is archived rather than deleted: its realised gains
 * are part of the portfolio's history and deleting it would rewrite past
 * performance.
 */
async function remove(userId, holdingId) {
  const holding = await getOwned(userId, holdingId);
  const traded = await Trade.exists({ holding: holding._id });

  if (traded) {
    holding.isArchived = true;
    await holding.save();
    return { deleted: false, archived: true };
  }

  await holding.deleteOne();
  return { deleted: true, archived: false };
}

module.exports = {
  rebuild,
  getOwned,
  assertInvestmentAccount,
  list,
  create,
  update,
  remove,
};
