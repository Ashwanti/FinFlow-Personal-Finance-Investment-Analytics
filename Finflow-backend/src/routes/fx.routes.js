const express = require("express");

const fxController = require("../controllers/fx.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { upsertRateSchema, ratePairSchema } = require("../validators/fx.validator");

const router = express.Router();

router.use(requireAuth);

router.get("/rates", fxController.list);

// PUT rather than POST: a rate for a pair is a single value being set, not a
// new record each time.
router.put("/rates", validate({ body: upsertRateSchema }), fxController.upsert);

router.delete(
  "/rates/:base/:quote",
  validate({ params: ratePairSchema }),
  fxController.remove
);

module.exports = router;
