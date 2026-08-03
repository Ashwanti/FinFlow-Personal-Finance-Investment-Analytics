const express = require("express");

const transactionController = require("../controllers/transaction.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { idParam } = require("../validators/common.validator");
const {
  createTransactionSchema,
  updateTransactionSchema,
  createTransferSchema,
  updateTransferSchema,
  listTransactionsSchema,
} = require("../validators/transaction.validator");

const router = express.Router();

router.use(requireAuth);

router.get("/", validate({ query: listTransactionsSchema }), transactionController.list);
router.post("/", validate({ body: createTransactionSchema }), transactionController.create);

// Declared before "/:id" so the literal path is not swallowed by the parameter.
router.post(
  "/transfer",
  validate({ body: createTransferSchema }),
  transactionController.createTransfer
);
router.get("/transfer/:id", validate({ params: idParam }), transactionController.getTransfer);
router.patch(
  "/transfer/:id",
  validate({ params: idParam, body: updateTransferSchema }),
  transactionController.updateTransfer
);
router.delete("/transfer/:id", validate({ params: idParam }), transactionController.removeTransfer);

router.get("/:id", validate({ params: idParam }), transactionController.get);
router.patch(
  "/:id",
  validate({ params: idParam, body: updateTransactionSchema }),
  transactionController.update
);
router.delete("/:id", validate({ params: idParam }), transactionController.remove);

module.exports = router;
