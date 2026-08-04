const { TRADE_TYPES } = require("../constants");
const Holding = require("../models/holding.model");
const Trade = require("../models/trade.model");
const { valueMinor, fromScaled, formatScaled, unitPriceMinor } = require("../utils/quantity");
const { xirr } = require("../utils/xirr");
const priceService = require("./price");

/**
 * Valuation and performance for the whole portfolio.
 *
 * Everything here is derived: positions come from replayed trades, prices from
 * the cache, and returns from both. Nothing is stored, so a corrected trade
 * immediately corrects every number below it.
 */

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const pct = (part, whole) => (whole !== 0 ? round((part / Math.abs(whole)) * 100) : null);

/** One holding, valued at its current price. */
function valuePosition(holding, quote) {
  const priced = quote.priceMinor !== null;
  const marketValueMinor = priced ? valueMinor(quote.priceMinor, holding.quantityScaled) : null;
  const unrealizedPnlMinor = priced ? marketValueMinor - holding.costBasisMinor : null;

  return {
    id: holding._id,
    symbol: holding.symbol,
    name: holding.name,
    assetClass: holding.assetClass,
    currency: holding.currency,
    account: holding.account?.name ? { id: holding.account._id, name: holding.account.name } : holding.account,

    quantity: fromScaled(holding.quantityScaled),
    quantityDisplay: formatScaled(holding.quantityScaled),
    quantityScaled: holding.quantityScaled,

    // What the remaining units cost, fees included.
    costBasisMinor: holding.costBasisMinor,
    averageCostMinor: unitPriceMinor(holding.costBasisMinor, holding.quantityScaled),

    price: {
      priceMinor: quote.priceMinor,
      asOf: quote.asOf,
      source: quote.source,
      // Surfaced rather than hidden: a valuation from a failed vendor call is
      // still useful, but only if the caller knows how old it is.
      stale: quote.stale,
      error: quote.error,
    },

    marketValueMinor,
    unrealizedPnlMinor,
    unrealizedPnlPct: priced ? pct(unrealizedPnlMinor, holding.costBasisMinor) : null,
    realizedPnlMinor: holding.realizedPnlMinor,
    totalPnlMinor: priced
      ? unrealizedPnlMinor + holding.realizedPnlMinor
      : holding.realizedPnlMinor,
    feesMinor: holding.feesMinor,
    isPriced: priced,
  };
}

async function loadPositions(user, { includeArchived = false, force = false } = {}) {
  const filter = { user: user._id };
  if (!includeArchived) filter.isArchived = false;

  const holdings = await Holding.find(filter)
    .populate("account", "name type currency")
    .sort({ symbol: 1 });

  const quotes = await priceService.getQuotes(holdings, { force });

  return holdings.map((holding) => valuePosition(holding, quotes.get(String(holding._id))));
}

/** Positions plus totals and allocation. */
async function portfolio(user, options = {}) {
  const positions = await loadPositions(user, options);

  const open = positions.filter((position) => position.quantityScaled > 0);

  const totals = positions.reduce(
    (acc, position) => {
      acc.costBasisMinor += position.costBasisMinor;
      acc.realizedPnlMinor += position.realizedPnlMinor;
      acc.feesMinor += position.feesMinor;
      if (position.isPriced) {
        acc.marketValueMinor += position.marketValueMinor;
        acc.unrealizedPnlMinor += position.unrealizedPnlMinor;
      } else if (position.quantityScaled > 0) {
        acc.unpricedCount += 1;
      }
      return acc;
    },
    {
      marketValueMinor: 0,
      costBasisMinor: 0,
      unrealizedPnlMinor: 0,
      realizedPnlMinor: 0,
      feesMinor: 0,
      unpricedCount: 0,
    }
  );

  // Allocation is computed over priced positions only. Including an unvalued
  // holding at zero would quietly overstate every other slice's share.
  const pricedValueMinor = open
    .filter((position) => position.isPriced)
    .reduce((sum, position) => sum + position.marketValueMinor, 0);

  const byAssetClass = new Map();
  for (const position of open) {
    if (!position.isPriced) continue;
    const entry = byAssetClass.get(position.assetClass) ?? {
      assetClass: position.assetClass,
      marketValueMinor: 0,
      costBasisMinor: 0,
      positions: 0,
    };
    entry.marketValueMinor += position.marketValueMinor;
    entry.costBasisMinor += position.costBasisMinor;
    entry.positions += 1;
    byAssetClass.set(position.assetClass, entry);
  }

  return {
    currency: user.baseCurrency,
    ...totals,
    totalPnlMinor: totals.unrealizedPnlMinor + totals.realizedPnlMinor,
    unrealizedPnlPct: pct(totals.unrealizedPnlMinor, totals.costBasisMinor),
    positionCount: open.length,
    closedCount: positions.length - open.length,
    allocation: [...byAssetClass.values()]
      .map((entry) => ({
        ...entry,
        sharePct: pricedValueMinor > 0 ? round((entry.marketValueMinor / pricedValueMinor) * 100) : 0,
      }))
      .sort((a, b) => b.marketValueMinor - a.marketValueMinor),
    positions,
  };
}

