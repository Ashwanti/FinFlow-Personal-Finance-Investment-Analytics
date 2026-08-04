# FinFlow — Backend API

Personal finance & investment analytics API. Node + Express 5 + MongoDB (Mongoose).

**All five phases are complete:** auth, the accounts/categories/transactions
ledger with correct transfer handling, analytics, budgets, and an investment
portfolio with FIFO cost basis and XIRR.

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
| `npm test` | 62 unit tests over the pure functions (no database) |
| `npm run smoke` | 289-check end-to-end test against an in-memory MongoDB |
| `npm run check` | Both of the above |
| `npm run seed` | Fill your database with 6 months of realistic demo data |

`npm test` runs in about a tenth of a second and covers the arithmetic — money
conversion, scaled quantities, FIFO cost splitting, XIRR, timezone boundaries.
`npm run smoke` needs no database and no configuration either; it drives the
real HTTP API end to end. Between them, `npm run check` is the fastest way to
confirm a change did not break anything.

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

## The three decisions everything rests on

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

### 3. Buying an investment is not spending either

The same mistake, one domain over. Paying ₹14,000 for shares does not make you
₹14,000 poorer — you swapped cash for something you still own. A trade is
therefore **not** a Transaction: it adjusts the broker account's cash balance
directly, and the position appears in net worth as market value.

The test that pins this down: after a ₹14,000 buy with a ₹20 fee, net worth
falls by exactly ₹20. The fee is real money gone; the ₹14,000 is not.

Fees are folded into cost basis, so a position only shows a profit once it has
covered what the trade actually cost.

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
and unwinds each month's movements. Investments are included: positions at any
past date are replayed exactly from trades, and priced from recorded snapshots
(see below). Each point carries `cashMinor`, `investmentsMinor`,
`investmentCostMinor` and an `investmentBasis` of `MARKET`, `COST`, `MIXED` or
`NONE`, so a rise is never mistaken for a gain that was really just the first
valuation arriving.

### Currencies

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/fx/rates` | Every rate you have set |
| `PUT` | `/fx/rates` | Set a rate for a pair (`{"base":"USD","quote":"INR","rate":83.5}`) |
| `DELETE` | `/fx/rates/:base/:quote` | Remove one |

Accounts, transactions and holdings each carry their own currency, and every
aggregate converts into your base currency before totalling. Adding ₹1,000 to
$1,000 and reporting 2,000 is the same class of error as counting a transfer as
income — a number that looks fine and is simply wrong.

**A missing rate is reported, never guessed.** Amounts the server cannot
convert are excluded from the total and listed under `unconverted` on the
response. An invented rate produces a confident, wrong net worth; an excluded
amount produces a total you know is partial.

Rates are per-user and stored as scaled integers — a rate multiplies every
figure it touches, so drift in it propagates everywhere. Inverses are derived
automatically (`USD/INR` also gives you `INR/USD`), and pairs you have not
entered are triangulated through your base currency where possible.

### Budgets

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/budgets` | Every budget with live progress |
| `POST` | `/budgets` | Create (`period`: `WEEKLY`, `MONTHLY`, `YEARLY`) |
| `GET` | `/budgets/overview` | Totals plus only the budgets needing attention |
| `GET` `PATCH` `DELETE` | `/budgets/:id` | Read / update / remove |

Budgets store only the rule. Spent, remaining, and status are computed on read
from the same aggregation the analytics endpoints use — so a transfer can never
consume a budget, and re-categorising a transaction is reflected immediately. A
stored running total would need updating on every create, edit, delete and
re-categorisation, and would rot the first time one of those paths missed it.

Status is `OK`, `WARNING` past 80%, `OVER` past 100%. `rollover: true` carries
unspent budget forward from every completed period since `startDate` — and the
carry is allowed to go negative, because overspending really does leave you
less to spend next month.

Add `?at=2026-06-15` to evaluate a budget as of a period that has already
closed.

