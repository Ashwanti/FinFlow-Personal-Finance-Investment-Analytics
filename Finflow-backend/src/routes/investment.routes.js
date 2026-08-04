const express = require("express");

const investmentController = require("../controllers/investment.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { idParam } = require("../validators/common.validator");
const {
  createHoldingSchema,
  updateHoldingSchema,
  listHoldingsSchema,
  createTradeSchema,
  updateTradeSchema,
  listTradesSchema,
  portfolioSchema,
} = require("../validators/investment.validator");

const router = express.Router();

router.use(requireAuth);

// Analytics first: these are literal paths that "/holdings/:id" style
// parameters must not shadow.
router.get("/portfolio", validate({ query: portfolioSchema }), investmentController.portfolio);
router.get("/performance", validate({ query: portfolioSchema }), investmentController.performance);
router.post("/prices/refresh", investmentController.refreshPrices);

// --- holdings ---
router.get("/holdings", validate({ query: listHoldingsSchema }), investmentController.listHoldings);
router.post("/holdings", validate({ body: createHoldingSchema }), investmentController.createHolding);
router.get("/holdings/:id", validate({ params: idParam }), investmentController.getHolding);
router.patch(
  "/holdings/:id",
  validate({ params: idParam, body: updateHoldingSchema }),
  investmentController.updateHolding
);
router.delete("/holdings/:id", validate({ params: idParam }), investmentController.removeHolding);
router.post(
  "/holdings/:id/rebuild",
  validate({ params: idParam }),
  investmentController.rebuildHolding
);

// --- trades ---
router.get("/trades", validate({ query: listTradesSchema }), investmentController.listTrades);
router.post("/trades", validate({ body: createTradeSchema }), investmentController.createTrade);
router.get("/trades/:id", validate({ params: idParam }), investmentController.getTrade);
router.patch(
  "/trades/:id",
  validate({ params: idParam, body: updateTradeSchema }),
  investmentController.updateTrade
);
router.delete("/trades/:id", validate({ params: idParam }), investmentController.removeTrade);

module.exports = router;
