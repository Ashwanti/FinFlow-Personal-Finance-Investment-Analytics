const ApiError = require("../utils/ApiError");

/**
 * Validates request parts against Zod schemas.
 *
 * Parsed output lands on `req.validated.{body,params,query}` rather than
 * overwriting the originals: in Express 5 `req.query` is a getter with no
 * setter, so assigning to it throws at runtime.
 *
 *   router.post("/login", validate({ body: loginSchema }), controller.login)
 *   // then in the controller: const { email } = req.validated.body
 */
const validate = (schemas) => (req, res, next) => {
  req.validated = {};

  for (const part of ["body", "params", "query"]) {
    const schema = schemas[part];
    if (!schema) continue;

    // Express 5 leaves req.body as undefined when the request carries no body.
    // Parsing {} instead keeps cookie-only calls working and turns a missing
    // body into per-field "required" errors rather than "expected object".
    const input = req[part] === undefined ? {} : req[part];

    const result = schema.safeParse(input);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || part,
        message: issue.message,
      }));
      return next(ApiError.badRequest("Validation failed", details));
    }

    req.validated[part] = result.data;
  }

  return next();
};

module.exports = { validate };
