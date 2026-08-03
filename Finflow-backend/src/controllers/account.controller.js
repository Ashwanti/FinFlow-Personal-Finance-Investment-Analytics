const accountService = require("../services/account.service");

async function list(req, res) {
  const accounts = await accountService.list(req.user._id, req.validated.query);
  res.status(200).json({ success: true, data: { accounts } });
}

async function get(req, res) {
  const account = await accountService.get(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, data: { account } });
}

async function create(req, res) {
  const account = await accountService.create(req.user, req.validated.body);
  res.status(201).json({ success: true, data: { account } });
}

async function update(req, res) {
  const account = await accountService.update(
    req.user._id,
    req.validated.params.id,
    req.validated.body
  );
  res.status(200).json({ success: true, data: { account } });
}

async function remove(req, res) {
  const result = await accountService.remove(req.user._id, req.validated.params.id);
  res.status(200).json({
    success: true,
    message: result.archived
      ? "Account archived because it still has transactions"
      : "Account deleted",
    data: result,
  });
}

async function recalculate(req, res) {
  const result = await accountService.recalculateBalance(req.user._id, req.validated.params.id);
  res.status(200).json({ success: true, data: result });
}

module.exports = { list, get, create, update, remove, recalculate };
