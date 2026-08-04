const express = require("express");

const budgetController = require("../controllers/budget.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { idParam } = require("../validators/common.validator");
const {
  createBudgetSchema,
  updateBudgetSchema,
  listBudgetsSchema,
  budgetAtSchema,
} = require("../validators/budget.validator");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate({ query: listBudgetsSchema }), budgetController.list);
router.post("/", validate({ body: createBudgetSchema }), budgetController.create);

// Declared before "/:id" so the literal path is not captured by the parameter.
router.get("/overview", validate({ query: budgetAtSchema }), budgetController.overview);

router.get(
  "/:id",
  validate({ params: idParam, query: budgetAtSchema }),
  budgetController.get
);
router.patch(
  "/:id",
  validate({ params: idParam, body: updateBudgetSchema }),
  budgetController.update
);
router.delete("/:id", validate({ params: idParam }), budgetController.remove);

module.exports = router;
