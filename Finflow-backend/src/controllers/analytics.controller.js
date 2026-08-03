const analyticsService = require("../services/analytics.service");

async function summary(req, res) {
  const data = await analyticsService.summary(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function spendingByCategory(req, res) {
  const data = await analyticsService.spendingByCategory(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function cashflow(req, res) {
  const data = await analyticsService.cashflow(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function netWorth(req, res) {
  const data = await analyticsService.netWorth(req.user);
  res.status(200).json({ success: true, data });
}

async function netWorthTrend(req, res) {
  const data = await analyticsService.netWorthTrend(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function dashboard(req, res) {
  const data = await analyticsService.dashboard(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

module.exports = {
  summary,
  spendingByCategory,
  cashflow,
  netWorth,
  netWorthTrend,
  dashboard,
};
