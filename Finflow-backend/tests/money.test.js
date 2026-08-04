const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { toMinor, toMajor, formatMinor, signedMinor } = require("../src/utils/money");

describe("money", () => {
  describe("toMinor", () => {
    it("converts major units to integer minor units", () => {
      assert.equal(toMinor(250.5), 25050);
      assert.equal(toMinor(1), 100);
      assert.equal(toMinor(0), 0);
    });

    it("survives the float cases that motivate integer storage", () => {
      // 0.1 + 0.2 === 0.30000000000000004
      assert.equal(toMinor(0.1 + 0.2), 30);
      assert.equal(toMinor(8.29), 829);
    });

    it("rounds half up even where a float multiply rounds down", () => {
      // 1.005 * 100 === 100.49999999999999 and 8.165 * 100 === 816.4999999999999,
      // so Math.round would give 100 and 816 — the wrong paisa, in the
      // direction that quietly shortchanges.
      assert.equal(toMinor(1.005), 101);
      assert.equal(toMinor(8.165), 817);
      assert.equal(toMinor("1.005"), 101);
    });

    it("truncates below the rounding digit rather than creeping upward", () => {
      assert.equal(toMinor(1.0049), 100);
      assert.equal(toMinor(1.0051), 101);
    });

    it("is exact for every two-decimal amount", () => {
      for (let cents = 0; cents <= 20000; cents += 1) {
        assert.equal(toMinor(cents / 100), cents);
      }
    });

    it("handles negatives and rejects non-numbers", () => {
      assert.equal(toMinor(-250.5), -25050);
      assert.equal(toMinor(-1.005), -101);
      assert.throws(() => toMinor("abc"), TypeError);
    });

    it("accepts numeric strings", () => {
      assert.equal(toMinor("19.99"), 1999);
    });
  });

  describe("formatMinor", () => {
    it("always shows two decimal places", () => {
      assert.equal(formatMinor(25050), "250.50");
      assert.equal(formatMinor(100), "1.00");
    });

    it("pads amounts below one unit", () => {
      assert.equal(formatMinor(5), "0.05");
      assert.equal(formatMinor(0), "0.00");
    });

    it("keeps the sign outside the digits", () => {
      assert.equal(formatMinor(-25050), "-250.50");
      assert.equal(formatMinor(-5), "-0.05");
    });

    it("round-trips through toMinor", () => {
      for (const amount of [1, 5, 99, 100, 12345, 999999]) {
        assert.equal(toMinor(formatMinor(amount)), amount);
      }
    });
  });

  it("toMajor inverts toMinor", () => {
    assert.equal(toMajor(25050), 250.5);
    assert.equal(toMajor(5), 0.05);
  });

  describe("signedMinor", () => {
    it("treats income as money in and expense as money out", () => {
      assert.equal(signedMinor({ type: "INCOME", amountMinor: 500 }), 500);
      assert.equal(signedMinor({ type: "EXPENSE", amountMinor: 500 }), -500);
    });

    it("signs transfer legs by direction", () => {
      assert.equal(
        signedMinor({ type: "TRANSFER", transferDirection: "OUT", amountMinor: 500 }),
        -500
      );
      assert.equal(
        signedMinor({ type: "TRANSFER", transferDirection: "IN", amountMinor: 500 }),
        500
      );
    });

    it("nets a transfer pair to zero, which is why net worth ignores them", () => {
      const out = signedMinor({ type: "TRANSFER", transferDirection: "OUT", amountMinor: 100000 });
      const into = signedMinor({ type: "TRANSFER", transferDirection: "IN", amountMinor: 100000 });
      assert.equal(out + into, 0);
    });

    it("refuses an unknown type rather than guessing a direction", () => {
      assert.throws(() => signedMinor({ type: "REFUND", amountMinor: 1 }), /Unknown transaction type/);
    });
  });
});
