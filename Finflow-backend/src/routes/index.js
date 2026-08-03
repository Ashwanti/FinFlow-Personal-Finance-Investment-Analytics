const express = require("express");

const accountRoutes = require("./account.routes");
const analyticsRoutes = require("./analytics.routes");
const authRoutes = require("./auth.routes");
const categoryRoutes = require("./category.routes");
const transactionRoutes = require("./transaction.routes");
const userRoutes = require("./user.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/me", userRoutes);
router.use("/accounts", accountRoutes);
router.use("/categories", categoryRoutes);
router.use("/transactions", transactionRoutes);
router.use("/analytics", analyticsRoutes);

// Phase 4+ mounts here:
// router.use("/budgets", require("./budget.routes"));
// router.use("/holdings", require("./holding.routes"));

module.exports = router;
