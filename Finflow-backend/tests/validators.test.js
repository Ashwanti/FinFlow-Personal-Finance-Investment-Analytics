const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

// The validators pull in config transitively; nothing here touches the database.
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/unit";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "unit-test-secret-0123456789abcdef0123456789";

const { idParam } = require("../src/validators/common.validator");
const {
  createTransactionSchema,
  createTransferSchema,
  updateTransactionSchema,
} = require("../src/validators/transaction.validator");
const { createBudgetSchema } = require("../src/validators/budget.validator");
const { createHoldingSchema, createTradeSchema } = require("../src/validators/investment.validator");

const VALID_ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f191e810c19729de860ea";

/** Every message reported against one field, in order. */
function messagesFor(schema, input, field) {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path.join(".") === field)
    .map((issue) => issue.message);
}

const validTransaction = {
  type: "EXPENSE",
  accountId: VALID_ID,
  categoryId: OTHER_ID,
  amount: 250.5,
  date: "2026-08-10",
};

describe("required id fields", () => {
  describe("an unfilled field says so, rather than blaming the format", () => {
    // An empty <select> submits "", which is a perfectly good string. Left to
    // the format check alone it comes back "Not a valid id" — true, and no help
    // at all to someone who has simply not picked an account yet.
    it("names the field when the value is an empty string", () => {
      assert.deepEqual(
        messagesFor(createTransactionSchema, { ...validTransaction, accountId: "" }, "accountId"),
        ["Select an account"],
      );
    });

    it("names the field when the key is absent altogether", () => {
      const { accountId, ...withoutAccount } = validTransaction;
      assert.deepEqual(
        messagesFor(createTransactionSchema, withoutAccount, "accountId"),
        ["Select an account"],
      );
    });

    it("treats whitespace as unfilled", () => {
      assert.deepEqual(
        messagesFor(createTransactionSchema, { ...validTransaction, accountId: "   " }, "accountId"),
        ["Select an account"],
      );
    });

    it("reports exactly one message, so the form has nothing to choose between", () => {
      // The client keys errors by field name, so a second message would simply
      // overwrite the first — and "Not a valid id" is the one that used to win.
      const messages = messagesFor(
        createTransactionSchema,
        { ...validTransaction, accountId: "" },
        "accountId",
      );
      assert.equal(messages.length, 1);
    });

    it("does the same for a category", () => {
      assert.deepEqual(
        messagesFor(createTransactionSchema, { ...validTransaction, categoryId: "" }, "categoryId"),
        ["Select a category"],
      );
    });

    it("distinguishes the two sides of a transfer", () => {
      const result = createTransferSchema.safeParse({ amount: 100, date: "2026-08-10" });
      assert.equal(result.success, false);
      assert.deepEqual(
        result.error.issues.map((issue) => issue.message).sort(),
        ["Select an account to move money from", "Select an account to move money to"],
      );
    });

    it("covers budgets and investments too", () => {
      assert.deepEqual(messagesFor(createBudgetSchema, { amount: 5000 }, "categoryId"), [
        "Select a category to budget",
      ]);
      assert.deepEqual(
        messagesFor(createHoldingSchema, { symbol: "INFY", accountId: "" }, "accountId"),
        ["Select an account to hold this in"],
      );
      assert.deepEqual(
        messagesFor(createTradeSchema, { type: "BUY", date: "2026-08-10" }, "holdingId"),
        ["Select a holding to trade"],
      );
    });

    it("applies when an edit tries to clear the field", () => {
      assert.deepEqual(messagesFor(updateTransactionSchema, { accountId: "" }, "accountId"), [
        "Select an account",
      ]);
    });
  });

  describe("a malformed id is still reported as malformed", () => {
    it("rejects a non-id string in the body", () => {
      assert.deepEqual(
        messagesFor(createTransactionSchema, { ...validTransaction, accountId: "abc123" }, "accountId"),
        ["Not a valid id"],
      );
    });

    it("rejects a non-id route parameter", () => {
      assert.deepEqual(messagesFor(idParam, { id: "not-an-id" }, "id"), ["Not a valid id"]);
    });
  });

  describe("valid input is untouched", () => {
    it("accepts a fully filled transaction", () => {
      assert.equal(createTransactionSchema.safeParse(validTransaction).success, true);
    });

    it("accepts a real id as a route parameter", () => {
      assert.equal(idParam.safeParse({ id: VALID_ID }).success, true);
    });

    it("still trims a padded but otherwise valid id", () => {
      const result = createTransactionSchema.safeParse({
        ...validTransaction,
        accountId: `  ${VALID_ID}  `,
      });
      assert.equal(result.success, true);
      assert.equal(result.data.accountId, VALID_ID);
    });
  });
});
