/* eslint-disable no-console */
/**
 * Phase 3 — analytics, plus the transfer-exclusion rule everything rests on.
 *
 * State arriving from the ledger suite:
 *   income   ₹5000.00  (500000)      expense  ₹250.50 (25050)
 *   transfer ₹1000.00  (100000) Bank -> Cash
 *   Bank 474950   Cash 120000   opening total 120000
 *
 * Net worth must be 120000 + 500000 - 25050 = 594950, with the transfer
 * contributing nothing.
 */
module.exports = async function analyticsSuite(ctx) {
  const { call, check, section, token, state } = ctx;
  const auth = { token };
  const { bank, cash, transfer } = state;

  const balanceOf = async (id) => {
    const res = await call("GET", `/api/accounts/${id}`, auth);
    return res.json?.data?.account?.balanceMinor;
  };

  section("Summary excludes transfers");

  const summaryRes = await call("GET", "/api/analytics/summary", auth);
  const summary = summaryRes.json?.data;
  check("returns a summary", summaryRes.status === 200, summaryRes.json);
  check("income counts only income rows", summary?.incomeMinor === 500000, summary);
  check("expense counts only expense rows", summary?.expenseMinor === 25050, summary);
  check("net is income minus expense", summary?.netMinor === 474950, summary);
  check("savings rate is 94.99%", summary?.savingsRatePct === 94.99, summary);
  check("counts 2 spendable transactions", summary?.transactionCount === 2, summary);
  check(
    "the ₹1000 transfer is NOT counted as income",
    summary?.incomeMinor === 500000,
    "a transfer leaking in would push income to 600000"
  );
  check(
    "the ₹1000 transfer is NOT counted as expense",
    summary?.expenseMinor === 25050,
    "a transfer leaking in would push expense to 125050"
  );
  check("transfer volume is reported separately", summary?.transferVolumeMinor === 100000, summary);
  check("transfer is counted once, not twice", summary?.transferCount === 1, summary);

  section("Spending by category");

  const byCatRes = await call("GET", "/api/analytics/spending-by-category", auth);
  const byCat = byCatRes.json?.data;
  check("returns category breakdown", byCatRes.status === 200, byCatRes.json);
  check("total matches the summary expense", byCat?.totalMinor === 25050, byCat);
  check("only expense categories appear", byCat?.categories?.length === 1, byCat?.categories);
  check("names the category", byCat?.categories?.[0]?.name === "Groceries", byCat?.categories?.[0]);
  check("shares sum to 100%", byCat?.categories?.[0]?.sharePct === 100, byCat?.categories?.[0]);
  check(
    "no transfer bucket appears",
    !byCat?.categories?.some((c) => c.name === "Uncategorised"),
    byCat?.categories
  );

  const incomeByCat = await call("GET", "/api/analytics/spending-by-category?type=INCOME", auth);
  check("can break down income too", incomeByCat.json?.data?.totalMinor === 500000, incomeByCat.json?.data);

  section("Cashflow");

  const flowRes = await call("GET", "/api/analytics/cashflow", auth);
  const flow = flowRes.json?.data;
  check("returns a cashflow series", flowRes.status === 200, flowRes.json);
  check("defaults to 6 monthly periods", flow?.series?.length === 6, flow?.series?.length);
  check(
    "empty months are filled, not skipped",
    flow?.series?.every((p) => typeof p.incomeMinor === "number" && typeof p.netMinor === "number"),
    flow?.series
  );

  const current = flow.series[flow.series.length - 1];
  check("the current month holds the income", current?.incomeMinor === 500000, current);
  check("the current month holds the expense", current?.expenseMinor === 25050, current);
  check("the current month nets correctly", current?.netMinor === 474950, current);

  const daily = await call("GET", "/api/analytics/cashflow?interval=day", auth);
  check("supports a daily interval", daily.json?.data?.interval === "day", daily.json?.data?.interval);

  const badRange = await call("GET", "/api/analytics/cashflow?from=2026-06-01&to=2026-01-01", auth);
  check("rejects an inverted date range", badRange.status === 400, badRange.json);

  section("Net worth");

  const worthRes = await call("GET", "/api/analytics/net-worth", auth);
  const worth = worthRes.json?.data;
  check("returns net worth", worthRes.status === 200, worthRes.json);
  check("equals the sum of account balances", worth?.totalMinor === 594950, worth);
  check(
    "equals opening + income - expense",
    worth?.totalMinor === 120000 + 500000 - 25050,
    "transfers must net to zero across the pair"
  );
  check("breaks down by account type", worth?.byType?.length === 2, worth?.byType);
  check("counts both accounts", worth?.accountCount === 2, worth);

  const trendRes = await call("GET", "/api/analytics/net-worth/trend?months=6", auth);
  const trend = trendRes.json?.data;
  check("returns a net worth trend", trendRes.status === 200, trendRes.json);
  check("has one point per month", trend?.series?.length === 6, trend?.series?.length);
  check("ends at the current net worth", trend?.series?.at(-1)?.netWorthMinor === 594950, trend?.series?.at(-1));
  check("starts before any activity", trend?.series?.[0]?.netWorthMinor === 120000, trend?.series?.[0]);

  section("Dashboard");

  const dashRes = await call("GET", "/api/analytics/dashboard", auth);
  const dash = dashRes.json?.data;
  check("returns a dashboard payload", dashRes.status === 200, dashRes.json);
  check("bundles the summary", dash?.summary?.netMinor === 474950);
  check("bundles top categories", Array.isArray(dash?.topCategories));
  check("bundles cashflow", dash?.cashflow?.length === 6);
  check("bundles net worth", dash?.netWorth?.totalMinor === 594950);
  check("bundles recent transactions", dash?.recentTransactions?.length === 4, {
    count: dash?.recentTransactions?.length,
  });

  section("Transfer edit and delete stay balanced");

  const editTransfer = await call("PATCH", `/api/transactions/transfer/${transfer.transferGroupId}`, {
    ...auth,
    body: { amount: 1500 },
  });
  check("edits a transfer with 200", editTransfer.status === 200, editTransfer.json);
  check("source reflects the new amount", (await balanceOf(bank.id)) === 424950);
  check("destination reflects the new amount", (await balanceOf(cash.id)) === 170000);

  const worthAfterEdit = await call("GET", "/api/analytics/net-worth", auth);
  check(
    "editing a transfer leaves net worth unchanged",
    worthAfterEdit.json?.data?.totalMinor === 594950,
    worthAfterEdit.json?.data
  );

  // Deleting one leg must remove the pair — a one-sided transfer is corruption.
  const legId = transfer.legs[0].id;
  const deleteLeg = await call("DELETE", `/api/transactions/${legId}`, auth);
  check("deleting one leg returns 200", deleteLeg.status === 200, deleteLeg.json);
  check("both legs are removed", deleteLeg.json?.data?.deleted === 2, deleteLeg.json?.data);

  check("source balance is restored", (await balanceOf(bank.id)) === 574950);
  check("destination balance is restored", (await balanceOf(cash.id)) === 20000);

  const gone = await call("GET", `/api/transactions/transfer/${transfer.transferGroupId}`, auth);
  check("the transfer is gone", gone.status === 404, gone.json);

  const finalWorth = await call("GET", "/api/analytics/net-worth", auth);
  check(
    "net worth survives the whole transfer lifecycle",
    finalWorth.json?.data?.totalMinor === 594950,
    finalWorth.json?.data
  );

  const finalSummary = await call("GET", "/api/analytics/summary", auth);
  check("income is still untouched", finalSummary.json?.data?.incomeMinor === 500000);
  check("expense is still untouched", finalSummary.json?.data?.expenseMinor === 25050);
  check("transfer volume drops to zero", finalSummary.json?.data?.transferVolumeMinor === 0);

  section("Balance repair");

  const repair = await call("POST", `/api/accounts/${bank.id}/recalculate`, auth);
  check("recalculate returns 200", repair.status === 200, repair.json);
  check("finds no drift on a healthy account", repair.json?.data?.driftMinor === 0, repair.json?.data);
  check("recomputes the same balance", repair.json?.data?.correctedMinor === 574950, repair.json?.data);

  section("Cross-user isolation");

  const stranger = await call("POST", "/api/auth/register", {
    body: {
      name: "Stranger",
      email: `stranger+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
    },
  });
  const strangerToken = stranger.json?.data?.accessToken;

  const peek = await call("GET", `/api/accounts/${bank.id}`, { token: strangerToken });
  check("another user cannot read your account", peek.status === 404, peek.json);

  const strangerAccounts = await call("GET", "/api/accounts", { token: strangerToken });
  check("a new user sees no accounts", strangerAccounts.json?.data?.accounts?.length === 0);

  const strangerWorth = await call("GET", "/api/analytics/net-worth", { token: strangerToken });
  check("a new user has zero net worth", strangerWorth.json?.data?.totalMinor === 0, strangerWorth.json?.data);

  const strangerSummary = await call("GET", "/api/analytics/summary", { token: strangerToken });
  check("analytics never leak across users", strangerSummary.json?.data?.incomeMinor === 0);
};
