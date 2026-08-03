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

function startOfDay(date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return zonedTimeToUtc(year, month, day, timeZone);
}

function startOfMonth(date, timeZone) {
  const { year, month } = zonedParts(date, timeZone);
  return zonedTimeToUtc(year, month, 1, timeZone);
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
  let cursor =
    interval === "month" || interval === "year" ? startOfMonth(from, timeZone) : startOfDay(from, timeZone);

  if (interval === "year") {
    const { year } = zonedParts(from, timeZone);
    cursor = zonedTimeToUtc(year, 1, 1, timeZone);
  }

  if (interval === "week") {
    // Match MongoDB's $dateTrunc, which starts weeks on Sunday.
    const weekday = new Date(cursor).getUTCDay();
    cursor = addDays(cursor, -weekday, timeZone);
  }

  let guard = 0;
  while (cursor <= to && guard < 5000) {
    periods.push(new Date(cursor));
    if (interval === "day") cursor = addDays(cursor, 1, timeZone);
    else if (interval === "week") cursor = addDays(cursor, 7, timeZone);
    else if (interval === "month") cursor = addMonths(cursor, 1, timeZone);
    else cursor = addMonths(cursor, 12, timeZone);
    guard += 1;
  }

  return periods;
}

module.exports = {
  zonedParts,
  zoneOffsetMs,
  zonedTimeToUtc,
  startOfDay,
  startOfMonth,
  addMonths,
  addDays,
  enumeratePeriods,
};
