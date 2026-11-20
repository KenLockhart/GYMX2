# Form Coach durable jobs

Form Coach background work is bounded by database RPCs and a scheduled Node.js
route. The cron route is `/api/cron/form-coach`; Vercel calls it every five
minutes. It requires the existing `CRON_SECRET` bearer token and the explicit
server-side `FORM_COACH_JOBS_ENABLED=true` flag. The flag defaults to false.
Responses contain aggregate counts only. They do not log or return member IDs,
attempt IDs, provider errors, numeric measurements, or summaries.

## Summary dispatch

Summary generation accepts exactly the 22 numeric result fields from one
finished attempt and the fixed `attempt-summary-v1` prompt. It excludes identity,
coach notes, exercise comments, intake data, video, images, landmarks, and prior
attempts. A provider key is checked before any summary claim, so missing
configuration does not drain the queue.

The database claims one eligible summary at a time while the current Form Coach
pricing revision is not globally disabled. `pricing_pending` still permits work
funded by a matching historical receipt; the worker does not require a current
paid plan or recalculate that saved bundle. A globally disabled revision stops
claims before the backlog or its attempt budget changes. If disablement happens
after a claim but before authorization, the service releases the claim and
restores that unused attempt. If disablement happens after a bounded dispatch
grant, completion discards the generated text and keeps the finished numeric
result and funding receipt unchanged.

Claims are ordered by the oldest eligible retry time and creation time. A claim
has a short lease and a rotating token. Before a provider request, the worker asks the service-only
authorization RPC for a one-use dispatch grant. The grant contains only the
fixed prompt version and validated numeric payload, expires after a short local
deadline, and cannot be repeated for the same claim. The worker's monotonic
budget starts before claim and authorization, lasts at most ten seconds, and
shortens the provider timeout to the remaining grant budget. The transport
checks the deadline immediately before starting HTTP. A delay beyond the
deadline therefore results in no provider request.

An authorized request is never automatically sent a second time. If the worker
loses its authorization response or crashes after dispatch, the ledger blocks
reuse; recovery marks an expired unsettled grant unavailable. Provider
transient outcomes use capped exponential backoff, with no more than five
claims. Permanent, invalid, or filtered output becomes a sanitized unavailable
result. None of these outcomes rolls back a completed attempt or changes its
numeric result or funding receipt.

The finish RPC acquires its account, assessment, outbox, dispatch, result, and
pricing locks before checking the grant deadline. If lock waits carry it past
the local deadline, it returns `authorization_expired` without writing the
late result or settling the ledger; bounded claim recovery can terminalize that
grant after the outbox lease expires.

Account cleanup suppresses queued work and includes still-live dispatch grants
in its readiness proof. A grant authorized before the deletion fence remains
visible until it settles or its short local authorization deadline passes.
After a deletion fence, late output is discarded. Passing that local deadline
is only a bound on permission to persist; it is not evidence that remote
processing or data retention has ended.

## Assessment expiry and Program sends

Each scheduled pass expires at most 25 due assessments and claims at most one
Program-send row. Expiry changes only assessment status. The bounded candidate
query excludes assessments with any finished attempt, an unexpired running
lease, or an active retry window for the latest Needs Work review before taking
its 100-row page. These stable skip classes cannot hide later eligible work;
the worker checks them again after account and assessment locks. Partial
results, retry windows, slots, funding, and receipts remain unchanged.

Summary authorization also requires the current coach-member link for both
manual and Program assessments. Program summaries must come from a
coach-owned, non-platform Program.

Program sends continue through the existing service claim/process RPCs, one row
per pass with a short lease. The job does not deliver notifications, call
Stripe, claim additional notification work, or access media. Program eligibility
and funding remain revalidated by the existing database workflow.

The route, worker, and provider tests use mocked RPCs and mocked transport. They
do not make real provider or database calls. `form_coach_jobs_test.sql` is the
standalone rollback-only 420 database suite and requires accepted migrations
through 420. `form_coach_jobs_vod_integration_test.sql` is a separate
rollback-only companion that requires the accepted 315 VOD application
contract as well as 420; it exercises the real registered VOD upload-abort
proof API. A separate local database integration run is required before
accepting a migration as applied evidence.

## Local validation evidence

On 2026-11-20, migration `20261119042000_form_coach_jobs.sql` (SHA-256
`807A18403145E7DB39D0F75055C113BCF5C9FC49E7B5D50EF466A6D16A19DB2D`) was
applied once to local clone V. The function inventory and `plpgsql_check`
covered ten routines (eight PL/pgSQL and two SQL) and one bound trigger, with
no checker errors. The standalone `form_coach_jobs_test.sql` (SHA-256
`724BD4A0F98140F2EE49E410A299E8D8A8741C5FB3B03CE9E646C3FB41692917`)
completed all 70 planned assertions: 70 passed, zero failed, zero SQL errors,
an explicit rollback, and psql exited with code 0. A fresh read-only check
found three users and three profiles, no test fixture users or Form Coach
assessment, attempt, outbox, or dispatch rows, and no other database sessions
on V.

A separate committed synthetic fixture on local clone U exercised the timing
boundary with two PostgreSQL backends. The positive control finished before
its grant deadline. In the late-finish case, authorization was issued at
`2026-11-20 23:10:28.181 UTC` with a deadline of `23:10:40.181 UTC`. The
finisher query began at `23:10:29.155 UTC`; monitoring observed it blocked by
the pricing-row holder at `23:10:29.399 UTC` and still blocked by the same
backend at `23:10:41.111 UTC`. After the holder released the row, the finish
RPC returned `authorization_expired`. Both processes exited successfully, and
the complete outbox, result, and dispatch snapshots had identical MD5
fingerprints (`058df6fd07160f6a05e03530434aa9b1`) before and after. The late
summary text was not persisted. This local race used synthetic database rows
and did not contact a provider. U retains its marked fixtures and logs.

The mocked worker, provider, and cron-route suites passed 32 tests with
`npx vitest run src/lib/form-coach/jobs-server.test.ts
src/lib/form-coach/summary-provider.test.ts
src/app/api/cron/form-coach/route.test.ts --maxWorkers=2`. Scoped ESLint,
`npx next typegen`, and `npx tsc --noEmit --pretty false` also passed. These
runs use mocked RPCs and transport; they are not provider or hosted-database evidence.
The 17-assertion `form_coach_jobs_vod_integration_test.sql` companion has not
been run because the required 315 VOD contract is still pending acceptance.
Full local logs are retained under `.vercel/form-coach-jobs-qa/local-v/` and
`.vercel/form-coach-jobs-qa/local-u/`.
