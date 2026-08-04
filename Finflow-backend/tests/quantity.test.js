const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  QUANTITY_SCALE,
  toScaled,
  fromScaled,
  formatScaled,
  valueMinor,
  unitPriceMinor,
  proportionalMinor,
} = require("../src/utils/quantity");

describe("quantity", () => {
  describe("scaling", () => {
    it("scales whole and fractional quantities", () => {
      assert.equal(toScaled(1), 100000000);
      assert.equal(toScaled(12.5), 1250000000);
      assert.equal(toScaled(0.00431), 431000);
    });

    it("round-trips", () => {
      for (const quantity of [1, 7, 12.5, 0.00431, 0.1]) {
        assert.equal(fromScaled(toScaled(quantity)), quantity);
      }
    });

    it("formats without float noise", () => {
      // 7 must not render as 6.999999999999999.
      assert.equal(formatScaled(700000000), "7");
      assert.equal(formatScaled(1250000000), "12.5");
      assert.equal(formatScaled(431000), "0.00431");
    });
  });

  describe("valueMinor", () => {
    it("multiplies a price by a quantity", () => {
      // ₹1400.00 x 10 units = ₹14,000.00
      assert.equal(valueMinor(140000, toScaled(10)), 1400000);
      // ₹250.00 x 0.5 units = ₹125.00
      assert.equal(valueMinor(25000, toScaled(0.5)), 12500);
    });

    it("rounds to the nearest minor unit", () => {
      // ₹1.00 x 0.005 units = 0.5 paise -> 1 paise
      assert.equal(valueMinor(100, toScaled(0.005)), 1);
    });

    it("stays exact where the intermediate product leaves float range", () => {
      // ₹31,34,323.23 x 1027.78333193 units. The product is ~3.2e19, far past
      // Number.MAX_SAFE_INTEGER (9.007e15), so the float multiply loses a
      // paisa — this exact pair gives 322140517268 instead of ...267.
      const priceMinor = 313432323;
      const quantityScaled = 102778333193;

      assert.equal(valueMinor(priceMinor, quantityScaled), 322140517267);

      // Proof the test is worth having: the naive path really is wrong here.
      const naive = Math.round((priceMinor * quantityScaled) / QUANTITY_SCALE);
      assert.equal(naive, 322140517268);
      assert.notEqual(naive, valueMinor(priceMinor, quantityScaled));
    });

    it("handles negative prices symmetrically", () => {
      assert.equal(valueMinor(-140000, toScaled(10)), -1400000);
    });
  });

  describe("unitPriceMinor", () => {
    it("divides a total back into a unit price", () => {
      assert.equal(unitPriceMinor(1400000, toScaled(10)), 140000);
    });

    it("returns zero rather than dividing by zero", () => {
      assert.equal(unitPriceMinor(1000, 0), 0);
    });
  });

  describe("proportionalMinor", () => {
    it("returns the whole total when the whole lot is taken", () => {
      // The case that must never drift: selling an entire lot costs exactly
      // what the lot cost to buy.
      assert.equal(proportionalMinor(1142000, toScaled(3), toScaled(3)), 1142000);
    });

    it("splits a lot proportionally", () => {
      // 8 of 10 units of a 1402000 lot.
      assert.equal(proportionalMinor(1402000, toScaled(8), toScaled(10)), 1121600);
    });

    it("keeps the parts summing to the whole for an even split", () => {
      const total = 1402000;
      const first = proportionalMinor(total, toScaled(4), toScaled(10));
      const rest = total - first;
      assert.equal(first + rest, total);
    });

    it("does not lose a paisa on a total that will not divide evenly", () => {
      // ₹11,420 over 3 shares is ₹3,806.66... — the case that produced a
      // 1-paise error when a rounded unit cost was stored instead.
      const total = 1142000;
      let remaining = total;
      let taken = 0;

      // Sell one share at a time; the three parts must still add to the total.
      for (let left = 3; left > 0; left -= 1) {
        const part = proportionalMinor(remaining, toScaled(1), toScaled(left));
        taken += part;
        remaining -= part;
      }

      assert.equal(taken, total);
      assert.equal(remaining, 0);
    });

    it("returns zero for an empty lot", () => {
      assert.equal(proportionalMinor(1000, 0, 0), 0);
    });
  });
});
