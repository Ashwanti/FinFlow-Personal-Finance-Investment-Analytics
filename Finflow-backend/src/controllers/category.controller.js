const categoryService = require("../services/category.service");

async function list(req, res) {
  const categories = await categoryService.list(req.user._id, req.validated.query);
  res.status(200).json({ success: true, data: { categories } });
}

async function create(req, res) {
  const category = await categoryService.create(req.user._id, req.validated.body);
  res.status(201).json({ success: true, data: { category } });
}

async function update(req, res) {
  const category = await categoryService.update(
    req.user._id,
    req.validated.params.id,
    req.validated.body
  );
  res.status(200).json({ success: true, data: { category } });
}

async function remove(req, res) {
  const result = await categoryService.remove(req.user._id, req.validated.params.id);
  res.status(200).json({
    success: true,
    message: result.archived
      ? "Category archived because it is used by existing transactions"
      : "Category deleted",
    data: result,
  });
}

module.exports = { list, create, update, remove };
