const transactionService = require("../services/transaction.service");

/**
 * Amounts pass through untouched.
 *
 * Converting `amount` into minor units needs the currency's decimal places,
 * and the currency belongs to the account, which only the service loads. Doing
 * it here at a flat x100 would turn ¥1000 into ¥100,000.
 */
const passThrough = (body) => ({ ...body });

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
    passThrough(req.validated.body)
  );
  res.status(201).json({ success: true, data: { transaction } });
}

async function update(req, res) {
  const transaction = await transactionService.update(
    req.user._id,
    req.validated.params.id,
    passThrough(req.validated.body)
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
    passThrough(req.validated.body)
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
    passThrough(req.validated.body)
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
