# FinFlow

Personal finance and investment analytics. Track what you spend, budget against
it, and see what your investments are actually returning — in one place.

Node + Express 5 + MongoDB on the back, React + Vite on the front.

---

## Getting started

```bash
npm install            # installs both packages

cp Finflow-backend/.env.example Finflow-backend/.env
# generate a signing secret and paste it into JWT_ACCESS_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run seed           # 6 months of realistic demo data (optional)
npm run dev            # API on :3000, UI on :5173
```

Sign in as **demo@finflow.test / Demo1234** if you seeded.

You need MongoDB running — locally, or a free Atlas cluster. Point
`MONGODB_URI` at it.

> Transfers and trades use multi-document transactions, which need a replica
> set. Atlas provides one; a standalone local `mongod` does not. The API still
> works on standalone — it warns once and runs those writes non-atomically.

### Scripts

Run from the repo root; each delegates to whichever package owns it.

| Command | What it does |
|---|---|
| `npm run dev` | API and UI together |
| `npm run dev:api` / `dev:web` | One at a time |
| `npm run seed` | Fill the database with demo data |
| `npm test` | 82 unit tests over the pure functions (no database) |
| `npm run smoke` | 314-check end-to-end API test on an in-memory MongoDB |
| `npm run check` | Both of the above |
| `npm run build` | Production build of the UI |

`npm run smoke` needs no database and no configuration — it is the fastest way
to confirm a change did not break anything.

---

## Layout

```
Finflow-backend/    Express API, MongoDB, background jobs   → README
Finflow-frontend/   React UI, Vite dev proxy                → README
```

Each has its own README with the detail; the rest of this file is the part that
spans both.

---

## The ideas the codebase is built on

**Money is stored as integers.** Every amount is minor units — paise, cents —
never a float. `0.1 + 0.2` is `0.30000000000000004` in JavaScript, and that
error compounds across thousands of rows until the totals stop matching
reality. The frontend keeps the same discipline: divide for display, never for
arithmetic.

**Minor units are per currency.** The yen has no subunit, so ¥1000 is 1000
minor units; Kuwait quotes three decimals. Assuming two everywhere reports a JPY
balance at a hundredth of its value.

**Moving money between things you own is not spending.** A transfer between two
of your own accounts is neither income nor expense — you are exactly as rich
afterwards. Model it as two ordinary transactions and the dashboard claims you
earned money you never earned and spent money you never spent. Transfers are
two linked rows excluded from every spending aggregate.

**Buying an investment is not spending either.** Same mistake, one domain over.
Paying ₹14,000 for shares does not make you ₹14,000 poorer; you swapped cash
for something you still own. After a purchase, net worth falls by the fee
alone.

**Say what is not known.** A price that could not be fetched, a currency with no
exchange rate, a rate that has gone stale — each is reported rather than
guessed at or quietly rounded to zero. "Worth nothing" and "unknown" are
different claims, and a finance tool that conflates them is worse than one that
admits the gap.

---

## Status

The API is complete and tested: auth, accounts, categories, transactions,
analytics, budgets, investments with FIFO cost basis and XIRR, multi-currency
with an exchange-rate feed, and background price sync.

The UI has the auth flow and a working dashboard. Transactions, accounts,
budgets and portfolio screens are still to build — every endpoint behind them is
finished.
