/**
 * Display helpers for money and quantities.
 *
 * The API sends integer minor units — 25050 means ₹250.50 — because floats
 * lose paise. That discipline only survives if the frontend keeps it: divide
 * for display, never for arithmetic. If you need a total, sum the minor units
 * and format once at the end.
 *
 * The exponent table mirrors the backend's src/constants/currencies.js. The
 * yen has no subunit, so ¥1000 is 1000 minor units, and dividing it by 100
 * would report a hundredth of the real figure.
 */
const EXPONENTS = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

export const currencyExponent = (currency) =>
  EXPONENTS[String(currency || "").toUpperCase()] ?? 2;

/** 25050 -> 250.5. For charts, which need a number, not a string. */
export const toMajor = (minor, currency) =>
  (minor ?? 0) / 10 ** currencyExponent(currency);

/**
 * "250.50", "INR" -> 25050
 *
 * Shifts the decimal point textually rather than multiplying, mirroring the
 * backend's toMinor. `1.005 * 100` is `100.49999999999999`, which rounds down
 * to the wrong paisa — the exact error integer storage exists to avoid, so the
 * conversion into it must not introduce one.
 *
 * Most forms send the major amount and let the server convert. This is for the
 * few endpoints that only accept minor units, such as an account's opening
 * balance.
 */
export function toMinor(major, currency) {
  const exponent = currencyExponent(currency);
  const value = Number(major);
  if (!Number.isFinite(value)) return null;

  let text = typeof major === "string" ? major.trim() : String(value);
  if (/e/i.test(text)) return Math.round(value * 10 ** exponent);

  const negative = text.startsWith("-");
  if (negative || text.startsWith("+")) text = text.slice(1);

  const [whole = "0", fraction = ""] = text.split(".");
  const digits = (fraction + "0".repeat(exponent + 1)).slice(0, exponent + 1);

  let minor = Number(whole || "0") * 10 ** exponent + Number(digits.slice(0, exponent) || "0");
  if (Number(digits[exponent]) >= 5) minor += 1;

  return negative ? -minor : minor;
}

/** Fills a number input from a stored amount, without trailing-zero noise. */
export const toAmountInput = (minor, currency) =>
  minor === null || minor === undefined ? "" : String(toMajor(minor, currency));

/**
 * 25050, "INR" -> "₹250.50"
 *
 * Uses Intl so the symbol, grouping and decimal count match the currency's own
 * conventions rather than being hardcoded to two places.
 */
export function formatMoney(minor, currency = "INR", { compact = false, sign = false } = {}) {
  if (minor === null || minor === undefined) return "—";

  const exponent = currencyExponent(currency);
  const value = minor / 10 ** exponent;

  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: compact ? 0 : exponent,
    maximumFractionDigits: compact ? 0 : exponent,
    ...(compact && { notation: "compact" }),
  }).format(value);

  // An explicit "+" on gains, where the reader is comparing against zero.
  return sign && minor > 0 ? `+${formatted}` : formatted;
}

/** Shortens a currency to its symbol for axis ticks, where space is scarce. */
export function currencySymbol(currency = "INR") {
  const parts = new Intl.NumberFormat(undefined, { style: "currency", currency }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

export function formatPercent(value, { sign = false } = {}) {
  // null is deliberate on the API side — "no income, so no savings rate" is
  // not the same claim as "saved 0%", and must not render as one.
  if (value === null || value === undefined) return "—";
  const formatted = `${Math.abs(value).toFixed(2).replace(/\.00$/, "")}%`;
  if (value < 0) return `-${formatted}`;
  return sign && value > 0 ? `+${formatted}` : formatted;
}

export const formatDate = (value, options = { day: "numeric", month: "short" }) =>
  value ? new Intl.DateTimeFormat(undefined, options).format(new Date(value)) : "—";

export const formatMonth = (value) =>
  value ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(value)) : "";
