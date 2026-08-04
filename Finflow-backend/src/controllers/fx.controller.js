const { RATE_SCALE } = require("../models/exchangeRate.model");
const fxService = require("../services/fx.service");

async function list(req, res) {
  const rates = await fxService.list(req.user._id);
  res.status(200).json({
    success: true,
    data: { baseCurrency: req.user.baseCurrency, rates },
  });
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

module.exports = { list, upsert, remove };
