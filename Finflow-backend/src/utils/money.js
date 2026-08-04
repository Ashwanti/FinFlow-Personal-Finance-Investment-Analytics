/**
 * Money is stored as an integer number of minor units — paise, cents — never
 * as a float. `0.1 + 0.2 === 0.30000000000000004` in JavaScript, and that error
 * compounds across thousands of rows until reported totals stop matching
 * reality. Every amount in the database is `amountMinor: 25000` meaning ₹250.00.
 */

const DEFAULT_EXPONENT = 2;

// Well inside Number.MAX_SAFE_INTEGER (9.007e15), so sums of many rows stay exact.
const MAX_MINOR = 1e15;

/**
 * 250.5 -> 25050
 *
 * Shifts the decimal point textually instead of multiplying by a power of ten.
 * The multiply is exact for every two-decimal amount, but not beyond: 1.005
 * evaluates to 100.49999999999999, which rounds *down* to ₹1.00 rather than up
 * to ₹1.01, and 8.165 lands on ₹8.16. Those are precisely the errors integer
 * storage exists to prevent, so the conversion into it must not introduce them.
 *
 * Rounds half away from zero on the first dropped digit.
 */
function toMinor(major, exponent = DEFAULT_EXPONENT) {
  const value = Number(major);
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot convert ${major} to minor units`);
  }

  let text = typeof major === "string" ? major.trim() : String(value);

  // Exponential notation has no decimal point to shift. Only reachable for
  // magnitudes far outside MAX_MINOR, where a float multiply is good enough.
  if (/e/i.test(text)) {
    return Math.round(value * 10 ** exponent);
  }

  const negative = text.startsWith("-");
  if (negative || text.startsWith("+")) text = text.slice(1);

  const [whole = "0", fraction = ""] = text.split(".");
  // One digit past the target precision, so the rounding decision is made on
  // the input the caller actually gave rather than on a float artefact.
  const digits = (fraction + "0".repeat(exponent + 1)).slice(0, exponent + 1);

  let minor =
    Number(whole || "0") * 10 ** exponent + Number(digits.slice(0, exponent) || "0");
  if (Number(digits[exponent]) >= 5) minor += 1;

  return negative ? -minor : minor;
}

/** 25050 -> 250.5 */
function toMajor(minor, exponent = DEFAULT_EXPONENT) {
  return minor / 10 ** exponent;
}

/** 25050 -> "250.50" — for display and CSV export, never for arithmetic. */
function formatMinor(minor, exponent = DEFAULT_EXPONENT) {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");

  // A currency with no subunit has no decimal point either — "1000", not
  // "1000.".
  if (exponent === 0) return `${negative ? "-" : ""}${digits}`;

  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Which way a row moves an account balance.
 *
 * The stored `amountMinor` is always positive; direction lives in the type, so
 * a sum of expenses is a positive "total spent" without needing an abs().
 */
function signedMinor({ type, transferDirection, amountMinor }) {
  if (type === "INCOME") return amountMinor;
  if (type === "EXPENSE") return -amountMinor;
  if (type === "TRANSFER") return transferDirection === "IN" ? amountMinor : -amountMinor;
  throw new Error(`Unknown transaction type: ${type}`);
}

// --- currency-aware wrappers -------------------------------------------------
// Prefer these wherever the currency is known. The bare functions default to
// two decimal places, which is right for most currencies and wrong for the yen.

const { currencyExponent } = require("../constants/currencies");

/** 1000, "JPY" -> 1000 (no subunit) · 250.5, "INR" -> 25050 */
const toMinorIn = (major, currency) => toMinor(major, currencyExponent(currency));

/** 25050, "INR" -> 250.5 */
const toMajorIn = (minor, currency) => toMajor(minor, currencyExponent(currency));

/** 25050, "INR" -> "250.50" · 1000, "JPY" -> "1000" */
const formatMinorIn = (minor, currency) => formatMinor(minor, currencyExponent(currency));

module.exports = {
  toMinor,
  toMajor,
  formatMinor,
  toMinorIn,
  toMajorIn,
  formatMinorIn,
  signedMinor,
  MAX_MINOR,
  DEFAULT_EXPONENT,
};
