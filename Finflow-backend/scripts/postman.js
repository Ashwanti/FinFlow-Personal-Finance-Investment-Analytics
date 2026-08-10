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
console.log(`Wrote ${count} requests across ${collection.item.length} folders to ${OUT_DIR}`);
