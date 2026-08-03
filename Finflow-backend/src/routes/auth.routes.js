const express = require("express");

const authController = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { authLimiter, refreshLimiter } = require("../middleware/rateLimit.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} = require("../validators/auth.validator");

const router = express.Router();

router.post("/register", authLimiter, validate({ body: registerSchema }), authController.register);
router.post("/login", authLimiter, validate({ body: loginSchema }), authController.login);
router.post("/refresh", refreshLimiter, validate({ body: refreshSchema }), authController.refresh);
router.post("/logout", validate({ body: refreshSchema }), authController.logout);

router.post("/logout-all", requireAuth, authController.logoutAll);
router.post(
  "/change-password",
  requireAuth,
  validate({ body: changePasswordSchema }),
  authController.changePassword
);

module.exports = router;
