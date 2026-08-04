const express = require("express");

const accountRoutes = require("./account.routes");
const analyticsRoutes = require("./analytics.routes");
const authRoutes = require("./auth.routes");
const budgetRoutes = require("./budget.routes");
const categoryRoutes = require("./category.routes");
const investmentRoutes = require("./investment.routes");
const transactionRoutes = require("./transaction.routes");
const userRoutes = require("./user.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/me", userRoutes);
router.use("/accounts", accountRoutes);
router.use("/categories", categoryRoutes);
router.use("/transactions", transactionRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/budgets", budgetRoutes);
router.use("/investments", investmentRoutes);

module.exports = router;
