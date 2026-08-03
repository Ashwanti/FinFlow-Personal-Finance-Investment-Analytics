# FinFlow — Backend API

Personal finance & investment analytics API. Node + Express 5 + MongoDB (Mongoose).

**Phases 1–3 are complete:** auth, the accounts/categories/transactions ledger
with correct transfer handling, and analytics on top of it.

---

## Getting started

```bash
cd Finflow-backend
npm install
cp .env.example .env          # then edit it
npm run dev
```

Generate a real signing secret before you start:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste it into `JWT_ACCESS_SECRET`. The server refuses to boot without it, and
refuses to boot in production if it is shorter than 32 characters.

For `MONGODB_URI`, either run MongoDB locally (`mongodb://127.0.0.1:27017/finflow`)
or create a free cluster on MongoDB Atlas.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon, reloading on change |
| `npm start` | Start for production |
| `npm run smoke` | 144-check end-to-end test against an in-memory MongoDB |
| `npm run seed` | Fill your database with 6 months of realistic demo data |

`npm run smoke` needs no database and no configuration — it is the fastest way
to confirm a change did not break anything.

`npm run seed` creates `demo@finflow.test` / `Demo1234` with four accounts and
~90 transactions, so the frontend has something real to render. Re-running
rebuilds that user's data and touches no one else.

> **Transfers need MongoDB transactions, which need a replica set.** Atlas and
> `MongoMemoryReplSet` provide one; a standalone local `mongod` does not. On
> standalone the API still works — it prints a warning once and runs multi-step
> writes non-atomically.

---

## Layout

```
src/
├── config/        env.js (validated config), db.js (Mongoose connection)
├── constants/     enums + the default category set
├── models/        user, refreshToken, account, category, transaction
├── validators/    Zod request schemas
├── middleware/    auth, validate, rate limiting, error handling
├── services/      business logic — no req/res in here
├── controllers/   HTTP only — read the request, call a service, respond
├── routes/        URL → middleware → controller
├── utils/         ApiError, money, dates, withTransaction
├── app.js
└── server.js
```

**Controllers never query the database; services never touch `req` or `res`.**
That is what lets the analytics aggregations be tested directly.

Express 5 forwards rejected promises from async handlers to the error middleware
automatically, so controllers need no `try/catch`.

---

## The two decisions everything rests on

### 1. Money is stored as integers

Every amount is `amountMinor` — paise or cents — never a float.
`0.1 + 0.2 === 0.30000000000000004` in JavaScript, and that error compounds
across thousands of rows until reported totals stop matching reality.
`amountMinor: 25050` means ₹250.50.

The API accepts either spelling on input and converts immediately:

```jsonc
{ "amount": 250.50 }      // convenient for a form field
{ "amountMinor": 25050 }  // canonical
```

Sending both is a 400 — silently picking a winner would be worse.

### 2. Transfers are two rows, and are excluded from spending

Moving ₹10,000 from savings to checking is **neither income nor expense**. You
are exactly as rich afterwards. Model it as two ordinary transactions and your
dashboard will claim you earned ₹10,000 you never earned and spent ₹10,000 you
never spent — and every percentage on the page becomes wrong.

FinFlow stores a transfer as two rows sharing a `transferGroupId`: an `OUT` leg
on the source account and an `IN` leg on the destination. Both are typed
`TRANSFER`, which is what makes them excludable from every aggregate with a
single filter (`SPENDABLE_TYPES` in [src/constants](src/constants/index.js)).

Consequences enforced in code and covered by tests:

- Transfers cannot carry a category; income and expense must have one.
- `POST /api/transactions` refuses `type: "TRANSFER"` — use the transfer endpoint.
- Deleting **either** leg deletes both. A one-sided transfer is corruption.
- Editing a transfer moves both balances.
- Net worth is unchanged by any transfer, at every point in its lifecycle.

---

## Response shape

```jsonc
// success
{ "success": true, "data": { ... } }

// failure
{ "success": false, "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Enter a valid email address" }] }
```

---

## API

Base URL `http://localhost:3000/api`. Everything except `/health` and
`/auth/*` requires `Authorization: Bearer <accessToken>`.

### Auth & profile

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + database state |
| `POST` | `/auth/register` | Create an account (seeds 14 default categories) |
| `POST` | `/auth/login` | Exchange credentials for a session |
| `POST` | `/auth/refresh` | Rotate for a new token pair |
| `POST` | `/auth/logout` | Revoke the current session |
| `POST` | `/auth/logout-all` | Revoke every session |
| `POST` | `/auth/change-password` | Change password, revoke other sessions |
| `GET` `PATCH` | `/me` | Read / update profile |

