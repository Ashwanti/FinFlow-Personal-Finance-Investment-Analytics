/**
 * Instrument quantities, held as scaled integers for the same reason money is.
 *
 * A holding can be 0.00431 BTC or 12.5 units of a mutual fund, so quantity is
 * genuinely fractional — but summing and splitting float lots drifts exactly
 * the way float money does. Quantities are stored as integers at 1e-8
 * precision (satoshi level, which is the finest any mainstream instrument
 * quotes).
 */

const { toMinor } = require("./money");

const QUANTITY_SCALE = 1e8;
const QUANTITY_EXPONENT = 8;

// Keeps quantityScaled inside Number.MAX_SAFE_INTEGER with room to spare.
const MAX_QUANTITY_SCALED = 1e15;

/**
 * 12.5 -> 1250000000
 *
 * Shares toMinor's textual shift rather than multiplying by 1e8. The float
 * error is worse here, not better: eight decimal places leave far more room
 * for a quantity to land a unit off, and a wrong quantity misprices the whole
 * position.
 */
const toScaled = (quantity) => toMinor(quantity, QUANTITY_EXPONENT);

/** 1250000000 -> 12.5 */
const fromScaled = (scaled) => scaled / QUANTITY_SCALE;

/** Trims float noise for display: 1250000000 -> "12.5" */
function formatScaled(scaled) {
  return String(Number(fromScaled(scaled).toFixed(8)));
}

/**
 * price (minor units) x quantity (scaled) -> value in minor units.
 *
 * Done in BigInt because the intermediate product overflows Number's exact
 * integer range easily: a ₹1,00,000 share price (1e7 paise) times 100 units
 * (1e10 scaled) is 1e17, well past 9.007e15. Computing it in floats would
 * quietly round the portfolio value of anyone holding a mid-sized position.
 */
function valueMinor(priceMinor, quantityScaled) {
  const product = BigInt(Math.round(priceMinor)) * BigInt(Math.round(quantityScaled));
  const scale = BigInt(QUANTITY_SCALE);
  const half = scale / 2n;

  // Round half away from zero; BigInt division truncates toward zero.
  const rounded = product >= 0n ? (product + half) / scale : (product - half) / scale;
  return Number(rounded);
}

/**
 * value (minor) / quantity (scaled) -> price per unit in minor units.
 * Used to turn a lot's total cost back into a unit cost.
 */
function unitPriceMinor(valueInMinor, quantityScaled) {
  if (!quantityScaled) return 0;
  const numerator = BigInt(Math.round(valueInMinor)) * BigInt(QUANTITY_SCALE);
  const denominator = BigInt(Math.round(quantityScaled));
  const half = denominator / 2n;

  const rounded =
    numerator >= 0n ? (numerator + half) / denominator : (numerator - half) / denominator;
  return Number(rounded);
}

/**
 * The share of `totalMinor` attributable to `partScaled` out of `wholeScaled`.
 *
 * Used to split a lot's cost when only part of it is sold. Splitting the total
 * is exact where deriving from a stored per-unit cost is not: three shares
 * bought for ₹11,420 have a unit cost of ₹3,806.67 recurring, and multiplying
 * that back by three loses a paisa. Selling the whole lot short-circuits to the
 * stored total so the common case cannot drift at all.
 */
function proportionalMinor(totalMinor, partScaled, wholeScaled) {
  if (!wholeScaled) return 0;
  if (partScaled === wholeScaled) return totalMinor;

  const numerator = BigInt(Math.round(totalMinor)) * BigInt(Math.round(partScaled));
  const denominator = BigInt(Math.round(wholeScaled));
  const half = denominator / 2n;

  const rounded =
    numerator >= 0n ? (numerator + half) / denominator : (numerator - half) / denominator;
  return Number(rounded);
}

module.exports = {
  QUANTITY_SCALE,
  MAX_QUANTITY_SCALED,
  proportionalMinor,
  toScaled,
  fromScaled,
  formatScaled,
  valueMinor,
  unitPriceMinor,
};
