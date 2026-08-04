const { TRADE_TYPES } = require("../constants");
const Holding = require("../models/holding.model");
const Trade = require("../models/trade.model");
const { valueMinor, fromScaled, formatScaled, unitPriceMinor } = require("../utils/quantity");
const { xirr } = require("../utils/xirr");
const fx = require("./fx.service");
const holdingService = require("./holding.service");
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
  const [positions, rates] = await Promise.all([
    loadPositions(user, options),
    fx.loadRates(user._id, user.baseCurrency),
  ]);

  const open = positions.filter((position) => position.quantityScaled > 0);

  // Positions are reported in their own currency; totals are only meaningful
  // once converted, and an unconvertible one is excluded rather than added in
  // as though the currencies matched.
  const unconverted = [];
  const toBase = (amountMinor, position) => {
    if (amountMinor === null) return null;
    const converted = fx.convertMinor(amountMinor, position.currency, user.baseCurrency, rates);
    if (converted === null) unconverted.push({ currency: position.currency, amountMinor });
    return converted;
  };

  const totals = positions.reduce(
    (acc, position) => {
      const cost = toBase(position.costBasisMinor, position);
      const realized = toBase(position.realizedPnlMinor, position);
      const fees = toBase(position.feesMinor, position);

      acc.costBasisMinor += cost ?? 0;
      acc.realizedPnlMinor += realized ?? 0;
      acc.feesMinor += fees ?? 0;

      if (position.isPriced) {
        const market = toBase(position.marketValueMinor, position);
        const unrealized = toBase(position.unrealizedPnlMinor, position);
        acc.marketValueMinor += market ?? 0;
        acc.unrealizedPnlMinor += unrealized ?? 0;
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
  const byAssetClass = new Map();
  let pricedValueMinor = 0;

  for (const position of open) {
    if (!position.isPriced) continue;

    const market = fx.convertMinor(
      position.marketValueMinor,
      position.currency,
      user.baseCurrency,
      rates
    );
    if (market === null) continue;

    const cost =
      fx.convertMinor(position.costBasisMinor, position.currency, user.baseCurrency, rates) ?? 0;

    const entry = byAssetClass.get(position.assetClass) ?? {
      assetClass: position.assetClass,
      marketValueMinor: 0,
      costBasisMinor: 0,
      positions: 0,
    };
    entry.marketValueMinor += market;
    entry.costBasisMinor += cost;
    entry.positions += 1;
    byAssetClass.set(position.assetClass, entry);

    pricedValueMinor += market;
  }

  return {
    currency: user.baseCurrency,
    ...totals,
    unconverted: fx.mergeUnconverted(unconverted),
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
    unconverted: summary.unconverted,
  };
}

/**
 * What the portfolio was worth at each of the given moments.
 *
 * Positions are replayed exactly from trades, so quantity and cost at any past
 * date are known precisely. Price is the last snapshot recorded on or before
 * that date; where none exists — anything before the instrument was first
 * priced — the position is carried at cost and the point says so.
 *
 * Carrying at cost is the honest fallback. It is not what the holding was
 * worth, but it is what is knowable, and it does not fabricate a gain the way
 * applying today's price backwards would.
 *
 * @param {Date[]} moments ascending
 * @returns {Promise<{valueMinor:number, costMinor:number, basis:string}[]>}
 */
async function valuationHistory(user, moments) {
  if (moments.length === 0) return [];

  const holdings = await Holding.find({ user: user._id });
  if (holdings.length === 0) {
    return moments.map(() => ({ valueMinor: 0, costMinor: 0, basis: "NONE" }));
  }

  const [trades, snapshots, rates] = await Promise.all([
    Trade.find({ user: user._id }).sort({ date: 1, createdAt: 1 }),
    priceService.loadSnapshots(holdings, moments[0]),
    fx.loadRates(user._id, user.baseCurrency),
  ]);

  const tradesByHolding = new Map();
  for (const trade of trades) {
    const id = String(trade.holding);
    if (!tradesByHolding.has(id)) tradesByHolding.set(id, []);
    tradesByHolding.get(id).push(trade);
  }

  // Latest snapshot at or before `moment`; the lists are ascending so this
  // walks forward rather than re-scanning.
  const priceAt = (series, moment) => {
    if (!series) return null;
    let found = null;
    for (const point of series) {
      if (point.date > moment) break;
      found = point.priceMinor;
    }
    return found;
  };

  return moments.map((moment) => {
    let totalValueMinor = 0;
    let totalCostMinor = 0;
    let priced = 0;
    let atCost = 0;

    for (const holding of holdings) {
      const holdingTrades = tradesByHolding.get(String(holding._id)) ?? [];
      const position = holdingService.positionAt(holdingTrades, moment);
      if (position.quantityScaled <= 0) continue;

      const price = priceAt(snapshots.get(priceService.snapshotKey(holding)), moment);
      const nativeValueMinor =
        price === null ? position.costMinor : valueMinor(price, position.quantityScaled);

      if (price === null) atCost += 1;
      else priced += 1;

      const converted = fx.convertMinor(
        nativeValueMinor,
        holding.currency,
        user.baseCurrency,
        rates
      );
      const convertedCost = fx.convertMinor(
        position.costMinor,
        holding.currency,
        user.baseCurrency,
        rates
      );

      if (converted !== null) totalValueMinor += converted;
      if (convertedCost !== null) totalCostMinor += convertedCost;
    }

    let basis = "NONE";
    if (priced > 0 && atCost > 0) basis = "MIXED";
    else if (priced > 0) basis = "MARKET";
    else if (atCost > 0) basis = "COST";

    return { valueMinor: totalValueMinor, costMinor: totalCostMinor, basis };
  });
}

async function refreshPrices(user) {
  const holdings = await Holding.find({ user: user._id, isArchived: false });
  return priceService.refreshAll(holdings);
}

module.exports = {
  portfolio,
  performance,
  marketValue,
  valuationHistory,
  refreshPrices,
  loadPositions,
};
