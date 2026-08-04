/* eslint-disable no-console */
/**
 * Multi-currency conversion, historical valuation and the job lease.
 *
 * Scenario: an INR user with a USD account. USD/INR is 80, chosen so every
 * converted figure is exact.
 *
 *   HDFC (INR)  opening ₹1,00,000  = 10000000
 *   Chase (USD) opening   $1,000   =   100000  -> ₹80,000 = 8000000
 */
module.exports = async function multiCurrencySuite(ctx) {
  const { call, check, section } = ctx;

  const owner = await call("POST", "/api/auth/register", {
    body: {
      name: "Globetrotter",
      email: `fx+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
      baseCurrency: "INR",
    },
  });
  const auth = { token: owner.json?.data?.accessToken };

  const inrRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "HDFC", type: "BANK", currency: "INR", openingBalanceMinor: 10000000 },
  });
  const usdRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Chase", type: "BANK", currency: "USD", openingBalanceMinor: 100000 },
  });
  const inr = inrRes.json?.data?.account ?? {};
  const usd = usdRes.json?.data?.account ?? {};
  check("creates accounts in two currencies", usd.currency === "USD", usdRes.json);

  const netWorth = async () => (await call("GET", "/api/analytics/net-worth", auth)).json?.data;

  section("An unknown rate is reported, never guessed");

  const before = await netWorth();
  check(
    "only the base-currency balance is totalled",
    before?.totalMinor === 10000000,
    before
  );
  check("the unconvertible balance is listed", before?.unconverted?.length === 1, before?.unconverted);
  check("it names the currency", before?.unconverted?.[0]?.currency === "USD", before?.unconverted);
  check(
    "it reports the untranslated amount",
    before?.unconverted?.[0]?.amountMinor === 100000,
    before?.unconverted
  );

  section("Setting a rate");

  const sameCurrency = await call("PUT", "/api/fx/rates", {
    ...auth,
    body: { base: "INR", quote: "INR", rate: 1 },
  });
  check("refuses a rate against itself", sameCurrency.status === 400, sameCurrency.json);

  const set = await call("PUT", "/api/fx/rates", {
    ...auth,
    body: { base: "USD", quote: "INR", rate: 80 },
  });
  check("stores a rate with 200", set.status === 200, set.json);
  check("scales the rate to an integer", set.json?.data?.rate?.rateScaled === 8000000000, set.json?.data?.rate);
  check("echoes the decimal back", set.json?.data?.rate?.rate === 80, set.json?.data?.rate);

  const after = await netWorth();
  check("the USD balance is now converted", after?.totalMinor === 18000000, after);
  check("nothing is left unconverted", after?.unconverted?.length === 0, after?.unconverted);

  section("The inverse rate comes for free");

  const usdUser = await call("POST", "/api/auth/register", {
    body: {
      name: "Dollar User",
      email: `usd+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
      baseCurrency: "USD",
    },
  });
  const usdAuth = { token: usdUser.json?.data?.accessToken };

  await call("POST", "/api/accounts", {
    ...usdAuth,
    body: { name: "SBI", type: "BANK", currency: "INR", openingBalanceMinor: 800000 },
  });
  await call("PUT", "/api/fx/rates", {
    ...usdAuth,
    body: { base: "USD", quote: "INR", rate: 80 },
  });

  const usdWorth = await call("GET", "/api/analytics/net-worth", usdAuth);
  // ₹8,000 at 80/USD is $100 = 10000 cents; only USD/INR was stored.
  check(
    "INR converts to USD from the USD/INR rate alone",
    usdWorth.json?.data?.totalMinor === 10000,
    usdWorth.json?.data
  );

  section("Spending in a foreign currency");

  const cats = await call("GET", "/api/categories?kind=EXPENSE", auth);
  const groceries = (cats.json?.data?.categories ?? []).find((c) => c.name === "Groceries");

  await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "EXPENSE",
      accountId: usd.id,
      categoryId: groceries.id,
      amountMinor: 5000, // $50
      date: new Date().toISOString(),
      description: "Groceries abroad",
    },
  });
  await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "EXPENSE",
      accountId: inr.id,
      categoryId: groceries.id,
      amountMinor: 100000, // ₹1000
      date: new Date().toISOString(),
      description: "Groceries at home",
    },
  });

  const summary = await call("GET", "/api/analytics/summary", auth);
  // $50 at 80 is ₹4,000 = 400000, plus ₹1,000 = 100000.
  check(
    "summary converts before totalling",
    summary.json?.data?.expenseMinor === 500000,
    summary.json?.data
  );

  const byCat = await call("GET", "/api/analytics/spending-by-category", auth);
  check(
    "category totals merge both currencies into one row",
    byCat.json?.data?.categories?.length === 1,
    byCat.json?.data?.categories
  );
  check("and total correctly", byCat.json?.data?.categories?.[0]?.totalMinor === 500000);

  const budget = await call("POST", "/api/budgets", {
    ...auth,
    body: { categoryId: groceries.id, amountMinor: 1000000 },
  });
  check(
    "budgets count foreign spending at the converted amount",
    budget.json?.data?.budget?.spentMinor === 500000,
    budget.json?.data?.budget
  );

  section("Removing a rate makes totals partial again");

  const removed = await call("DELETE", "/api/fx/rates/USD/INR", auth);
  check("deletes a rate", removed.status === 200, removed.json);

  const partial = await netWorth();
  check("the USD balance drops back out", partial?.unconverted?.length === 1, partial);
  check(
    "the total falls to what is still convertible",
    partial?.totalMinor === 10000000 - 100000,
    partial
  );

  const missing = await call("DELETE", "/api/fx/rates/USD/INR", auth);
  check("deleting a missing rate is a 404", missing.status === 404, missing.json);

  section("A currency with no minor unit");

  // Its own user so the earlier balances stay exact.
  const jpyUser = await call("POST", "/api/auth/register", {
    body: {
      name: "Yen Holder",
      email: `jpy+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
      baseCurrency: "INR",
    },
  });
  const jpyAuth = { token: jpyUser.json?.data?.accessToken };

  // ¥100,000 is 100000 minor units, because the yen has no subunit.
  const jpyAccount = await call("POST", "/api/accounts", {
    ...jpyAuth,
    body: { name: "MUFG", type: "BANK", currency: "JPY", openingBalanceMinor: 100000 },
  });
  const yen = jpyAccount.json?.data?.account ?? {};

  await call("PUT", "/api/fx/rates", {
    ...jpyAuth,
    body: { base: "JPY", quote: "INR", rate: 0.55 },
  });

  const jpyWorth = await call("GET", "/api/analytics/net-worth", jpyAuth);
  check(
    "¥100,000 converts to ₹55,000, not ₹550",
    jpyWorth.json?.data?.totalMinor === 5500000,
    jpyWorth.json?.data
  );

  const jpyCats = await call("GET", "/api/categories?kind=EXPENSE", jpyAuth);
  const jpyGroceries = (jpyCats.json?.data?.categories ?? []).find((c) => c.name === "Groceries");

  const jpySpend = await call("POST", "/api/transactions", {
    ...jpyAuth,
    body: {
      type: "EXPENSE",
      accountId: yen.id,
      categoryId: jpyGroceries.id,
      amount: 1000, // ¥1000
      date: new Date().toISOString(),
    },
  });
  check(
    "an amount of 1000 in a JPY account stores 1000 minor units",
    jpySpend.json?.data?.transaction?.amountMinor === 1000,
    jpySpend.json?.data?.transaction
  );

  const afterSpend = await call("GET", `/api/accounts/${yen.id}`, jpyAuth);
  check("the yen balance drops by ¥1000", afterSpend.json?.data?.account?.balanceMinor === 99000);

  const jpySummary = await call("GET", "/api/analytics/summary", jpyAuth);
  check(
    "¥1000 of spending reports as ₹550",
    jpySummary.json?.data?.expenseMinor === 55000,
    jpySummary.json?.data
  );

  section("Rate freshness");

  const listed = await call("GET", "/api/fx/rates", jpyAuth);
  check("rates report their age", typeof listed.json?.data?.rates?.[0]?.ageHours === "number", listed.json?.data);
  check("a rate just set is not stale", listed.json?.data?.rates?.[0]?.stale === false);
  check("the configured provider is reported", typeof listed.json?.data?.provider === "string");

  const old = await call("PUT", "/api/fx/rates", {
    ...jpyAuth,
    body: {
      base: "JPY",
      quote: "INR",
      rate: 0.55,
      asOf: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
  });
  check("a rate can be backdated", old.status === 200, old.json);

  const stale = await call("GET", "/api/fx/rates", jpyAuth);
  check("a month-old rate is flagged stale", stale.json?.data?.rates?.[0]?.stale === true, stale.json?.data?.rates);
  check("and counted", stale.json?.data?.staleCount === 1, stale.json?.data);

  const staleWorth = await call("GET", "/api/analytics/net-worth", jpyAuth);
  check(
    "net worth still converts with a stale rate",
    staleWorth.json?.data?.totalMinor === Math.round(99000 * 0.55 * 100),
    staleWorth.json?.data
  );
  check(
    "but names the stale pair",
    staleWorth.json?.data?.staleRates?.[0]?.quote === "INR",
    staleWorth.json?.data?.staleRates
  );

  const refresh = await call("POST", "/api/fx/rates/refresh", jpyAuth);
  check("refresh returns 200", refresh.status === 200, refresh.json);
  check(
    "with no feed configured it reports that rather than failing",
    refresh.json?.data?.skipped === true,
    refresh.json?.data
  );
};