### Investments

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/investments/portfolio` | Positions, valuation, allocation |
| `GET` | `/investments/performance` | XIRR, absolute return, realised/unrealised |
| `POST` | `/investments/prices/refresh` | Force a vendor refresh |
| `GET` `POST` | `/investments/holdings` | List / create positions |
| `GET` `PATCH` `DELETE` | `/investments/holdings/:id` | Manage a position |
| `POST` | `/investments/holdings/:id/rebuild` | Replay trades to repair a position |
| `GET` `POST` | `/investments/trades` | List / record buys and sells |
| `GET` `PATCH` `DELETE` | `/investments/trades/:id` | Manage a trade |

**Trades are the source of truth.** A holding's quantity, open lots and
realised profit are replayed from them on every change, rather than patched in
place. FIFO means editing or deleting a trade in the middle of the history
changes which lots later sales consumed, so unwinding one in place would mean
re-deriving everything after it anyway. Replaying cannot drift.

**Cost basis is FIFO.** Selling 10 of 30 shares bought at three different
prices has three different answers, and the one you use has tax consequences.
Lots store their *total* cost, not a per-unit figure — a rounded unit cost
multiplied back by the quantity loses paise on any lot whose cost does not
divide evenly.

**XIRR is the number that matters.** A simple percentage gain cannot tell
₹1,000 growing to ₹1,100 in a month from the same growth over three years. The
current market value is included as a closing inflow, otherwise the answer
would describe a portfolio you had already sold. It returns `null` — never a
fabricated `0` — when the flows cannot produce a rate (a single buy today, or
no trades at all).

Quantities are integers at 1e-8 scale for the same reason money is, and
price × quantity is computed in `BigInt`: a ₹1,00,000 share price times 100
units overflows Number's exact integer range, which would quietly round the
portfolio value of anyone holding a mid-sized position.

#### Prices

Holdings default to `priceProvider: "manual"` — you set `manualPrice`, nothing
touches the network, and no API key exists to leak. This is also the only
workable option for unlisted holdings and many Indian mutual funds.

`coingecko` is a real, keyless adapter for crypto. It needs `providerSymbol`
set to CoinGecko's own id (`"bitcoin"`, not `"BTC"`), which is required at
creation time because a lookup keyed on the wrong identifier fails silently
forever.

Prices are cached with an explicit `asOf` and served for `PRICE_CACHE_TTL_MINUTES`
before the vendor is asked again. When a vendor fails, the last known price is
returned marked `stale: true` with the error attached — a valuation from an
hour ago beats refusing to value the position. A holding with no usable price
is reported `isPriced: false` with a `null` market value, excluded from net
worth and from allocation percentages, so "worth nothing" stays
distinguishable from "unknown".

Every price established — from a vendor or set by hand — is also written to a
daily **snapshot**, which is what makes the historical net worth trend possible.
A live quote only tells you what something is worth now; what it was worth in
March cannot be reconstructed afterwards, so it has to be recorded as it
happens. Snapshots start from the day an instrument is first priced, and the
trend carries anything earlier at cost rather than back-filling today's price
across months it was never worth that much.

Set `PRICE_SYNC_ENABLED=true` to run the background refresh. It is **safe on
more than one instance**: each tick takes a lease in MongoDB and only the winner
does the work. Without that, every instance refreshes every symbol on its own
timer and the vendor sees N times the traffic, so a free tier's rate limit
arrives N times sooner. The lease expires, so an instance that dies mid-run
cannot wedge the job — the guarantee is "almost always one runner", which is the
right level for refreshing a cache. Anything needing exactly-once wants a real
queue.

Adding an equity provider means writing a module with the same shape as
[coingecko.provider.js](src/services/price/coingecko.provider.js) and listing
it in [price/index.js](src/services/price/index.js).

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

## Known limits

Worth knowing before this goes anywhere real:

**Rates are whatever you enter.** There is no FX feed, so conversions are only
as current as the rates you set — and a stale rate quietly misstates every
converted total. The fix is an adapter alongside the price providers.

**Historical prices only exist from the day you start recording them.** Trend
points before an instrument was first priced are carried at cost and labelled
`COST`. Nothing back-fills them, because nothing honestly can.

**The job lease is a lease, not a mutex.** It expires, so in a pathological case
— a process pausing longer than the TTL mid-run — two instances could overlap.
That is the right trade for refreshing a price cache and the wrong one for
anything with side effects that must not repeat.

**Minor units are assumed to share an exponent.** Every currency here is
two-decimal. A zero-decimal currency like JPY would convert incorrectly.

---

## What comes next

The foundations are done; these all build on them without new infrastructure:

- **CSV import** for bank and broker statements. The ledger and the FIFO engine
  already handle anything an import would produce — the work is parsing and
  de-duplication.
- **Recurring transactions.** Rent and salary are already regular in the seed
  data and could be generated rather than typed.
- **Goals** — a target amount and date, with progress read from the net worth
  series that already exists.
- **An equity price provider**, so Indian stocks and mutual funds get live
  valuations instead of manual ones. Write a module shaped like the CoinGecko
  adapter and register it. The same seam suits an FX feed.
- **Export and reporting.** The aggregations exist; this is formatting.
