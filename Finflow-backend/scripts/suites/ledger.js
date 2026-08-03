/* eslint-disable no-console */
/**
 * Phase 2 — accounts, categories, transactions and (above all) transfers.
 *
 * The numbers below are chosen so every balance is exact and checkable by hand:
 *   Bank opens at ₹1000.00 (100000)   Cash opens at ₹200.00 (20000)
 *   expense ₹250.50 (25050)           income ₹5000.00 (500000)
 *   transfer ₹1000.00 (100000) Bank -> Cash
 */
module.exports = async function ledgerSuite(ctx) {
  const { call, check, section, token } = ctx;
  const auth = { token };

  const balanceOf = async (id) => {
    const res = await call("GET", `/api/accounts/${id}`, auth);
    return res.json?.data?.account?.balanceMinor;
  };

  section("Accounts");

  const bankRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "HDFC Savings", type: "BANK", openingBalanceMinor: 100000 },
  });
  check("creates an account with 201", bankRes.status === 201, bankRes.json);
  check("opening balance seeds the running balance", bankRes.json?.data?.account?.balanceMinor === 100000);
  check("inherits the user's base currency", bankRes.json?.data?.account?.currency === "INR");
  const bank = bankRes.json?.data?.account ?? {};

  const cashRes = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "Cash Wallet", type: "CASH", openingBalanceMinor: 20000 },
  });
  check("creates a second account", cashRes.status === 201, cashRes.json);
  const cash = cashRes.json?.data?.account ?? {};

  const dupeAccount = await call("POST", "/api/accounts", {
    ...auth,
    body: { name: "HDFC Savings", type: "BANK" },
  });
  check("rejects a duplicate account name with 409", dupeAccount.status === 409, dupeAccount.json);

  const badId = await call("GET", "/api/accounts/not-an-id", auth);
  check("rejects a malformed id with 400", badId.status === 400, badId.json);

  const accountList = await call("GET", "/api/accounts", auth);
  check("lists both accounts", accountList.json?.data?.accounts?.length === 2, accountList.json);

  section("Categories");

  const cats = await call("GET", "/api/categories", auth);
  check("registration seeded default categories", cats.json?.data?.categories?.length >= 10, {
    count: cats.json?.data?.categories?.length,
  });

  const expenseCats = await call("GET", "/api/categories?kind=EXPENSE", auth);
  check(
    "filters categories by kind",
    expenseCats.json?.data?.categories?.every((c) => c.kind === "EXPENSE"),
    expenseCats.json
  );

  const all = cats.json?.data?.categories ?? [];
  const groceries = all.find((c) => c.name === "Groceries");
  const salary = all.find((c) => c.name === "Salary");
  check("seeds an income and an expense category", !!groceries && !!salary);

  const dupeCat = await call("POST", "/api/categories", {
    ...auth,
    body: { name: "Groceries", kind: "EXPENSE" },
  });
  check("rejects a duplicate category with 409", dupeCat.status === 409, dupeCat.json);

  const sameNameOtherKind = await call("POST", "/api/categories", {
    ...auth,
    body: { name: "Groceries", kind: "INCOME" },
  });
  check(
    "allows the same name on the other side of the ledger",
    sameNameOtherKind.status === 201,
    sameNameOtherKind.json
  );

  section("Transactions");

  const bothAmounts = await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: groceries.id,
      amount: 250.5,
      amountMinor: 25050,
      date: new Date().toISOString(),
    },
  });
  check("rejects both amount spellings at once", bothAmounts.status === 400, bothAmounts.json);

  const noAmount = await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: groceries.id,
      date: new Date().toISOString(),
    },
  });
  check("rejects a transaction with no amount", noAmount.status === 400, noAmount.json);

  const wrongKind = await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: salary.id,
      amount: 100,
      date: new Date().toISOString(),
    },
  });
  check("rejects an income category on an expense", wrongKind.status === 400, wrongKind.json);

  const expenseRes = await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "EXPENSE",
      accountId: bank.id,
      categoryId: groceries.id,
      amount: 250.5,
      date: new Date().toISOString(),
      description: "Weekly groceries",
      tags: ["essentials"],
    },
  });
  check("creates an expense with 201", expenseRes.status === 201, expenseRes.json);
  check(
    "converts 250.50 to 25050 minor units",
    expenseRes.json?.data?.transaction?.amountMinor === 25050,
    expenseRes.json?.data?.transaction
  );
  check("an expense lowers the balance", (await balanceOf(bank.id)) === 74950);
  const expenseTxn = expenseRes.json?.data?.transaction ?? {};

  const incomeRes = await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "INCOME",
      accountId: bank.id,
      categoryId: salary.id,
      amountMinor: 500000,
      date: new Date().toISOString(),
      description: "August salary",
    },
  });
  check("creates income with 201", incomeRes.status === 201, incomeRes.json);
  check("income raises the balance", (await balanceOf(bank.id)) === 574950);

  const listRes = await call("GET", "/api/transactions?limit=10", auth);
  check("lists transactions with pagination", listRes.json?.data?.pagination?.total === 2, listRes.json?.data?.pagination);
  check("populates the category", !!listRes.json?.data?.items?.[0]?.category?.name);

  const searchRes = await call("GET", "/api/transactions?search=groceries", auth);
  check("searches descriptions", searchRes.json?.data?.pagination?.total === 1, searchRes.json?.data?.pagination);

  const filterRes = await call("GET", `/api/transactions?type=EXPENSE&accountId=${bank.id}`, auth);
  check("filters by type and account", filterRes.json?.data?.pagination?.total === 1);

  section("Editing rebalances correctly");

  const edited = await call("PATCH", `/api/transactions/${expenseTxn.id}`, {
    ...auth,
    body: { amount: 300 },
  });
  check("updates an amount with 200", edited.status === 200, edited.json);
  // 574950 + 25050 (undo) - 30000 (redo) = 570000
  check("balance follows the edited amount", (await balanceOf(bank.id)) === 570000);

  const moved = await call("PATCH", `/api/transactions/${expenseTxn.id}`, {
    ...auth,
    body: { accountId: cash.id },
  });
  check("moves a transaction between accounts", moved.status === 200, moved.json);
  check("the old account is credited back", (await balanceOf(bank.id)) === 600000);
  check("the new account is debited", (await balanceOf(cash.id)) === -10000);

  const movedBack = await call("PATCH", `/api/transactions/${expenseTxn.id}`, {
    ...auth,
    body: { accountId: bank.id, amount: 250.5 },
  });
  check("restores the original state", movedBack.status === 200, movedBack.json);
  check("bank is back to 574950", (await balanceOf(bank.id)) === 574950);
  check("cash is back to 20000", (await balanceOf(cash.id)) === 20000);

  section("Transfers");

  const sameAccount = await call("POST", "/api/transactions/transfer", {
    ...auth,
    body: {
      fromAccountId: bank.id,
      toAccountId: bank.id,
      amount: 100,
      date: new Date().toISOString(),
    },
  });
  check("refuses a transfer to the same account", sameAccount.status === 400, sameAccount.json);

  const asPlain = await call("POST", "/api/transactions", {
    ...auth,
    body: {
      type: "TRANSFER",
      accountId: bank.id,
      categoryId: groceries.id,
      amount: 100,
      date: new Date().toISOString(),
    },
  });
  check("refuses to create a transfer as a plain transaction", asPlain.status === 400, asPlain.json);

  const transferRes = await call("POST", "/api/transactions/transfer", {
    ...auth,
    body: {
      fromAccountId: bank.id,
      toAccountId: cash.id,
      amount: 1000,
      date: new Date().toISOString(),
      description: "ATM withdrawal",
    },
  });
  check("creates a transfer with 201", transferRes.status === 201, transferRes.json);

  const transfer = transferRes.json?.data?.transfer ?? {};
  const legs = transfer.legs ?? [];
  check("writes exactly two legs", legs.length === 2, legs.length);
  check(
    "both legs share one transferGroupId",
    legs.length === 2 && legs[0].transferGroupId === legs[1].transferGroupId
  );
  check("both legs are typed TRANSFER", legs.length === 2 && legs.every((leg) => leg.type === "TRANSFER"));
  check("neither leg carries a category", legs.length === 2 && legs.every((leg) => leg.category === null));
  check(
    "one leg is OUT and one is IN",
    legs.filter((l) => l.transferDirection === "OUT").length === 1 &&
      legs.filter((l) => l.transferDirection === "IN").length === 1
  );
  check(
    "each leg points at the other account",
    legs.length === 2 && legs.every((leg) => !!leg.counterAccount)
  );

  check("source account is debited", (await balanceOf(bank.id)) === 474950);
  check("destination account is credited", (await balanceOf(cash.id)) === 120000);

  ctx.state = { bank, cash, groceries, salary, transfer, expenseTxn };
};
