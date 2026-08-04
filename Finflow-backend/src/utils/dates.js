/**
 * Timezone-aware date helpers, built on Intl so there is no date library.
 *
 * "This month" must mean the user's month. Truncating in UTC puts the first
 * 5.5 hours of every Indian month into the previous one, which is exactly the
 * kind of quiet off-by-one that makes a monthly report disagree with the
 * transaction list below it.
 */

/** The calendar date as seen in `timeZone`. */
function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return { year, month, day };
}

/** How far `timeZone` is from UTC at this instant, in milliseconds. */
function zoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

/** Midnight on a given local calendar day, as the equivalent UTC instant. */
function zonedTimeToUtc(year, month, day, timeZone) {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // The offset is sampled at the naive instant, which is accurate everywhere
  // except within a few hours of a DST change.
  return new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Day of week as seen in `timeZone`.
 *
 * Not derivable from the UTC instant: midnight on a Monday in Asia/Kolkata is
 * 18:30 the previous Sunday in UTC, so `getUTCDay()` would report the wrong
 * day and shift every weekly bucket by one.
 */
function zonedWeekday(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  return WEEKDAYS[formatter.format(date)];
}

function startOfDay(date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return zonedTimeToUtc(year, month, day, timeZone);
}

/** Weeks start on Sunday, matching MongoDB's $dateTrunc default. */
function startOfWeek(date, timeZone) {
  const dayStart = startOfDay(date, timeZone);
  return addDays(dayStart, -zonedWeekday(dayStart, timeZone), timeZone);
}

function startOfMonth(date, timeZone) {
  const { year, month } = zonedParts(date, timeZone);
  return zonedTimeToUtc(year, month, 1, timeZone);
}

function startOfYear(date, timeZone) {
  const { year } = zonedParts(date, timeZone);
  return zonedTimeToUtc(year, 1, 1, timeZone);
}

/** Start of the period `date` falls in, for a $dateTrunc-compatible unit. */
function startOfPeriod(date, unit, timeZone) {
  if (unit === "day") return startOfDay(date, timeZone);
  if (unit === "week") return startOfWeek(date, timeZone);
  if (unit === "year") return startOfYear(date, timeZone);
  return startOfMonth(date, timeZone);
}

/** The half-open window [start, nextStart) that `date` falls in. */
function periodRange(date, unit, timeZone) {
  const start = startOfPeriod(date, unit, timeZone);
  return { start, end: nextPeriod(start, unit, timeZone) };
}

function nextPeriod(start, unit, timeZone) {
  if (unit === "day") return addDays(start, 1, timeZone);
  if (unit === "week") return addDays(start, 7, timeZone);
  if (unit === "year") return addMonths(start, 12, timeZone);
  return addMonths(start, 1, timeZone);
}

function addMonths(date, count, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return zonedTimeToUtc(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    Math.min(day, lastDay),
    timeZone
  );
}

function addDays(date, count, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return zonedTimeToUtc(year, month, day + count, timeZone);
}

/**
 * Every period boundary between `from` and `to`, so a chart can show a flat
 * line through a month with no activity instead of skipping it.
 */
function enumeratePeriods(from, to, interval, timeZone) {
  const periods = [];
  let cursor = startOfPeriod(from, interval, timeZone);

  let guard = 0;
  while (cursor <= to && guard < 5000) {
    periods.push(new Date(cursor));
    cursor = nextPeriod(cursor, interval, timeZone);
    guard += 1;
  }

  return periods;
}

module.exports = {
  zonedParts,
  zonedWeekday,
  zoneOffsetMs,
  zonedTimeToUtc,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  startOfPeriod,
  periodRange,
  nextPeriod,
  addMonths,
  addDays,
  enumeratePeriods,
};
