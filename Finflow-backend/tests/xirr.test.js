const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { xirr, xnpv } = require("../src/utils/xirr");

const DAY = 86400000;
const at = (daysFromNow) => new Date(Date.UTC(2026, 0, 1) + daysFromNow * DAY);

const closeTo = (actual, expected, tolerance = 1e-4) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );

describe("xirr", () => {
  describe("known rates", () => {
    it("finds 10% on a 10% gain over one year", () => {
      const rate = xirr([
        { amount: -1000, date: at(0) },
        { amount: 1100, date: at(365) },
      ]);
      closeTo(rate, 0.1);
    });

    it("finds 100% on a double over one year", () => {
      const rate = xirr([
        { amount: -1000, date: at(0) },
        { amount: 2000, date: at(365) },
      ]);
      closeTo(rate, 1);
    });

    it("annualises a short holding period upward", () => {
      // 10% in one month is far more than 10% a year.
      const rate = xirr([
        { amount: -1000, date: at(0) },
        { amount: 1100, date: at(365 / 12) },
      ]);
      assert.ok(rate > 2, `expected a large annualised rate, got ${rate}`);
    });

    it("reports a loss as a negative rate", () => {
      const rate = xirr([
        { amount: -1000, date: at(0) },
        { amount: 900, date: at(365) },
      ]);
      closeTo(rate, -0.1);
    });

    it("distinguishes the same gain over different periods", () => {
      const fast = xirr([
        { amount: -1000, date: at(0) },
        { amount: 1100, date: at(365) },
      ]);
      const slow = xirr([
        { amount: -1000, date: at(0) },
        { amount: 1100, date: at(365 * 3) },
      ]);
      // The whole reason XIRR exists rather than a plain percentage gain.
      assert.ok(fast > slow, `${fast} should beat ${slow}`);
    });
  });

  describe("irregular flows", () => {
    it("returns a rate whose net present value is zero", () => {
      // The property that defines the answer, checked independently of how it
      // was found.
      const flows = [
        { amount: -1402000, date: at(0) },
        { amount: -750000, date: at(185) },
        { amount: 1279000, date: at(335) },
        { amount: 1120000, date: at(365) },
      ];

      const rate = xirr(flows);
      assert.equal(typeof rate, "number");
      closeTo(xnpv(rate, flows, flows[0].date), 0, 1e-6);
    });

    it("handles many top-ups followed by one exit", () => {
      const flows = [];
      for (let month = 0; month < 12; month += 1) {
        flows.push({ amount: -10000, date: at(month * 30) });
      }
      flows.push({ amount: 130000, date: at(365) });

      const rate = xirr(flows);
      assert.equal(typeof rate, "number");
      closeTo(xnpv(rate, flows, flows[0].date), 0, 1e-6);
      assert.ok(rate > 0, "a profitable SIP should show a positive rate");
    });

    it("survives a large early withdrawal, where Newton alone can diverge", () => {
      const flows = [
        { amount: -1000, date: at(0) },
        { amount: 900, date: at(10) },
        { amount: -50, date: at(200) },
        { amount: 300, date: at(365) },
      ];

      const rate = xirr(flows);
      assert.equal(typeof rate, "number");
      closeTo(xnpv(rate, flows, flows[0].date), 0, 1e-6);
    });
  });

  describe("refuses to invent a rate", () => {
    it("returns null when money only ever went out", () => {
      assert.equal(
        xirr([
          { amount: -1000, date: at(0) },
          { amount: -500, date: at(100) },
        ]),
        null
      );
    });

    it("returns null when money only ever came in", () => {
      assert.equal(
        xirr([
          { amount: 1000, date: at(0) },
          { amount: 500, date: at(100) },
        ]),
        null
      );
    });

    it("returns null for a single flow", () => {
      assert.equal(xirr([{ amount: -1000, date: at(0) }]), null);
    });

    it("returns null for no flows", () => {
      assert.equal(xirr([]), null);
      assert.equal(xirr(null), null);
    });

    it("returns null when every flow lands on the same day", () => {
      // No elapsed time means no annualised rate exists.
      assert.equal(
        xirr([
          { amount: -1000, date: at(5) },
          { amount: 1200, date: at(5) },
        ]),
        null
      );
    });

    it("ignores malformed entries rather than returning NaN", () => {
      const rate = xirr([
        { amount: -1000, date: at(0) },
        { amount: Number.NaN, date: at(100) },
        { amount: 1100, date: at(365) },
      ]);
      closeTo(rate, 0.1);
    });
  });
});
