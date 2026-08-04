const holdingService = require("../services/holding.service");
const portfolioService = require("../services/portfolio.service");
const tradeService = require("../services/trade.service");
const { toMinor } = require("../utils/money");
const { toScaled } = require("../utils/quantity");

/**
 * Normalises the human-friendly spellings into the canonical scaled integers
 * before anything downstream sees them, so services only ever deal in
 * integers — the same contract the transaction controller enforces for money.
 */
function normalise(body) {
  const input = { ...body };

  if (input.quantity !== undefined) {
    input.quantityScaled = toScaled(input.quantity);
    delete input.quantity;
  }
  if (input.price !== undefined) {
    input.pricePerUnitMinor = toMinor(input.price);
    delete input.price;
  }
  if (input.fees !== undefined) {
    input.feesMinor = toMinor(input.fees);
    delete input.fees;
  }
  if (input.manualPrice !== undefined) {
    input.manualPriceMinor = toMinor(input.manualPrice);
    delete input.manualPrice;
  }

  return input;
}

// --- holdings ---

async function listHoldings(req, res) {
  const holdings = await holdingService.list(req.user._id, req.validated.query);
  res.status(200).json({
    success: true,
    data: { holdings: holdings.map((holding) => holding.toJSON()) },
  });
}

async function createHolding(req, res) {
  const holding = await holdingService.create(req.user._id, normalise(req.validated.body));
  res.status(201).json({ success: true, data: { holding: holding.toJSON() } });
}

async function getHolding(req, res) {
  const holding = await holdingService.getOwned(req.user._id, req.validated.params.id);
  await holding.populate("account", "name type currency");
  res.status(200).json({ success: true, data: { holding: holding.toJSON() } });
}

async function updateHolding(req, res) {
  const holding = await holdingService.update(
    req.user._id,
    req.validated.params.id,
    normalise(req.validated.body)
  );
  res.status(200).json({ success: true, data: { holding: holding.toJSON() } });
}

async function removeHolding(req, res) {
  const result = await holdingService.remove(req.user._id, req.validated.params.id);
  res.status(200).json({
    success: true,
    message: result.archived
      ? "Holding archived because it has trade history"
      : "Holding deleted",
    data: result,
  });
}

async function rebuildHolding(req, res) {
  const holding = await tradeService.rebuildHolding(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, data: { holding } });
}

// --- trades ---

async function listTrades(req, res) {
  const result = await tradeService.list(req.user._id, req.validated.query);
  res.status(200).json({ success: true, data: result });
}

async function createTrade(req, res) {
  const trade = await tradeService.create(req.user._id, normalise(req.validated.body));
  res.status(201).json({ success: true, data: { trade } });
}

async function getTrade(req, res) {
  const trade = await tradeService.get(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, data: { trade } });
}

async function updateTrade(req, res) {
  const trade = await tradeService.update(
    req.user._id,
    req.validated.params.id,
    normalise(req.validated.body)
  );
  res.status(200).json({ success: true, data: { trade } });
}

async function removeTrade(req, res) {
  const result = await tradeService.remove(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, message: "Trade deleted", data: result });
}

// --- analytics ---

async function portfolio(req, res) {
  const data = await portfolioService.portfolio(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function performance(req, res) {
  const data = await portfolioService.performance(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function refreshPrices(req, res) {
  const data = await portfolioService.refreshPrices(req.user);
  res.status(200).json({ success: true, data });
}

module.exports = {
  listHoldings,
  createHolding,
  getHolding,
  updateHolding,
  removeHolding,
  rebuildHolding,
  listTrades,
  createTrade,
  getTrade,
  updateTrade,
  removeTrade,
  portfolio,
  performance,
  refreshPrices,
};
