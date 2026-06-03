# subscription_reconciler

Reconciles user entitlements from store, marketplace, and carrier sources into one row per user.

## Run

```
docker compose up --build
```

App on `:3000`, Postgres on `:5432`. Schema migrates on startup.

## Test

```
npm test                  # unit tests, mocked db
npm run test:integration  # real db (needs docker compose up -d db first)
```

## API

```
GET  /users/:id/entitlement
POST /webhooks/store
POST /webhooks/marketplace/revoke
POST /carrier/enroll
GET  /health
```

Example:

```
curl -X POST localhost:3000/webhooks/store \
  -H 'content-type: application/json' \
  -d '{"eventId":"e1","userId":"u_1","type":"INITIAL_PURCHASE","eventTimeMs":1716700000000,"productId":"premium_monthly"}'

curl localhost:3000/users/u_1/entitlement
```

## Design notes

`entitlements` is a projection, not a log — one row per user, updated in place. Reads are a primary-key lookup.

Out-of-order events are handled with `last_event_time` (event clock, not arrival time). If an older event arrives after a newer one was applied, it's recorded in `processed_store_events` for idempotency but doesn't change state. Duplicate, out-of-order, and late-arriving all collapse into the same check.

Source precedence lives in the `source` column. Marketplace bulk revoke only touches users where `source = 'MARKETPLACE'`. Carrier polls only update where `source = 'CARRIER'`. So a STORE-active user doesn't get clobbered by a stale carrier signal.

Concurrency: webhook upserts take `FOR UPDATE` on the entitlement row; the carrier queue claim uses `FOR UPDATE SKIP LOCKED`. The latter is covered by an integration test with two real pg clients racing on the same row.

Notifications: `expires_at` is derived from product duration at activating events. A row goes into `notifications` with `scheduled_for = expires_at - 7d`. `UNIQUE (user_id, type, scheduled_for)` plus `ON CONFLICT DO NOTHING` enforces "schedule once" at the DB. The dispatcher worker logs and marks `sent_at` — no real send for this assignment.

## Stack

Node 22 · TypeScript · Express · Postgres · node-cron · Jest
