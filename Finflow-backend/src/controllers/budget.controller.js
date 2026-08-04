const budgetService = require("../services/budget.service");
const { toMinor } = require("../utils/money");

/** Collapses `amount` (major) into the canonical `amountMinor`. */
function normaliseAmount(body) {
  const input = { ...body };
  if (input.amount !== undefined) {
    input.amountMinor = toMinor(input.amount);
    delete input.amount;
  }
  return input;
}

async function list(req, res) {
  const budgets = await budgetService.list(req.user, req.validated.query);
  res.status(200).json({ success: true, data: { budgets } });
}

async function overview(req, res) {
  const data = await budgetService.overview(req.user, req.validated.query);
  res.status(200).json({ success: true, data });
}

async function get(req, res) {
  const budget = await budgetService.get(req.user, req.validated.params.id, req.validated.query);
  res.status(200).json({ success: true, data: { budget } });
}

async function create(req, res) {
  const budget = await budgetService.create(req.user, normaliseAmount(req.validated.body));
  res.status(201).json({ success: true, data: { budget } });
}

async function update(req, res) {
  const budget = await budgetService.update(
    req.user,
    req.validated.params.id,
    normaliseAmount(req.validated.body)
  );
  res.status(200).json({ success: true, data: { budget } });
}

async function remove(req, res) {
  const result = await budgetService.remove(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, message: "Budget deleted", data: result });
}

module.exports = { list, overview, get, create, update, remove };
