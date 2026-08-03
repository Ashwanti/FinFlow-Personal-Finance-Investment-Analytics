/**
 * Money is stored as an integer number of minor units — paise, cents — never
 * as a float. `0.1 + 0.2 === 0.30000000000000004` in JavaScript, and that error
 * compounds across thousands of rows until reported totals stop matching
 * reality. Every amount in the database is `amountMinor: 25000` meaning ₹250.00.
 */

const DEFAULT_EXPONENT = 2;

// Well inside Number.MAX_SAFE_INTEGER (9.007e15), so sums of many rows stay exact.
const MAX_MINOR = 1e15;

/** 250.5 -> 25050 */
function toMinor(major, exponent = DEFAULT_EXPONENT) {
  return Math.round(Number(major) * 10 ** exponent);
}

/** 25050 -> 250.5 */
function toMajor(minor, exponent = DEFAULT_EXPONENT) {
  return minor / 10 ** exponent;
}

/** 25050 -> "250.50" — for display and CSV export, never for arithmetic. */
function formatMinor(minor, exponent = DEFAULT_EXPONENT) {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
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

module.exports = { toMinor, toMajor, formatMinor, signedMinor, MAX_MINOR, DEFAULT_EXPONENT };
