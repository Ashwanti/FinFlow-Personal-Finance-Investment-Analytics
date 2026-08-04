/* eslint-disable no-console */
/**
 * Phase 5 — holdings, trades, FIFO cost basis and portfolio performance.
 *
 * Every figure below is hand-checkable. Broker account opens at ₹1,00,000
 * (10000000 paise) and the position is built from three trades:
 *
 *   BUY  10 INFY @ ₹1400, fee ₹20  -> cash -1402000, unit cost 140200
 *   BUY   5 INFY @ ₹1500, no fee   -> cash  -750000, unit cost 150000
 *   SELL  8 INFY @ ₹1600, fee ₹10  -> cash +1279000, FIFO from the first lot
 *
 * Leaving 7 units at a cost basis of 1030400 and realised profit of 157400.
 */
module.exports = async function investmentSuite(ctx) {
  const { call, check, section } = ctx;

  const owner = await call("POST", "/api/auth/register", {
    body: {
      name: "Investor",
      email: `invest+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
    },
  });
  const auth = { token: owner.json?.data?.accessToken };

  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

  const brokerRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Zerodha", type: "INVESTMENT", openingBalanceMinor: 10000000 },
  });
  const broker = brokerRes.json?.data?.account ?? {};

  const bankRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Investor Bank", type: "BANK", openingBalanceMinor: 0 },
  });
  const bank = bankRes.json?.data?.account ?? {};

  const cashOf = async (id) => {
    const res = await call("GET", `/api/accounts/${id}`, auth);
    return res.json?.data?.account?.balanceMinor;
  };
  const netWorth = async () => {
    const res = await call("GET", "/api/analytics/net-worth", auth);
    return res.json?.data;
  };

  section("Creating holdings");

  const wrongAccount = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: { accountId: bank.id, symbol: "INFY", assetClass: "EQUITY" },
  });
  check("refuses a holding in a BANK account", wrongAccount.status === 400, wrongAccount.json);

  const noProviderSymbol = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: {
      accountId: broker.id,
      symbol: "BTC",
      assetClass: "CRYPTO",
      priceProvider: "coingecko",
    },
  });
  check(
    "a vendor provider requires its own symbol",
    noProviderSymbol.status === 400,
    noProviderSymbol.json
  );

  const holdingRes = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: {
      accountId: broker.id,
      symbol: "infy",
      name: "Infosys Ltd",
      assetClass: "EQUITY",
      manualPrice: 1400,
    },
  });
  check("creates a holding with 201", holdingRes.status === 201, holdingRes.json);
  check("uppercases the symbol", holdingRes.json?.data?.holding?.symbol === "INFY");
  check("defaults to the manual price provider", holdingRes.json?.data?.holding?.priceProvider === "manual");
  check("converts ₹1400 to 140000 minor", holdingRes.json?.data?.holding?.manualPriceMinor === 140000);
  check("starts flat", holdingRes.json?.data?.holding?.quantityScaled === 0);
  const holding = holdingRes.json?.data?.holding ?? {};

  const dupe = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: { accountId: broker.id, symbol: "INFY" },
  });
  check("rejects a duplicate holding with 409", dupe.status === 409, dupe.json);

  section("Buying is not spending");

  const worthBefore = await netWorth();
  check("net worth starts at the cash balance", worthBefore?.totalMinor === 10000000, worthBefore);

  const buy1 = await call("POST", "/api/investments/trades", {
    ...auth,
    body: {
      holdingId: holding.id,
      type: "BUY",
      quantity: 10,
      price: 1400,
      fees: 20,
      date: daysAgo(365),
    },
  });
  check("records a buy with 201", buy1.status === 201, buy1.json);
  check("scales quantity to 1e8", buy1.json?.data?.trade?.quantityScaled === 1000000000);
  check("debits cash by price plus fees", (await cashOf(broker.id)) === 8598000);

  const worthAfterBuy = await netWorth();
  check(
    "buying ₹14,000 of stock does NOT cut net worth by ₹14,000",
    worthAfterBuy?.totalMinor === 9998000,
    worthAfterBuy
  );
  check(
    "net worth falls by exactly the ₹20 fee",
    worthBefore.totalMinor - worthAfterBuy.totalMinor === 2000,
    { before: worthBefore?.totalMinor, after: worthAfterBuy?.totalMinor }
  );
  check("cash and investments are reported separately", worthAfterBuy?.cashMinor === 8598000);
  check("the position shows up as investment value", worthAfterBuy?.investmentsMinor === 1400000);

  const spending = await call("GET", "/api/analytics/summary", auth);
  check(
    "a buy never appears as an expense",
    spending.json?.data?.expenseMinor === 0,
    spending.json?.data
  );

  section("FIFO cost basis");

  await call("POST", "/api/investments/trades", {
    ...auth,
    body: {
      holdingId: holding.id,
      type: "BUY",
      quantity: 5,
      price: 1500,
      date: daysAgo(180),
    },
  });
  check("second buy debits cash", (await cashOf(broker.id)) === 7848000);

  const oversell = await call("POST", "/api/investments/trades", {
    ...auth,
    body: { holdingId: holding.id, type: "SELL", quantity: 100, price: 1600, date: daysAgo(30) },
  });
  check("refuses to sell more than held", oversell.status === 400, oversell.json);

  const sell = await call("POST", "/api/investments/trades", {
    ...auth,
    body: {
      holdingId: holding.id,
      type: "SELL",
      quantity: 8,
      price: 1600,
      fees: 10,
      date: daysAgo(30),
    },
  });
  check("records a sell with 201", sell.status === 201, sell.json);
  check("credits cash net of fees", (await cashOf(broker.id)) === 9127000);
  check(
    "takes cost basis from the oldest lot first",
    sell.json?.data?.trade?.costBasisSoldMinor === 1121600,
    sell.json?.data?.trade
  );
  check(
    "realises proceeds minus that basis",
    sell.json?.data?.trade?.realizedPnlMinor === 157400,
    sell.json?.data?.trade
  );
  const sellTradeId = sell.json?.data?.trade?.id;

  section("Portfolio valuation");

  await call("PATCH", `/api/investments/holdings/${holding.id}`, {
    ...auth,
    body: { manualPrice: 1600 },
  });

  const portfolioRes = await call("GET", "/api/investments/portfolio", auth);
  const portfolio = portfolioRes.json?.data;
  const position = portfolio?.positions?.[0];
  check("returns the portfolio", portfolioRes.status === 200, portfolioRes.json);
  check("7 units remain", position?.quantityScaled === 700000000, position);
  check("displays quantity without float noise", position?.quantityDisplay === "7", position);
  check("cost basis is what the remaining units cost", position?.costBasisMinor === 1030400, position);
  check("market value is price times quantity", position?.marketValueMinor === 1120000, position);
  check("unrealised profit is value minus basis", position?.unrealizedPnlMinor === 89600, position);
  check("realised profit is carried on the position", position?.realizedPnlMinor === 157400, position);
  check("total profit combines both", position?.totalPnlMinor === 247000, position);
  check("reports the price source", position?.price?.source === "manual", position?.price);
  check("a manual price is never stale", position?.price?.stale === false, position?.price);
  check("allocation is 100% equity", portfolio?.allocation?.[0]?.sharePct === 100, portfolio?.allocation);

  const worthAfterAll = await netWorth();
  check(
    "net worth equals opening plus total profit",
    worthAfterAll?.totalMinor === 10000000 + 247000,
    worthAfterAll
  );

  section("Performance");

  const perfRes = await call("GET", "/api/investments/performance", auth);
  const perf = perfRes.json?.data;
  check("returns performance", perfRes.status === 200, perfRes.json);
  check("sums what was invested", perf?.investedMinor === 2152000, perf);
  check("sums what was withdrawn", perf?.withdrawnMinor === 1279000, perf);
  check("totals realised and unrealised", perf?.totalPnlMinor === 247000, perf);
  check("totals fees paid", perf?.feesMinor === 3000, perf);
  check("counts the trades", perf?.tradeCount === 3, perf);
  check("computes an XIRR", typeof perf?.xirrPct === "number", perf?.xirrPct);
  check(
    "the XIRR is plausible for ~11% over a year",
    perf?.xirrPct > 0 && perf?.xirrPct < 40,
    perf?.xirrPct
  );
  check("computes a simple return too", typeof perf?.absoluteReturnPct === "number", perf);

  section("Prices");

  const refresh = await call("POST", "/api/investments/prices/refresh", auth);
  check("refresh returns 200", refresh.status === 200, refresh.json);
  check(
    "manual holdings need no network call",
    refresh.json?.data?.considered === 0,
    refresh.json?.data
  );

  const unpricedRes = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: { accountId: broker.id, symbol: "UNLISTED", assetClass: "OTHER" },
  });
  const unpriced = unpricedRes.json?.data?.holding ?? {};
  await call("POST", "/api/investments/trades", {
    ...auth,
    body: { holdingId: unpriced.id, type: "BUY", quantity: 1, price: 500, date: daysAgo(10) },
  });

  const withUnpriced = await call("GET", "/api/investments/portfolio", auth);
  const unpricedPosition = withUnpriced.json?.data?.positions?.find((p) => p.symbol === "UNLISTED");
  check("an unvalued position is flagged", unpricedPosition?.isPriced === false, unpricedPosition);
  check("its market value is null, not zero", unpricedPosition?.marketValueMinor === null);
  check("it explains why", !!unpricedPosition?.price?.error, unpricedPosition?.price);
  check("the portfolio still renders", withUnpriced.status === 200);
  check("and counts what it could not value", withUnpriced.json?.data?.unpricedCount === 1, withUnpriced.json?.data);
  check(
    "allocation ignores unpriced positions rather than sinking them to zero",
    withUnpriced.json?.data?.allocation?.every((slice) => slice.assetClass !== "OTHER"),
    withUnpriced.json?.data?.allocation
  );

  section("Replay keeps everything consistent");

  const rebuilt = await call("POST", `/api/investments/holdings/${holding.id}/rebuild`, auth);
  check("rebuild returns 200", rebuilt.status === 200, rebuilt.json);
  check("replaying the trades finds no drift", rebuilt.json?.data?.holding?.costBasisMinor === 1030400);
  check("quantity is unchanged by a replay", rebuilt.json?.data?.holding?.quantityScaled === 700000000);
  check("realised profit is unchanged", rebuilt.json?.data?.holding?.realizedPnlMinor === 157400);

  const deleted = await call("DELETE", `/api/investments/trades/${sellTradeId}`, auth);
  check("deletes a trade", deleted.status === 200, deleted.json);
  // 9127000 after the sale, less the ₹500 UNLISTED buy above, less the
  // 1279000 the sale had credited.
  check("cash gives back exactly what the sale credited", (await cashOf(broker.id)) === 7798000);

  const afterDelete = await call("GET", `/api/investments/holdings/${holding.id}`, auth);
  check("the sold units come back", afterDelete.json?.data?.holding?.quantityScaled === 1500000000);
  check("cost basis is restored", afterDelete.json?.data?.holding?.costBasisMinor === 2152000);
  check(
    "realised profit is undone with the sale",
    afterDelete.json?.data?.holding?.realizedPnlMinor === 0,
    afterDelete.json?.data?.holding
  );

  section("Lifecycle and isolation");

  const removeTraded = await call("DELETE", `/api/investments/holdings/${holding.id}`, auth);
  check("a traded holding is archived, not deleted", removeTraded.json?.data?.archived === true, removeTraded.json);

  const fresh = await call("POST", "/api/investments/holdings", {
    ...auth,
    body: { accountId: broker.id, symbol: "TCS", manualPrice: 3000 },
  });
  const removeFresh = await call("DELETE", `/api/investments/holdings/${fresh.json?.data?.holding?.id}`, auth);
  check("an untraded holding is deleted outright", removeFresh.json?.data?.deleted === true, removeFresh.json);

  const strangerToken = (
    await call("POST", "/api/auth/register", {
      body: {
        name: "Rival",
        email: `rival+${Date.now()}@smoke.test`,
        password: "Passw0rd123",
      },
    })
  ).json?.data?.accessToken;

  const peek = await call("GET", `/api/investments/holdings/${holding.id}`, { token: strangerToken });
  check("another user cannot read your holding", peek.status === 404, peek.json);

  const strangerPortfolio = await call("GET", "/api/investments/portfolio", { token: strangerToken });
  check("a new user has an empty portfolio", strangerPortfolio.json?.data?.positionCount === 0);
  check(
    "and no XIRR rather than a fabricated zero",
    (await call("GET", "/api/investments/performance", { token: strangerToken })).json?.data?.xirrPct === null
  );
};
