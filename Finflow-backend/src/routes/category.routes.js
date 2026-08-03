const express = require("express");

const categoryController = require("../controllers/category.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { idParam } = require("../validators/common.validator");
const {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
} = require("../validators/category.validator");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate({ query: listCategoriesSchema }), categoryController.list);
router.post("/", validate({ body: createCategorySchema }), categoryController.create);

router.patch(
  "/:id",
  validate({ params: idParam, body: updateCategorySchema }),
  categoryController.update
);
router.delete("/:id", validate({ params: idParam }), categoryController.remove);

module.exports = router;
