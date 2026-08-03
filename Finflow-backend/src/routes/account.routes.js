const express = require("express");

const accountController = require("../controllers/account.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { idParam } = require("../validators/common.validator");
const {
  createAccountSchema,
  updateAccountSchema,
  listAccountsSchema,
} = require("../validators/account.validator");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate({ query: listAccountsSchema }), accountController.list);
router.post("/", validate({ body: createAccountSchema }), accountController.create);

router.get("/:id", validate({ params: idParam }), accountController.get);
router.patch(
  "/:id",
  validate({ params: idParam, body: updateAccountSchema }),
  accountController.update
);
router.delete("/:id", validate({ params: idParam }), accountController.remove);

// Repair path: rebuild the running balance from the transaction history.
router.post("/:id/recalculate", validate({ params: idParam }), accountController.recalculate);

module.exports = router;