/**
 * Money-weighted return over the whole portfolio.
 *
 * Cashflows are the trades themselves — a buy is money out, a sell money in —
 * plus today's market value as a final inflow, because an unrealised gain is
 * still a gain. Without that closing flow, XIRR would describe a portfolio you
 * had already liquidated.
 */
async function performance(user, options = {}) {
  const summary = await portfolio(user, options);

  const trades = await Trade.find({ user: user._id }).sort({ date: 1, createdAt: 1 });

  const flows = trades.map((trade) => ({
    date: trade.date,
    amount:
      trade.type === TRADE_TYPES.BUY
        ? -(valueMinor(trade.pricePerUnitMinor, trade.quantityScaled) + trade.feesMinor)
        : valueMinor(trade.pricePerUnitMinor, trade.quantityScaled) - trade.feesMinor,
  }));

  // Only priced positions can contribute a closing value; if some holding has
  // no price the return is computed on what can be valued, and the count of
  // what could not is reported alongside.
  if (summary.marketValueMinor !== 0) {
    flows.push({ date: new Date(), amount: summary.marketValueMinor });
  }

  const investedMinor = trades
    .filter((trade) => trade.type === TRADE_TYPES.BUY)
    .reduce(
      (sum, trade) => sum + valueMinor(trade.pricePerUnitMinor, trade.quantityScaled) + trade.feesMinor,
      0
    );

  const withdrawnMinor = trades
    .filter((trade) => trade.type === TRADE_TYPES.SELL)
    .reduce(
      (sum, trade) => sum + valueMinor(trade.pricePerUnitMinor, trade.quantityScaled) - trade.feesMinor,
      0
    );

  const rate = xirr(flows);

  return {
    currency: user.baseCurrency,
    marketValueMinor: summary.marketValueMinor,
    costBasisMinor: summary.costBasisMinor,
    investedMinor,
    withdrawnMinor,
    unrealizedPnlMinor: summary.unrealizedPnlMinor,
    realizedPnlMinor: summary.realizedPnlMinor,
    totalPnlMinor: summary.totalPnlMinor,
    feesMinor: summary.feesMinor,

    // Simple return: what you have now versus what you put in.
    absoluteReturnPct: pct(
      summary.marketValueMinor + withdrawnMinor - investedMinor,
      investedMinor
    ),
    // Annualised and time-aware. Null when the flows cannot produce one —
    // a single buy today, or no trades at all — rather than a fabricated 0%.
    xirrPct: rate === null ? null : round(rate * 100),

    tradeCount: trades.length,
    unpricedCount: summary.unpricedCount,
    allocation: summary.allocation,
  };
}

/** Market value of all open positions — used by net worth. */
async function marketValue(user) {
  const summary = await portfolio(user);
  return {
    marketValueMinor: summary.marketValueMinor,
    unpricedCount: summary.unpricedCount,
    positionCount: summary.positionCount,
  };
}

async function refreshPrices(user) {
  const holdings = await Holding.find({ user: user._id, isArchived: false });
  return priceService.refreshAll(holdings);
}

module.exports = { portfolio, performance, marketValue, refreshPrices, loadPositions };
