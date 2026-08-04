const env = require("../config/env");
const { currencyExponent } = require("../constants/currencies");
const ExchangeRate = require("../models/exchangeRate.model");
const ApiError = require("../utils/ApiError");

const { RATE_SCALE } = ExchangeRate;

/**
 * Currency conversion for reporting.
 *
 * Every total in this app is a sum over rows that each carry their own
 * currency. Adding ₹1,000 to $1,000 and calling it 2,000 is the same class of
 * error as counting a transfer as income — a number that looks fine and is
 * simply wrong. So aggregations convert into the user's base currency first.
 *
 * When a rate is missing, the amount is **left out and reported**, never
 * guessed. An invented rate produces a confident, wrong net worth; an excluded
 * amount produces a total the caller knows is partial.
 */

const key = (base, quote) => `${base}>${quote}`;

/**
 * Loads a user's rates once into a lookup, so an aggregation over hundreds of
 * rows does not issue a query per row.
 */
async function loadRates(userId, baseCurrency) {
  const rows = await ExchangeRate.find({ user: userId });

  const direct = new Map();
  for (const row of rows) {
    direct.set(key(row.base, row.quote), row.rateScaled);
    // A rate is symmetric information: USD/INR also tells you INR/USD.
    if (!direct.has(key(row.quote, row.base))) {
      direct.set(key(row.quote, row.base), Math.round((RATE_SCALE * RATE_SCALE) / row.rateScaled));
    }
  }

  return { direct, baseCurrency };
}

/** An empty table, for callers that know every amount is already in one currency. */
const emptyRates = (baseCurrency) => ({ direct: new Map(), baseCurrency });

/**
 * @returns {number|null} scaled rate from `from` to `to`, or null if unknown.
 */
function findRate(rates, from, to) {
  if (from === to) return RATE_SCALE;

  const straight = rates.direct.get(key(from, to));
  if (straight) return straight;

  // Triangulate through the base currency: knowing USD/INR and EUR/INR is
  // enough to convert USD to EUR without storing that pair.
  const { baseCurrency } = rates;
  if (baseCurrency && from !== baseCurrency && to !== baseCurrency) {
    const toBase = rates.direct.get(key(from, baseCurrency));
    const fromBase = rates.direct.get(key(baseCurrency, to));
    if (toBase && fromBase) {
      return Math.round((toBase * fromBase) / RATE_SCALE);
    }
  }

  return null;
}

/**
 * @returns {number|null} amount in `to`'s minor units, or null when no rate is
 *   known. Minor units are assumed to share an exponent, which holds for every
 *   currency this app supports.
 */
function convertMinor(amountMinor, from, to, rates) {
  if (from === to) return amountMinor;

  const rate = findRate(rates, from, to);
  if (rate === null) return null;

  // A rate is quoted between *major* units, so converting minor units has to
  // account for the two currencies having different numbers of decimal places.
  // ¥1000 is 1000 minor units; ₹550 is 55000. Treating both as hundredths
  // would report the yen balance at a hundredth of its value.
  const shift = currencyExponent(to) - currencyExponent(from);

  let numerator = BigInt(Math.round(amountMinor)) * BigInt(rate);
  let denominator = BigInt(RATE_SCALE);

  if (shift > 0) numerator *= 10n ** BigInt(shift);
  else if (shift < 0) denominator *= 10n ** BigInt(-shift);

  const half = denominator / 2n;
  const rounded =
    numerator >= 0n ? (numerator + half) / denominator : (numerator - half) / denominator;

  return Number(rounded);
}

/**
 * Sums buckets that each carry a currency into one base-currency total.
 *
 * @param {{currency:string, amountMinor:number}[]} buckets
 * @returns {{totalMinor:number, unconverted:{currency:string, amountMinor:number}[]}}
 */
function sumConverted(buckets, toCurrency, rates) {
  let totalMinor = 0;
  const unconverted = [];

  for (const bucket of buckets) {
    const converted = convertMinor(bucket.amountMinor, bucket.currency, toCurrency, rates);
    if (converted === null) {
      unconverted.push({ currency: bucket.currency, amountMinor: bucket.amountMinor });
    } else {
      totalMinor += converted;
    }
  }

  return { totalMinor, unconverted };
}

/** Merges the unconverted lists several aggregations produce into one. */
function mergeUnconverted(...lists) {
  const merged = new Map();

  for (const list of lists.flat()) {
    if (!list) continue;
    merged.set(list.currency, (merged.get(list.currency) ?? 0) + list.amountMinor);
  }

  return [...merged.entries()].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

// ---------------------------------------------------------------------------

/**
 * How old a rate is, and whether that is old enough to distrust.
 *
 * A rate entered once and never revisited keeps converting quietly and
 * wrongly. Age is the only signal that distinguishes "83.5 is the rate" from
 * "83.5 was the rate last March", so it is reported rather than assumed.
 */
function withAge(rate, maxAgeHours) {
  const ageHours = (Date.now() - rate.asOf.getTime()) / 3600000;
  return {
    ...rate.toJSON(),
    ageHours: Math.round(ageHours * 10) / 10,
    stale: ageHours > maxAgeHours,
  };
}

async function list(userId, { maxAgeHours = env.fx.maxAgeHours } = {}) {
  const rates = await ExchangeRate.find({ user: userId }).sort({ base: 1, quote: 1 });
  return rates.map((rate) => withAge(rate, maxAgeHours));
}

/** Pairs whose stored rate is older than the configured tolerance. */
async function staleRates(userId, { maxAgeHours = env.fx.maxAgeHours } = {}) {
  const rates = await list(userId, { maxAgeHours });
  return rates
    .filter((rate) => rate.stale)
    .map(({ base, quote, asOf, ageHours, source }) => ({ base, quote, asOf, ageHours, source }));
}

async function upsert(userId, { base, quote, rateScaled, asOf, source }) {
  if (base === quote) {
    throw ApiError.badRequest("A currency's rate against itself is always 1");
  }

  const rate = await ExchangeRate.findOneAndUpdate(
    { user: userId, base, quote },
    {
      user: userId,
      base,
      quote,
      rateScaled,
      asOf: asOf ?? new Date(),
      source: source ?? "manual",
    },
    { upsert: true, returnDocument: "after", runValidators: true }
  );

  return rate.toJSON();
}

async function remove(userId, base, quote) {
  const result = await ExchangeRate.deleteOne({ user: userId, base, quote });
  if (result.deletedCount === 0) throw ApiError.notFound("Exchange rate not found");
  return { deleted: true };
}

module.exports = {
  RATE_SCALE,
  loadRates,
  emptyRates,
  findRate,
  convertMinor,
  sumConverted,
  mergeUnconverted,
  list,
  staleRates,
  upsert,
  remove,
};
