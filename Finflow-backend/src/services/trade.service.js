const { TRADE_TYPES } = require("../constants");
const Account = require("../models/account.model");
const Holding = require("../models/holding.model");
const Trade = require("../models/trade.model");
const ApiError = require("../utils/ApiError");
const { toMinorIn } = require("../utils/money");
const { valueMinor, formatScaled } = require("../utils/quantity");
const { withTransaction } = require("../utils/withTransaction");
const holdingService = require("./holding.service");
const priceService = require("./price");

/**
 * Trades move cash and change a position, atomically.
 *
 * The cash side is the part worth being careful about. A BUY debits the broker
 * account by exactly what left the account, and the position gains the same
 * value — so net worth is unchanged by the act of investing, minus fees, which
 * genuinely are gone. That is the same principle as transfers: moving money
 * between things you own is not spending, and a report that says otherwise is
 * wrong in the direction that discourages saving.
 */

const POPULATE = [
  { path: "holding", select: "symbol name assetClass currency account" },
];

/** Signed effect of a trade on the broker account's cash balance. */
function cashDeltaMinor(trade) {
  const gross = valueMinor(trade.pricePerUnitMinor, trade.quantityScaled);
  return trade.type === TRADE_TYPES.BUY
    ? -(gross + trade.feesMinor)
    : gross - trade.feesMinor;
}

const applyCash = (accountId, deltaMinor, session) =>
  Account.updateOne({ _id: accountId }, { $inc: { balanceMinor: deltaMinor } }, { session });

/** Turns the human spellings of price and fees into minor units of `currency`. */
function resolvePrices(input, currency) {
  return {
    pricePerUnitMinor:
      input.pricePerUnitMinor ??
      (input.price === undefined ? undefined : toMinorIn(input.price, currency)),
    feesMinor:
      input.feesMinor ?? (input.fees === undefined ? undefined : toMinorIn(input.fees, currency)),
  };
}

/** Total units currently held, used to reject overselling. */
async function heldQuantity(holdingId, session, excludeTradeId = null) {
  const filter = { holding: holdingId };
  if (excludeTradeId) filter._id = { $ne: excludeTradeId };

  const trades = await Trade.find(filter).session(session);
  return trades.reduce(
    (total, trade) =>
      total + (trade.type === TRADE_TYPES.BUY ? trade.quantityScaled : -trade.quantityScaled),
    0
  );
}

async function assertCanSell(holding, quantityScaled, session, excludeTradeId = null) {
  const held = await heldQuantity(holding._id, session, excludeTradeId);
  if (quantityScaled > held) {
    throw ApiError.badRequest(
      `Cannot sell ${formatScaled(quantityScaled)} ${holding.symbol} — only ${formatScaled(held)} held`
    );
  }
}

async function create(userId, input) {
  const created = await withTransaction(async (session) => {
    const holding = await holdingService.getOwned(userId, input.holdingId, { session });
    if (holding.isArchived) {
      throw ApiError.badRequest(`Holding ${holding.symbol} is archived`);
    }

    if (input.type === TRADE_TYPES.SELL) {
      await assertCanSell(holding, input.quantityScaled, session);
    }

    // Resolved against the holding's currency, which the controller has not
    // loaded — a price of 1200 means ¥1200 in a JPY holding, not ¥120,000.
    const priced = resolvePrices(input, holding.currency);

    const [trade] = await Trade.create(
      [
        {
          user: userId,
          holding: holding._id,
          type: input.type,
          quantityScaled: input.quantityScaled,
          pricePerUnitMinor: priced.pricePerUnitMinor,
          feesMinor: priced.feesMinor ?? 0,
          currency: holding.currency,
          date: input.date,
          notes: input.notes ?? "",
        },
      ],
      { session }
    );

    await applyCash(holding.account, cashDeltaMinor(trade), session);
    await holdingService.rebuild(holding._id, session);

    return { trade, holding };
  });

  // A trade is a price observation: someone paid this on this date. Recording
  // it gives the net worth trend real history without waiting for a vendor.
  if (created.trade.pricePerUnitMinor) {
    await priceService.recordSnapshot(created.holding, {
      priceMinor: created.trade.pricePerUnitMinor,
      currency: created.holding.currency,
      asOf: created.trade.date,
    });
  }

  return (await Trade.findById(created.trade._id).populate(POPULATE)).toJSON();
}

async function update(userId, tradeId, updates) {
  const updated = await withTransaction(async (session) => {
    const trade = await Trade.findOne({ _id: tradeId, user: userId }).session(session);
    if (!trade) throw ApiError.notFound("Trade not found");

    const holding = await holdingService.getOwned(userId, trade.holding, { session });

    // Back the old cash effect out first, so any combination of changed type,
    // quantity, price and fees settles on the right balance.
    await applyCash(holding.account, -cashDeltaMinor(trade), session);

    const priced = resolvePrices(updates, holding.currency);

    for (const field of ["type", "quantityScaled", "date", "notes"]) {
      if (updates[field] !== undefined) trade[field] = updates[field];
    }
    if (priced.pricePerUnitMinor !== undefined) trade.pricePerUnitMinor = priced.pricePerUnitMinor;
    if (priced.feesMinor !== undefined) trade.feesMinor = priced.feesMinor;

    if (trade.type === TRADE_TYPES.SELL) {
      await assertCanSell(holding, trade.quantityScaled, session, trade._id);
    }

    await trade.save({ session });
    await applyCash(holding.account, cashDeltaMinor(trade), session);
    await holdingService.rebuild(holding._id, session);

    return trade;
  });

  return (await Trade.findById(updated._id).populate(POPULATE)).toJSON();
}

async function remove(userId, tradeId) {
  return withTransaction(async (session) => {
    const trade = await Trade.findOne({ _id: tradeId, user: userId }).session(session);
    if (!trade) throw ApiError.notFound("Trade not found");

    const holding = await holdingService.getOwned(userId, trade.holding, { session });

    await applyCash(holding.account, -cashDeltaMinor(trade), session);
    await Trade.deleteOne({ _id: trade._id }, { session });

    // Deleting a BUY can leave later SELLs consuming lots that no longer
    // exist, so the whole position is replayed rather than patched.
    await holdingService.rebuild(holding._id, session);

    return { deleted: 1 };
  });
}

async function list(userId, query) {
  const filter = { user: userId };
  if (query.holdingId) filter.holding = query.holdingId;
  if (query.type) filter.type = query.type;

  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = query.from;
    if (query.to) filter.date.$lte = query.to;
  }

  const { page = 1, limit = 25 } = query;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Trade.find(filter).populate(POPULATE).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
    Trade.countDocuments(filter),
  ]);

  return {
    items: items.map((item) => item.toJSON()),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: skip + items.length < total,
    },
  };
}

async function get(userId, tradeId) {
  const trade = await Trade.findOne({ _id: tradeId, user: userId }).populate(POPULATE);
  if (!trade) throw ApiError.notFound("Trade not found");
  return trade.toJSON();
}

/** Repair path, mirroring account balance recalculation. */
async function rebuildHolding(userId, holdingId) {
  const holding = await holdingService.getOwned(userId, holdingId);
  const rebuilt = await holdingService.rebuild(holding._id);
  await rebuilt.populate("account", "name type currency");
  return rebuilt.toJSON();
}

module.exports = { create, update, remove, list, get, rebuildHolding, cashDeltaMinor };

// Re-exported so the portfolio service can value positions without importing
// the model directly.
module.exports.Holding = Holding;
