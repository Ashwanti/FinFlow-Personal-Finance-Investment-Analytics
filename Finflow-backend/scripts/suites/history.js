/* eslint-disable no-console */
/**
 * Historical net worth (investments included) and the background-job lease.
 *
 * Covers the two limits that were previously documented rather than fixed: the
 * trend ignoring investments, and price sync being unsafe on more than one
 * instance.
 */
const { withLock, acquire, release } = require("../../src/utils/jobLock");
const priceSync = require("../../src/jobs/priceSync.job");

module.exports = async function historySuite(ctx) {
  const { call, check, section } = ctx;

  const owner = await call("POST", "/api/auth/register", {
    body: {
      name: "Historian",
      email: `history+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
    },
  });
  const auth = { token: owner.json?.data?.accessToken };

  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

  const brokerRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Broker", type: "INVESTMENT", openingBalanceMinor: 10000000 },
  });
  const broker = brokerRes.json?.data?.account ?? {};

  const holdingRes = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: {
      accountId: broker.id,
      symbol: "ACME",
      assetClass: "EQUITY",
      manualPrice: 1200,
    },
  });
  const holding = holdingRes.json?.data?.holding ?? {};

  // Bought 60 days ago at ₹1000; now marked at ₹1200.
  await call("POST", "/api/investments/trades", {
    ...auth,
    body: {
      holdingId: holding.id,
      type: "BUY",
      quantity: 10,
      price: 1000,
      date: daysAgo(60),
    },
  });

  section("The trend now includes investments");

  const trendRes = await call("GET", "/api/analytics/net-worth/trend?months=4", auth);
  const trend = trendRes.json?.data;
  check("returns a trend", trendRes.status === 200, trendRes.json);
  check("no longer disclaims investments", trend?.includesInvestments === true, trend);
  check("has one point per month", trend?.series?.length === 4, trend?.series?.length);

  const latest = trend?.series?.at(-1);
  check("splits cash from investments", typeof latest?.cashMinor === "number", latest);
  check("cash reflects the purchase", latest?.cashMinor === 9000000, latest);
  check("the position is valued at market", latest?.investmentsMinor === 1200000, latest);
  check("and labels the basis", latest?.investmentBasis === "MARKET", latest);
  check("net worth is cash plus investments", latest?.netWorthMinor === 10200000, latest);

  const worth = await call("GET", "/api/analytics/net-worth", auth);
  check(
    "the last trend point agrees with current net worth",
    latest?.netWorthMinor === worth.json?.data?.totalMinor,
    { trend: latest?.netWorthMinor, current: worth.json?.data?.totalMinor }
  );

  const earliest = trend?.series?.[0];
  check(
    "months before the purchase hold no position",
    earliest?.investmentsMinor === 0,
    earliest
  );
  check("and report no basis rather than a false one", earliest?.investmentBasis === "NONE", earliest);

  section("Unpriced history falls back to cost, and says so");

  const plainRes = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: { accountId: broker.id, symbol: "NOPRICE", assetClass: "OTHER" },
  });
  await call("POST", "/api/investments/trades", {
    ...auth,
    body: {
      holdingId: plainRes.json?.data?.holding?.id,
      type: "BUY",
      quantity: 2,
      price: 500,
      date: daysAgo(20),
    },
  });

  const mixed = await call("GET", "/api/analytics/net-worth/trend?months=4", auth);
  const mixedLatest = mixed.json?.data?.series?.at(-1);
  check(
    "a position with no price is carried at cost",
    mixedLatest?.investmentsMinor === 1200000 + 100000,
    mixedLatest
  );
  check("and the point is labelled MIXED", mixedLatest?.investmentBasis === "MIXED", mixedLatest);
  check(
    "cost is reported alongside value",
    mixedLatest?.investmentCostMinor === 1000000 + 100000,
    mixedLatest
  );

  section("Background jobs take a lease");

  const first = await acquire("smoke-test-job", 60000);
  check("the first caller wins the lease", typeof first === "string", first);

  const second = await acquire("smoke-test-job", 60000);
  check("a second caller is turned away", second === null, second);

  await release("smoke-test-job", first);
  const third = await acquire("smoke-test-job", 60000);
  check("the lease is reusable once released", typeof third === "string", third);
  await release("smoke-test-job", third);

  // An expired lease must be reclaimable, or a crashed process wedges the job.
  const expired = await acquire("smoke-test-expiry", -1000);
  const reclaimed = await acquire("smoke-test-expiry", 60000);
  check("an expired lease can be taken over", typeof reclaimed === "string", { expired, reclaimed });
  await release("smoke-test-expiry", reclaimed);

  let ran = 0;
  const [a, b] = await Promise.all([
    withLock("smoke-test-race", 60000, async () => {
      ran += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "done";
    }),
    withLock("smoke-test-race", 60000, async () => {
      ran += 1;
      return "done";
    }),
  ]);
  check("only one of two racing runs executes", ran === 1, { ran, a, b });
  check("the loser reports that it skipped", a.skipped === true || b.skipped === true, { a, b });

  const sync = await priceSync.runOnce();
  check(
    "price sync runs clean with only manual holdings",
    sync?.considered === 0,
    sync
  );
};
