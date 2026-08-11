# Deploying FinFlow to Vercel

Frontend and API ship as **one Vercel project**, from one repository, on one
domain. The static build is served from the CDN and every `/api/*` request is
handled by a serverless function running the same Express app as local
development.

One origin is the whole point. The refresh token lives in an `httpOnly` cookie
scoped to `/api/auth`; splitting the UI and the API across two domains would
make that a third-party cookie, which Safari blocks outright and Chrome is
retiring. Same origin means the cookie simply works, and CORS never enters into
it.

---

## What you need first

**A hosted MongoDB.** A local `mongodb://127.0.0.1:27017` is unreachable from
Vercel's servers. The free Atlas M0 tier is enough, and — importantly — it is a
**replica set**, which the transfer endpoints require for multi-document
transactions. A standalone `mongod` cannot serve them atomically.

Creating it:

1. <https://cloud.mongodb.com> → create a free **M0** cluster
2. **Database Access** → add a user with a password → *Read and write to any database*
3. **Network Access** → add `0.0.0.0/0`
   Serverless functions have no fixed outbound IP, so there is no narrower rule
   to write. The database user's password is the actual control.
4. **Connect → Drivers** → copy the `mongodb+srv://…` string and put your
   database name in the path:
   `mongodb+srv://user:pass@cluster.xxxx.mongodb.net/finflow?retryWrites=true&w=majority`

---

## Environment variables

Set in **Settings → Environment Variables**, for Production and Preview both.

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | **yes** | The Atlas string above, including the database name |
| `JWT_ACCESS_SECRET` | **yes** | ≥32 chars; the API refuses to boot in production without it |
| `MONGO_AUTO_INDEX` | no | Defaults to `true`. See below |
| `CLIENT_ORIGIN` | no | Unused on one origin; set it only if you split them |
| `FX_PROVIDER` | no | `frankfurter` for live ECB rates, otherwise manual |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`NODE_ENV=production` is set by Vercel — don't add it. It is what turns on
`trust proxy` and the `secure` cookie flag.

**On `MONGO_AUTO_INDEX`:** it defaults to `true`, including in production, which
is a deliberate reversal of the usual advice. Index builds are idempotent and
trivial at this size, whereas a *missing* unique index is silent corruption —
two accounts sharing one email address, discovered months later. Turn it off and
manage indexes with a migration once the collections are big enough for a build
to cost something.

---

## Deploying

```bash
npx vercel link          # once
npx vercel deploy        # preview URL
npx vercel deploy --prod # production domain
```

Preview deployments sit behind Vercel's SSO by default, so they are visible to
you while signed in and to nobody else. Production is public.

Pushing to the connected GitHub repository deploys automatically: `main` to
production, every other branch to a preview.

---

## How the routing works

[`vercel.json`](vercel.json) is the whole of it:

```json
{ "source": "/api/:path*", "destination": "/api" }
{ "source": "/health",     "destination": "/api" }
{ "source": "/:path*",     "destination": "/index.html" }
```

Order matters. The last rule is the single-page-app fallback that makes a deep
link like `/transactions` reach React Router instead of 404ing, and it would
happily swallow the API too if it came first. Static assets are resolved from
the filesystem before any of these run.

[`api/index.js`](api/index.js) supplies the two things `src/server.js` normally
does and a lambda cannot: it connects to MongoDB before the app sees a request,
and it never calls `listen()`, because the platform owns the socket.

---

## Things that genuinely differ from a long-running server

**The background price and FX sync jobs do not run.** A serverless instance is
frozen between requests, so an interval either never fires or fires on whichever
instances happen to be warm. Prices are fetched lazily on read behind a TTL
cache, so the portfolio still values correctly — the job only ever warmed that
cache. If you want scheduled refreshes, Vercel Cron is the replacement.

**Rate limiting is per-instance.** `express-rate-limit` keeps its counters in
memory, and each lambda has its own. The 20-per-15-minutes login limit is
therefore per warm instance rather than global. Still useful, no longer a hard
ceiling; a shared store (Redis) is the fix if you need one.

**Cold starts.** The first request after idle pays for the container plus the
MongoDB handshake — typically a second or two. Warm requests do not: the
connection is cached in module scope, and `config/db.js` hands concurrent
callers the same in-flight promise rather than opening a second one.

---

## The npm lockfile, and why it has entries for Linux

Vite 8 builds with `rolldown` and `lightningcss`, both of which ship
per-platform native binaries as optional dependencies. npm records a lockfile
entry only for the platform that ran `npm install` ([npm/cli#4828]), so a
lockfile generated on Windows tells a Linux build that no binding exists — and
the build fails with `Cannot find native binding`.

The lockfile therefore carries the `linux-x64-gnu` and `linux-x64-musl` entries
alongside the Windows ones. If you regenerate it from scratch on Windows and a
Vercel build then fails that way, that is why.

[npm/cli#4828]: https://github.com/npm/cli/issues/4828

---

## If a deployment misbehaves

```bash
npx vercel ls finflow                 # find the deployment
npx vercel inspect <url> --logs       # build logs
npx vercel logs <url>                 # runtime logs
```

`GET /health` reports the database state separately from the server's, so it
distinguishes "the function is broken" from "the function is fine and Mongo is
not". A 503 with `"Database unavailable"` means `MONGODB_URI` is wrong, the
Atlas user's password is wrong, or Network Access does not include `0.0.0.0/0`.
