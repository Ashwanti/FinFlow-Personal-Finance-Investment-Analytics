const express = require("express");

const userController = require("../controllers/user.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { updateProfileSchema } = require("../validators/auth.validator");

const router = express.Router();

// Everything below this line requires a valid access token.
router.use(requireAuth);

router.get("/", userController.getMe);
router.patch("/", validate({ body: updateProfileSchema }), userController.updateMe);

module.exports = router;
