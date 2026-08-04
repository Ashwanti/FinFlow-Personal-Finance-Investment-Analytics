const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

// fx.service reads validated config at load time; these are never used because
// nothing here touches the database.
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/unit";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || "unit-test-secret-0123456789abcdef0123456789";

const { currencyExponent, currencyScale } = require("../src/constants/currencies");
const { toMinorIn, toMajorIn, formatMinorIn } = require("../src/utils/money");
const fx = require("../src/services/fx.service");

const { RATE_SCALE } = fx;

/** Builds the lookup fx.convertMinor expects, without touching MongoDB. */
function ratesOf(pairs, baseCurrency = "INR") {
  const direct = new Map();
  for (const [pair, rate] of Object.entries(pairs)) {
    const [base, quote] = pair.split("/");
    const scaled = Math.round(rate * RATE_SCALE);
    direct.set(`${base}>${quote}`, scaled);
    direct.set(`${quote}>${base}`, Math.round((RATE_SCALE * RATE_SCALE) / scaled));
  }
  return { direct, baseCurrency };
}

describe("currency exponents", () => {
  it("defaults to two decimal places", () => {
    assert.equal(currencyExponent("INR"), 2);
    assert.equal(currencyExponent("USD"), 2);
    assert.equal(currencyExponent("EUR"), 2);
  });

  it("knows the currencies with no minor unit", () => {
    assert.equal(currencyExponent("JPY"), 0);
    assert.equal(currencyExponent("KRW"), 0);
    assert.equal(currencyExponent("VND"), 0);
  });

  it("knows the three-decimal currencies", () => {
    assert.equal(currencyExponent("KWD"), 3);
    assert.equal(currencyExponent("BHD"), 3);
    assert.equal(currencyExponent("OMR"), 3);
  });

  it("is case-insensitive and safe on unknown input", () => {
    assert.equal(currencyExponent("jpy"), 0);
    assert.equal(currencyExponent("ZZZ"), 2);
    assert.equal(currencyExponent(null), 2);
    assert.equal(currencyExponent(undefined), 2);
  });

  it("exposes the scale", () => {
    assert.equal(currencyScale("INR"), 100);
    assert.equal(currencyScale("JPY"), 1);
    assert.equal(currencyScale("KWD"), 1000);
  });
});

describe("currency-aware money", () => {
  it("converts major to minor per currency", () => {
    assert.equal(toMinorIn(250.5, "INR"), 25050);
    // ¥1000 is 1000 minor units, not 100000.
    assert.equal(toMinorIn(1000, "JPY"), 1000);
    assert.equal(toMinorIn(1.234, "KWD"), 1234);
  });

  it("rounds to the currency's precision", () => {
    assert.equal(toMinorIn(1000.6, "JPY"), 1001);
    assert.equal(toMinorIn(1000.4, "JPY"), 1000);
  });

  it("round-trips", () => {
    assert.equal(toMajorIn(toMinorIn(1000, "JPY"), "JPY"), 1000);
    assert.equal(toMajorIn(toMinorIn(250.5, "INR"), "INR"), 250.5);
  });

  it("formats without a stray decimal point", () => {
    assert.equal(formatMinorIn(25050, "INR"), "250.50");
    assert.equal(formatMinorIn(1000, "JPY"), "1000");
    assert.equal(formatMinorIn(-1000, "JPY"), "-1000");
    assert.equal(formatMinorIn(1234, "KWD"), "1.234");
  });
});

describe("fx.convertMinor", () => {
  const rates = ratesOf({ "USD/INR": 80, "JPY/INR": 0.55 });

  it("is a no-op within one currency", () => {
    assert.equal(fx.convertMinor(12345, "INR", "INR", rates), 12345);
  });

  it("converts between two-decimal currencies", () => {
    // $1,000.00 at 80 -> ₹80,000.00
    assert.equal(fx.convertMinor(100000, "USD", "INR", rates), 8000000);
  });

  it("uses the derived inverse", () => {
    // ₹80,000.00 back to $1,000.00
    assert.equal(fx.convertMinor(8000000, "INR", "USD", rates), 100000);
  });

  it("shifts the scale converting out of a zero-decimal currency", () => {
    // ¥1000 (1000 minor) at 0.55 -> ₹550.00 (55000 minor). Ignoring the
    // exponent difference would report ₹5.50.
    assert.equal(fx.convertMinor(1000, "JPY", "INR", rates), 55000);
  });

  it("shifts the scale converting into a zero-decimal currency", () => {
    // ₹550.00 -> ¥1000
    assert.equal(fx.convertMinor(55000, "INR", "JPY", rates), 1000);
  });

  it("round-trips across differing exponents", () => {
    const there = fx.convertMinor(1000, "JPY", "INR", rates);
    assert.equal(fx.convertMinor(there, "INR", "JPY", rates), 1000);
  });

  it("triangulates through the base currency", () => {
    // USD -> JPY was never stored; USD/INR and JPY/INR are enough.
    // $100.00 = ₹8,000.00 = ¥14,545 (8000 / 0.55).
    const result = fx.convertMinor(10000, "USD", "JPY", rates);
    assert.ok(Math.abs(result - 14545) <= 1, `expected about 14545, got ${result}`);
  });

  it("returns null rather than guessing an unknown rate", () => {
    assert.equal(fx.convertMinor(10000, "GBP", "INR", rates), null);
  });

  it("handles negative amounts symmetrically", () => {
    assert.equal(fx.convertMinor(-100000, "USD", "INR", rates), -8000000);
  });
});

describe("fx.sumConverted", () => {
  const rates = ratesOf({ "USD/INR": 80 });

  it("totals what it can and reports what it cannot", () => {
    const result = fx.sumConverted(
      [
        { currency: "INR", amountMinor: 100000 },
        { currency: "USD", amountMinor: 100000 },
        { currency: "GBP", amountMinor: 5000 },
      ],
      "INR",
      rates
    );

    assert.equal(result.totalMinor, 100000 + 8000000);
    assert.deepEqual(result.unconverted, [{ currency: "GBP", amountMinor: 5000 }]);
  });

  it("merges repeated unconvertible currencies", () => {
    const merged = fx.mergeUnconverted([
      { currency: "GBP", amountMinor: 100 },
      { currency: "GBP", amountMinor: 250 },
      { currency: "AUD", amountMinor: 10 },
    ]);

    assert.deepEqual(
      merged.sort((a, b) => a.currency.localeCompare(b.currency)),
      [
        { currency: "AUD", amountMinor: 10 },
        { currency: "GBP", amountMinor: 350 },
      ]
    );
  });
});
