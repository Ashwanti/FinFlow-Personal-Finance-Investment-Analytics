# FinFlow — Frontend

React + Vite UI for the [FinFlow API](../Finflow-backend/README.md).

**Done so far:** scaffold, the full auth flow, and a working dashboard.

---

## Running it

The backend must be running first (`cd ../Finflow-backend && npm run dev`).

```bash
cd Finflow-frontend
npm install
npm run dev          # http://localhost:5173
```

No `.env` is needed in development. If your backend is not on port 3000, copy
`.env.example` to `.env` and set `VITE_PROXY_TARGET`.

For data to look at, seed the API: `cd ../Finflow-backend && npm run seed`, then
sign in as **demo@finflow.test / Demo1234**.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with the API proxied |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output |

---

## Why the dev server proxies the API

`/api` and `/health` are proxied to the backend rather than called
cross-origin. That is not just tidiness — the refresh token lives in an
`httpOnly` cookie scoped to `/api/auth` with `SameSite=Lax`. Proxying makes the
browser see a single origin, so the cookie is sent with no CORS involved, no
`SameSite` edge cases, and no dependency on the backend's `CLIENT_ORIGIN`
matching whatever port Vite picked today.

If the built app is ever served from a different origin than the API, set
`VITE_API_URL` and add that origin to the backend's `CLIENT_ORIGIN`. The client
already sends `credentials: "include"` on every request, which is what the
backend's CORS config expects.

---

## How auth works

**The access token is a module variable in [apiClient.js](src/lib/apiClient.js) —
never `localStorage`.** Anything in `localStorage` is readable by any script
that ends up on the page and outlives the tab. In memory it dies with the page,
which is safe precisely because the refresh cookie can bring the session back.

**A page reload restores the session.** On boot, `AuthProvider` calls
`/api/auth/refresh` with no body at all — the cookie is the credential. Until
that settles the route guards render a spinner rather than deciding; routing on
"no user" too early would bounce a signed-in user to the login screen on every
refresh.

**A 401 triggers exactly one refresh and one retry.** The "one" is
load-bearing. The backend rotates refresh tokens and treats a replayed one as
theft — it revokes every session for that user. A dashboard firing six queries
at once, each refreshing independently, would look exactly like an attack and
log the user out. So all callers share a single in-flight refresh promise.

If the refresh itself fails, the client calls an `onAuthLost` handler that
clears the session and empties the React Query cache, so one user's data can
never survive into another's session.

---

## Layout

```
src/
├── lib/
│   ├── apiClient.js   the only place that talks to the API
│   ├── money.js       display helpers — minor units in, strings out
│   └── queryClient.js React Query defaults
├── auth/
│   ├── AuthContext.jsx  session state + silent restore
│   └── RouteGuards.jsx  RequireAuth / RequireGuest
├── components/        Layout, Field, Stat, Spinner
├── pages/             Login, Register, Dashboard
├── App.jsx            routes
└── main.jsx
```

---

## Money

The API sends **integer minor units** — `25050` means ₹250.50 — because floats
lose paise. That only holds if the frontend keeps the discipline: **divide for
display, never for arithmetic.** To total something, sum the minor units and
format once at the end.

`formatMoney(minor, currency)` in [money.js](src/lib/money.js) handles it,
including currencies whose minor unit is not two decimal places — the yen has
none, so ¥1000 is 1000 minor units and dividing by 100 would report a hundredth
of the real figure. The exponent table mirrors the backend's
`src/constants/currencies.js`; if you add a currency there, add it here.

`formatPercent` renders `null` as `—` rather than `0%`. The API returns `null`
for a savings rate when there was no income, and "0% saved" is a different
claim from "no income to save from".

---

## What the dashboard shows

One `GET /api/analytics/dashboard` call fills the whole page — that endpoint
exists so this is not six round trips.

It also surfaces things the API is careful to report and a UI could easily
swallow: money moved between your own accounts is called out as excluded from
income and spending; balances with no exchange rate are named rather than
silently dropped from the total; stale rates are flagged; and positions that
could not be priced are counted instead of being shown as worth nothing.

---

## Not built yet

Transactions, Accounts, Budgets and Portfolio are routed and render an honest
placeholder naming the endpoint behind them. Every one of those APIs is
finished and tested — only the screens are outstanding.

Transactions is the one to build next: it is where the app earns its keep daily,
and `GET /api/transactions` already supports filtering by type, account,
category, date range, tags, amount range and free text, with pagination.
