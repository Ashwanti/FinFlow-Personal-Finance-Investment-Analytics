const express = require("express");

const accountRoutes = require("./account.routes");
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

module.exports = router;
