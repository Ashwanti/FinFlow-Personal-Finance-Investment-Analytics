const express = require("express");

const analyticsController = require("../controllers/analytics.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  summarySchema,
  spendingByCategorySchema,
  cashflowSchema,
  netWorthTrendSchema,
} = require("../validators/analytics.validator");

const router = express.Router();

router.use(requireAuth);

router.get("/dashboard", validate({ query: summarySchema }), analyticsController.dashboard);
router.get("/summary", validate({ query: summarySchema }), analyticsController.summary);
router.get(
  "/spending-by-category",
  validate({ query: spendingByCategorySchema }),
  analyticsController.spendingByCategory
);
router.get("/cashflow", validate({ query: cashflowSchema }), analyticsController.cashflow);
router.get("/net-worth", analyticsController.netWorth);
router.get(
  "/net-worth/trend",
  validate({ query: netWorthTrendSchema }),
  analyticsController.netWorthTrend
);

module.exports = router;
