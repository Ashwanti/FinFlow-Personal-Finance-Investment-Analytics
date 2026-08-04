const env = require("../config/env");
const { RATE_SCALE } = require("../models/exchangeRate.model");
const fxProviders = require("../services/fx");
const fxService = require("../services/fx.service");

async function list(req, res) {
  const rates = await fxService.list(req.user._id);
  res.status(200).json({
    success: true,
    data: {
      baseCurrency: req.user.baseCurrency,
      provider: env.fx.provider,
      maxAgeHours: env.fx.maxAgeHours,
      staleCount: rates.filter((rate) => rate.stale).length,
      rates,
    },
  });
}

/** Pull fresh rates from the configured feed for the currencies in use. */
async function refresh(req, res) {
  const result = await fxProviders.refreshForUser(req.user);
  const rates = await fxService.list(req.user._id);
  res.status(200).json({ success: true, data: { ...result, rates } });
}

async function upsert(req, res) {
  const input = { ...req.validated.body };

  if (input.rate !== undefined) {
    input.rateScaled = Math.round(input.rate * RATE_SCALE);
    delete input.rate;
  }

  const rate = await fxService.upsert(req.user._id, input);
  res.status(200).json({ success: true, data: { rate } });
}

async function remove(req, res) {
  const { base, quote } = req.validated.params;
  const result = await fxService.remove(req.user._id, base, quote);
  res.status(200).json({ success: true, message: "Exchange rate deleted", data: result });
}

module.exports = { list, refresh, upsert, remove };
