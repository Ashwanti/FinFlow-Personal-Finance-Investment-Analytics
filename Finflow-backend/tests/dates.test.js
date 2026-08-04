const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  zonedParts,
  zonedWeekday,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  periodRange,
  nextPeriod,
  addDays,
  addMonths,
  enumeratePeriods,
} = require("../src/utils/dates");

const IST = "Asia/Kolkata"; // UTC+5:30, no DST
const NY = "America/New_York"; // UTC-5/-4, observes DST
const UTC = "UTC";

describe("dates", () => {
  describe("zonedParts", () => {
    it("reads the local calendar date, not the UTC one", () => {
      // 18:45 UTC is already the next day in India.
      const instant = new Date("2026-08-03T18:45:00Z");
      assert.deepEqual(zonedParts(instant, IST), { year: 2026, month: 8, day: 4 });
      assert.deepEqual(zonedParts(instant, UTC), { year: 2026, month: 8, day: 3 });
    });
  });

  describe("zonedWeekday", () => {
    it("reads the local weekday, not the UTC one", () => {
      // Local midnight on Monday 3 Aug 2026 in IST is Sunday 18:30 UTC.
      const localMidnight = startOfDay(new Date("2026-08-03T12:00:00Z"), IST);

      assert.equal(localMidnight.toISOString(), "2026-08-02T18:30:00.000Z");
      assert.equal(new Date(localMidnight).getUTCDay(), 0, "UTC still calls this Sunday");
      // The bug this replaced: getUTCDay() here shifted every weekly bucket.
      assert.equal(zonedWeekday(localMidnight, IST), 1, "locally it is Monday");
    });
  });

  describe("period starts", () => {
    it("puts the start of an Indian month at 18:30 the previous day UTC", () => {
      const start = startOfMonth(new Date("2026-08-14T09:00:00Z"), IST);
      assert.equal(start.toISOString(), "2026-07-31T18:30:00.000Z");
    });

    it("puts the start of a UTC month at midnight", () => {
      const start = startOfMonth(new Date("2026-08-14T09:00:00Z"), UTC);
      assert.equal(start.toISOString(), "2026-08-01T00:00:00.000Z");
    });

    it("starts weeks on Sunday, matching MongoDB $dateTrunc", () => {
      // 2026-08-05 is a Wednesday.
      const start = startOfWeek(new Date("2026-08-05T12:00:00Z"), IST);
      assert.equal(zonedWeekday(start, IST), 0);
      assert.deepEqual(zonedParts(start, IST), { year: 2026, month: 8, day: 2 });
    });

    it("is idempotent — the start of a period is its own start", () => {
      const start = startOfWeek(new Date("2026-08-05T12:00:00Z"), IST);
      assert.equal(startOfWeek(start, IST).getTime(), start.getTime());

      const month = startOfMonth(new Date("2026-08-05T12:00:00Z"), IST);
      assert.equal(startOfMonth(month, IST).getTime(), month.getTime());
    });

    it("finds the start of a year", () => {
      const start = startOfYear(new Date("2026-08-05T12:00:00Z"), IST);
      assert.equal(start.toISOString(), "2025-12-31T18:30:00.000Z");
    });
  });

  describe("periodRange", () => {
    it("is half-open, so no transaction is counted twice", () => {
      const { start, end } = periodRange(new Date("2026-08-14T09:00:00Z"), "month", IST);
      assert.equal(start.toISOString(), "2026-07-31T18:30:00.000Z");
      assert.equal(end.toISOString(), "2026-08-31T18:30:00.000Z");

      // The next period begins exactly where this one ends.
      const next = periodRange(end, "month", IST);
      assert.equal(next.start.getTime(), end.getTime());
    });

    it("spans a whole week", () => {
      const { start, end } = periodRange(new Date("2026-08-05T12:00:00Z"), "week", IST);
      assert.equal(end - start, 7 * 86400000);
    });
  });

  describe("arithmetic", () => {
    it("clamps to the last day when a month is shorter", () => {
      // 31 Jan + 1 month has no 31 Feb.
      const result = addMonths(new Date("2026-01-31T12:00:00Z"), 1, UTC);
      assert.deepEqual(zonedParts(result, UTC), { year: 2026, month: 2, day: 28 });
    });

    it("rolls over year boundaries", () => {
      const result = addMonths(new Date("2026-11-15T12:00:00Z"), 3, UTC);
      assert.deepEqual(zonedParts(result, UTC), { year: 2027, month: 2, day: 15 });
    });

    it("keeps the local calendar day across a DST change", () => {
      // US DST ends 1 Nov 2026; the local date must still advance by one.
      const before = startOfDay(new Date("2026-10-31T16:00:00Z"), NY);
      const after = addDays(before, 2, NY);
      assert.deepEqual(zonedParts(after, NY), { year: 2026, month: 11, day: 2 });
    });
  });

  describe("enumeratePeriods", () => {
    it("returns one entry per month inclusive of both ends", () => {
      const from = startOfMonth(new Date("2026-03-15T00:00:00Z"), IST);
      const to = new Date("2026-08-15T00:00:00Z");
      const periods = enumeratePeriods(from, to, "month", IST);

      assert.equal(periods.length, 6); // March..August
      assert.equal(periods[0].getTime(), from.getTime());
    });

    it("emits period starts, not the raw from-date", () => {
      const from = new Date("2026-08-14T09:00:00Z");
      const [first] = enumeratePeriods(from, new Date("2026-08-20T00:00:00Z"), "month", IST);
      assert.equal(first.toISOString(), "2026-07-31T18:30:00.000Z");
    });

    it("aligns weekly buckets to Sunday", () => {
      const periods = enumeratePeriods(
        new Date("2026-08-03T00:00:00Z"),
        new Date("2026-08-25T00:00:00Z"),
        "week",
        IST
      );
      for (const period of periods) {
        assert.equal(zonedWeekday(period, IST), 0);
      }
    });

    it("steps daily without skipping or repeating", () => {
      const periods = enumeratePeriods(
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-10T23:59:00Z"),
        "day",
        UTC
      );
      assert.equal(periods.length, 10);
      const unique = new Set(periods.map((p) => p.toISOString()));
      assert.equal(unique.size, 10);
    });

    it("returns nothing when the range is inverted", () => {
      const periods = enumeratePeriods(
        new Date("2026-08-10T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z"),
        "day",
        UTC
      );
      assert.equal(periods.length, 0);
    });

    it("agrees with nextPeriod", () => {
      const from = startOfMonth(new Date("2026-03-15T00:00:00Z"), IST);
      const periods = enumeratePeriods(from, new Date("2026-06-15T00:00:00Z"), "month", IST);

      for (let i = 1; i < periods.length; i += 1) {
        assert.equal(periods[i].getTime(), nextPeriod(periods[i - 1], "month", IST).getTime());
      }
    });
  });
});
