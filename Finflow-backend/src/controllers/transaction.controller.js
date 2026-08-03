const transactionService = require("../services/transaction.service");
const { toMinor } = require("../utils/money");

/**
 * Collapses the two accepted amount spellings into the canonical minor units
 * before anything downstream sees them, so services only ever deal in integers.
 */
function normaliseAmounts(body) {
  const input = { ...body };

  if (input.amount !== undefined) {
    input.amountMinor = toMinor(input.amount);
    delete input.amount;
  }
  if (input.toAmount !== undefined) {
    input.toAmountMinor = toMinor(input.toAmount);
    delete input.toAmount;
  }

  return input;
}

async function list(req, res) {
  const result = await transactionService.list(req.user._id, req.validated.query);
  res.status(200).json({ success: true, data: result });
}

async function get(req, res) {
  const transaction = await transactionService.get(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, data: { transaction } });
}

async function create(req, res) {
  const transaction = await transactionService.create(
    req.user._id,
    normaliseAmounts(req.validated.body)
  );
  res.status(201).json({ success: true, data: { transaction } });
}

async function update(req, res) {
  const transaction = await transactionService.update(
    req.user._id,
    req.validated.params.id,
    normaliseAmounts(req.validated.body)
  );
  res.status(200).json({ success: true, data: { transaction } });
}

async function remove(req, res) {
  const result = await transactionService.remove(req.user._id, req.validated.params.id);
  res.status(200).json({
    success: true,
    message: result.deleted > 1 ? "Transfer deleted (both legs)" : "Transaction deleted",
    data: result,
  });
}

async function createTransfer(req, res) {
  const transfer = await transactionService.createTransfer(
    req.user._id,
    normaliseAmounts(req.validated.body)
  );
  res.status(201).json({ success: true, data: { transfer } });
}

async function getTransfer(req, res) {
  const transfer = await transactionService.getTransfer(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, data: { transfer } });
}

async function updateTransfer(req, res) {
  const transfer = await transactionService.updateTransfer(
    req.user._id,
    req.validated.params.id,
    normaliseAmounts(req.validated.body)
  );
  res.status(200).json({ success: true, data: { transfer } });
}

async function removeTransfer(req, res) {
  const result = await transactionService.removeTransfer(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, message: "Transfer deleted (both legs)", data: result });
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  createTransfer,
  getTransfer,
  updateTransfer,
  removeTransfer,
};
