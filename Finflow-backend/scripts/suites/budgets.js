/* eslint-disable no-console */
/**
 * Phase 4 — budgets.
 *
 * Runs on its own user so the figures stay exact. Groceries budget ₹5000
 * (500000), against which the suite spends deliberately chosen amounts.
 */
module.exports = async function budgetSuite(ctx) {
  const { call, check, section } = ctx;

  const owner = await call("POST", "/api/auth/register", {
    body: {
      name: "Budget Owner",
      email: `budget+${Date.now()}@smoke.test`,
      password: "Passw0rd123",
    },
  });
  const auth = { token: owner.json?.data?.accessToken };

  const accountRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Budget Bank", type: "BANK", openingBalanceMinor: 10_000_00 },
  });
  const account = accountRes.json?.data?.account ?? {};

  const cats = await call("GET", "/api/categories", auth);
  const all = cats.json?.data?.categories ?? [];
  const groceries = all.find((c) => c.name === "Groceries");
  const transport = all.find((c) => c.name === "Transport");
  const salary = all.find((c) => c.name === "Salary");

  const spend = (categoryId, amount, description) =>
    call("POST", "/api/transactions", {
      ...auth,
      body: {
        type: "EXPENSE",
        accountId: account.id,
        categoryId,
        amount,
        date: new Date().toISOString(),
        description,
      },
    });

  section("Creating budgets");

  const onIncome = await call("POST", "/api/budgets", {
    ...auth,
    body: { categoryId: salary.id, amount: 1000 },
  });
  check("refuses to budget an income category", onIncome.status === 400, onIncome.json);

  const created = await call("POST", "/api/budgets", {
    ...auth,
    body: { categoryId: groceries.id, amount: 5000, period: "MONTHLY" },
  });
  check("creates a budget with 201", created.status === 201, created.json);
  check("converts 5000 to 500000 minor units", created.json?.data?.budget?.amountMinor === 500000);
  check("starts with nothing spent", created.json?.data?.budget?.spentMinor === 0);
  check("starts at status OK", created.json?.data?.budget?.status === "OK");
  check("reports the full amount remaining", created.json?.data?.budget?.remainingMinor === 500000);
  const budget = created.json?.data?.budget ?? {};

  const dupe = await call("POST", "/api/budgets", {
    ...auth,
    body: { categoryId: groceries.id, amount: 3000, period: "MONTHLY" },
  });
  check("rejects a duplicate budget with 409", dupe.status === 409, dupe.json);

  section("Spending moves the budget");

  await spend(groceries.id, 1000, "Groceries week 1");
  const after1000 = await call("GET", `/api/budgets/${budget.id}`, auth);
  check("tracks spend against the cap", after1000.json?.data?.budget?.spentMinor === 100000);
  check("computes remaining", after1000.json?.data?.budget?.remainingMinor === 400000);
  check("computes used percentage", after1000.json?.data?.budget?.usedPct === 20);
  check("stays OK at 20%", after1000.json?.data?.budget?.status === "OK");

  // Spending in another category must not touch this budget.
  await spend(transport.id, 2000, "Cab fares");
  const isolated = await call("GET", `/api/budgets/${budget.id}`, auth);
  check(
    "another category's spending is ignored",
    isolated.json?.data?.budget?.spentMinor === 100000,
    isolated.json?.data?.budget
  );

  await spend(groceries.id, 3200, "Groceries week 2");
  const atRisk = await call("GET", `/api/budgets/${budget.id}`, auth);
  check("crosses into WARNING at 84%", atRisk.json?.data?.budget?.status === "WARNING", atRisk.json?.data?.budget);
  check("used percentage is 84", atRisk.json?.data?.budget?.usedPct === 84);

  await spend(groceries.id, 1500, "Groceries week 3");
  const over = await call("GET", `/api/budgets/${budget.id}`, auth);
  check("flags OVER past the cap", over.json?.data?.budget?.status === "OVER", over.json?.data?.budget);
  check("remaining goes negative", over.json?.data?.budget?.remainingMinor === -70000);
  check("used percentage exceeds 100", over.json?.data?.budget?.usedPct === 114);
  check("daily allowance floors at zero", over.json?.data?.budget?.dailyAllowanceMinor === 0);

  section("Transfers never consume a budget");

  const second = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Budget Cash", type: "CASH", openingBalanceMinor: 0 },
  });
  const cash = second.json?.data?.account ?? {};

  const beforeTransfer = await call("GET", `/api/budgets/${budget.id}`, auth);
  await call("POST", "/api/transactions/transfer", {
    ...auth,
    body: {
      fromAccountId: account.id,
      toAccountId: cash.id,
      amount: 4000,
      date: new Date().toISOString(),
      description: "ATM withdrawal",
    },
  });
  const afterTransfer = await call("GET", `/api/budgets/${budget.id}`, auth);
  check(
    "a ₹4000 transfer does not touch the grocery budget",
    afterTransfer.json?.data?.budget?.spentMinor ===
      beforeTransfer.json?.data?.budget?.spentMinor,
    { before: beforeTransfer.json?.data?.budget?.spentMinor, after: afterTransfer.json?.data?.budget?.spentMinor }
  );

  section("Overview and alerts");

  await call("POST", "/api/budgets", {
    ...auth,
    body: { categoryId: transport.id, amount: 10000, period: "MONTHLY" },
  });

  const overview = await call("GET", "/api/budgets/overview", auth);
  const data = overview.json?.data;
  check("returns an overview", overview.status === 200, overview.json);
  check("counts both budgets", data?.budgetCount === 2, data);
  check("totals the caps", data?.budgetedMinor === 500000 + 1000000, data);
  check("totals the spend", data?.spentMinor === 570000 + 200000, data);
  check("counts the over-budget one", data?.overBudgetCount === 1, data);
  check("raises an alert for it", data?.alerts?.length === 1, data?.alerts);
  check("the alert names the overspend", data?.alerts?.[0]?.overspendMinor === 70000, data?.alerts?.[0]);
  check("orders the list most-used first", data?.budgets?.[0]?.status === "OVER", data?.budgets?.[0]);

  section("Rollover");

  const rollover = await call("POST", "/api/budgets", {
    ...auth,
    body: {
      categoryId: transport.id,
      amount: 2000,
      period: "WEEKLY",
      rollover: true,
    },
  });
  check("creates a weekly rollover budget", rollover.status === 201, rollover.json);
  check(
    "a budget starting this period carries nothing",
    rollover.json?.data?.budget?.rolloverMinor === 0,
    rollover.json?.data?.budget
  );
  check(
    "available equals the cap with no carry",
    rollover.json?.data?.budget?.availableMinor === 200000,
    rollover.json?.data?.budget
  );

  section("Editing and deleting");

  const raised = await call("PATCH", `/api/budgets/${budget.id}`, {
    ...auth,
    body: { amount: 8000 },
  });
  check("raises the cap with 200", raised.status === 200, raised.json);
  check("recomputes against the new cap", raised.json?.data?.budget?.remainingMinor === 230000);
  // 570000 of 800000 is 71.25%, below the 80% warning line.
  check("recomputes the share used", raised.json?.data?.budget?.usedPct === 71.25, raised.json?.data?.budget);
  check("clears the overspend", raised.json?.data?.budget?.status === "OK", raised.json?.data?.budget);

  const emptyPatch = await call("PATCH", `/api/budgets/${budget.id}`, { ...auth, body: {} });
  check("empty PATCH is rejected", emptyPatch.status === 400, emptyPatch.json);

  const removed = await call("DELETE", `/api/budgets/${budget.id}`, auth);
  check("deletes a budget", removed.status === 200, removed.json);

  const gone = await call("GET", `/api/budgets/${budget.id}`, auth);
  check("the budget is gone", gone.status === 404, gone.json);

  const stranger = await call("GET", "/api/budgets", {
    token: (
      await call("POST", "/api/auth/register", {
        body: {
          name: "Nosy",
          email: `nosy+${Date.now()}@smoke.test`,
          password: "Passw0rd123",
        },
      })
    ).json?.data?.accessToken,
  });
  check("budgets never leak across users", stranger.json?.data?.budgets?.length === 0, stranger.json?.data);
};