### Accounts

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/accounts?includeArchived=false` | List with live balances |
| `POST` | `/accounts` | Create (`BANK`, `CASH`, `WALLET`, `CREDIT_CARD`, `INVESTMENT`) |
| `GET` `PATCH` `DELETE` | `/accounts/:id` | Read / update / remove |
| `POST` | `/accounts/:id/recalculate` | Rebuild the balance from history |

Balances are maintained incrementally in the same write as the transaction.
`recalculate` is the repair path, reporting any drift it corrects.

An account with transactions is **archived** rather than deleted, so history is
never orphaned. The same applies to categories.

### Categories

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/categories?kind=EXPENSE` | List |
| `POST` | `/categories` | Create (`kind`: `INCOME` or `EXPENSE`) |
| `PATCH` `DELETE` | `/categories/:id` | Update / remove |

A category belongs to one side of the ledger, so "Salary" can never be selected
on an expense. Changing `kind` is blocked once transactions exist.

### Transactions

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/transactions` | List, filtered + paginated |
| `POST` | `/transactions` | Create income or expense |
| `GET` `PATCH` `DELETE` | `/transactions/:id` | Read / update / remove |
| `POST` | `/transactions/transfer` | Create a transfer (both legs) |
| `GET` `PATCH` `DELETE` | `/transactions/transfer/:groupId` | Read / update / remove a transfer |

List filters: `type`, `accountId`, `categoryId`, `from`, `to`, `search`, `tags`,
`minAmountMinor`, `maxAmountMinor`, `page`, `limit`.

### Analytics

| Method | Endpoint | Returns |
|---|---|---|
| `GET` | `/analytics/dashboard` | Everything below in one round trip |
| `GET` | `/analytics/summary` | Income, expense, net, savings rate |
| `GET` | `/analytics/spending-by-category` | Breakdown with each slice's share |
| `GET` | `/analytics/cashflow?interval=month` | Time series, empty periods filled |
| `GET` | `/analytics/net-worth` | Assets, liabilities, total, by account type |
| `GET` | `/analytics/net-worth/trend?months=12` | Net worth at each month end |

Ranges default to the current month in **the user's timezone** — truncating in
UTC would push the first 5.5 hours of every Indian month into the previous one.

`summary` reports `transferVolumeMinor` separately so the number is visible
without polluting income or expense. `savingsRatePct` is `null`, not `0`, when
there was no income — "0% saved" would be a claim the data cannot support.

Net worth has no stored history; the trend walks backwards from today's balance
and unwinds each month's movements.

### Examples

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"Passw0rd123"}'

TOKEN=<accessToken from the response>

# Create an account
curl -X POST http://localhost:3000/api/accounts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"HDFC Savings","type":"BANK","openingBalanceMinor":100000}'

# Record an expense
curl -X POST http://localhost:3000/api/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"EXPENSE","accountId":"<id>","categoryId":"<id>",
       "amount":250.50,"date":"2026-08-03","description":"Groceries"}'

# Move money between your own accounts
curl -X POST http://localhost:3000/api/transactions/transfer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fromAccountId":"<id>","toAccountId":"<id>","amount":1000,
       "date":"2026-08-03","description":"ATM withdrawal"}'

# Dashboard
curl "http://localhost:3000/api/analytics/dashboard" -H "Authorization: Bearer $TOKEN"
```

---

## Token design

**Access tokens** are stateless JWTs valid 15 minutes. They cannot be revoked
early, which is why they are short-lived.

**Refresh tokens** are opaque random strings stored as SHA-256 hashes, valid 7
days. Because the server holds a record, they can be revoked instantly. A fast
hash suffices — the token is already high-entropy; bcrypt is reserved for
passwords, which are human-chosen and weak.

**Rotation with reuse detection.** Every `/auth/refresh` invalidates the token
presented and issues a new one. If an already-rotated token comes back, the only
explanations are theft or replay, so every session for that user is revoked.

The refresh token is delivered both as an `httpOnly` cookie scoped to
`/api/auth` (the safe default for browsers) and in the JSON body (for clients
that cannot use cookies). A browser frontend should use the cookie.

Other properties: bcrypt work factor 12; `passwordHash` is `select: false`;
login returns one message for both "no such user" and "wrong password" and runs
a dummy comparison on unknown emails so timing does not leak which addresses are
registered; `requireAuth` re-fetches the user each request so a deleted account
stops working immediately; rate limiting 20/15min on login and register.

---

## Frontend integration

CORS runs with `credentials: true`, so the browser must opt in:

```js
fetch("http://localhost:3000/api/auth/login", {
  method: "POST",
  credentials: "include",          // required for the refresh cookie
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
```

Keep the access token in memory (context or store) rather than `localStorage`,
and on a `401` call `/auth/refresh` once and retry.

Format money for display by dividing by 100 — or use `formatMinor` from
[src/utils/money.js](src/utils/money.js). Never do arithmetic on the divided value.

---

## What comes next

**Phase 4 — Budgets.** Per-category monthly caps with overspend alerts. This
reuses the aggregation in `analytics.service.spendingByCategory` almost
unchanged; the new work is the budget model and the alert rule.

**Phase 5 — Investments.** Holdings, buy/sell lots, live prices, XIRR and asset
allocation. Deliberately last: it is the only domain needing an external price
API, background sync jobs, caching and rate-limit handling. The `INVESTMENT`
account type and `Zerodha` seed account are already in place for it.
