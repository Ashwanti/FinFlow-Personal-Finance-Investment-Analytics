/**
 * How many decimal places each currency's minor unit has.
 *
 * Two is only the common case, not the rule. The yen has no subunit at all —
 * ¥1000 is 1000 minor units, not 100000 — and Kuwait, Bahrain and Oman quote
 * three. Assuming two everywhere means a JPY balance is reported at 100x its
 * real value the moment it is converted, which is the kind of error that looks
 * like a data-entry mistake rather than a bug.
 *
 * Only the exceptions are listed; everything else defaults to two.
 * Source: ISO 4217.
 */
const DEFAULT_EXPONENT = 2;

const EXPONENTS = {
  // No minor unit.
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // Three decimal places.
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // Four.
  CLF: 4,
  UYW: 4,
};

/** @returns {number} decimal places for a currency code, 2 if unknown. */
function currencyExponent(code) {
  if (!code) return DEFAULT_EXPONENT;
  return EXPONENTS[String(code).toUpperCase()] ?? DEFAULT_EXPONENT;
}

/** 10 ** exponent — how many minor units make one major unit. */
const currencyScale = (code) => 10 ** currencyExponent(code);

module.exports = { DEFAULT_EXPONENT, EXPONENTS, currencyExponent, currencyScale };
