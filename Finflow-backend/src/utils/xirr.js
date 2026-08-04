/**
 * XIRR — the annualised return of an irregular series of cashflows.
 *
 * This is the number that actually answers "how are my investments doing".
 * A simple percentage gain cannot, because it ignores *when* money went in:
 * ₹1,000 that grew to ₹1,100 over one month and the same growth over three
 * years are wildly different results, and only a money-weighted rate
 * distinguishes them.
 *
 * Solves for the rate where the net present value of the flows is zero.
 * Newton-Raphson first because it converges in a handful of iterations, then
 * bisection as a fallback — Newton can diverge on the awkward flow patterns
 * real portfolios produce (a big withdrawal early, several top-ups later).
 */

const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86400000;

const NEWTON_ITERATIONS = 60;
const NEWTON_TOLERANCE = 1e-9;

// A rate of exactly -1 is a division by zero; anything below is meaningless.
const MIN_RATE = -0.9999;
const MAX_RATE = 1e6;

const yearsBetween = (from, to) => (to.getTime() - from.getTime()) / (MS_PER_DAY * DAYS_PER_YEAR);

/** Net present value of the flows at a given rate. */
function xnpv(rate, flows, origin) {
  let total = 0;
  for (const flow of flows) {
    total += flow.amount / (1 + rate) ** yearsBetween(origin, flow.date);
  }
  return total;
}

/** d(xnpv)/d(rate) — used by Newton to pick its next guess. */
function xnpvDerivative(rate, flows, origin) {
  let total = 0;
  for (const flow of flows) {
    const years = yearsBetween(origin, flow.date);
    total -= (years * flow.amount) / (1 + rate) ** (years + 1);
  }
  return total;
}

/**
 * @param {{amount:number, date:Date}[]} flows  Money out is negative, money in
 *   positive. The current market value belongs in here as a positive flow
 *   dated today, otherwise the answer describes a portfolio you already sold.
 * @returns {number|null} annualised rate (0.142 = 14.2%), or null when the
 *   flows cannot yield one.
 */
function xirr(flows, guess = 0.1) {
  if (!Array.isArray(flows) || flows.length < 2) return null;

  const sorted = [...flows]
    .filter((flow) => Number.isFinite(flow.amount) && flow.date instanceof Date)
    .sort((a, b) => a.date - b.date);

  if (sorted.length < 2) return null;

  // Without both signs there is no break-even rate to find: money that only
  // ever went out, or only ever came in, has no return.
  const hasOutflow = sorted.some((flow) => flow.amount < 0);
  const hasInflow = sorted.some((flow) => flow.amount > 0);
  if (!hasOutflow || !hasInflow) return null;

  const origin = sorted[0].date;

  // All flows on one day: no elapsed time, so no annualised rate exists.
  if (sorted.every((flow) => flow.date.getTime() === origin.getTime())) return null;

  let rate = guess;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const value = xnpv(rate, sorted, origin);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) < NEWTON_TOLERANCE) return rate;

    const slope = xnpvDerivative(rate, sorted, origin);
    if (!Number.isFinite(slope) || slope === 0) break;

    const next = rate - value / slope;
    if (!Number.isFinite(next)) break;

    const clamped = Math.max(next, MIN_RATE);
    if (Math.abs(clamped - rate) < NEWTON_TOLERANCE) return clamped;
    rate = clamped;
  }

  return bisect(sorted, origin);
}

/** Slower but dependable: narrow a bracket that contains a sign change. */
function bisect(flows, origin) {
  let low = MIN_RATE;
  let high = 1;

  let lowValue = xnpv(low, flows, origin);
  let highValue = xnpv(high, flows, origin);

  // Push the upper bound out until the interval brackets a root.
  let expansions = 0;
  while (lowValue * highValue > 0 && high < MAX_RATE && expansions < 100) {
    high *= 2;
    highValue = xnpv(high, flows, origin);
    expansions += 1;
  }

  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    return null;
  }

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const midValue = xnpv(mid, flows, origin);

    if (Math.abs(midValue) < NEWTON_TOLERANCE || high - low < 1e-12) return mid;

    if (lowValue * midValue < 0) {
      high = mid;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }

  return (low + high) / 2;
}

module.exports = { xirr, xnpv };
