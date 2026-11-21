# Program purchase history application adapter

The server adapter exposes owner-scoped purchase history from the existing
630 SQL RPCs. It is a read-only data access layer; it does not grant access,
change purchase eligibility, or start, retry, or cancel a purchase.

## Server functions

- `getMyProgramPurchaseHistory({ limit, cursor?, programId? })` calls
  `get_my_program_purchase_history(integer,timestamptz,uuid,uuid)` through the
  authenticated Supabase server client. `limit` is required and bounded from 1
  through 50. A cursor is the exact last row returned by the previous page:
  `{ createdAt, orderId }`. Timestamp text is passed through without converting
  it to JavaScript `Date`, preserving PostgreSQL sub-millisecond precision.
- `getMyProgramPurchaseHistoryDetail(orderId)` calls
  `get_my_program_purchase_history_detail(uuid)` with an order ID only.
- `findExistingProgramPurchase(programId)` requests one row filtered to that
  Program. It returns an order ID only for a successful, unique result; a
  successful empty page is `orderId: null`. An RPC, transport, or DTO failure
  remains an error and must not be interpreted as permission to create a new
  order.

All three functions authenticate with `auth.getUser()` before any RPC. They
derive no buyer identity from caller input and use the same user-scoped client
for the read. They do not use the service-role client, inspect membership or
current purchase flags, or reveal raw Supabase errors. SQL ownership remains
the source of truth for which orders the caller can read.

## DTO boundary

The parser accepts only the exact 630 JSON keys and closed status labels. It
normalizes UUID casing while accepting PostgreSQL's canonical 8-4-4-4-12
hexadecimal shape without imposing a version or variant restriction. It
validates cents, plan/installment shape, the SQL-provided cleared-installment
prefix range and refund-stage consistency, calendar dates, timestamps, safety
holds, retry hints, and page cursor binding. Pay-in-full rows cannot carry
future installment dates. The adapter preserves timestamp strings verbatim.

The adapter returns a small camel-case projection with the generic `Program`
label. It rejects provider identifiers, URLs, raw internal states, unknown
keys, duplicate order IDs, an unexpected Program filter result, and a cursor
that is not bound to the final returned item. It does not recalculate payment
state, refund state, cleared installments, or any billing schedule.

Neutral read failures are `unavailable`, `invalid_response`, `invalid_request`,
or `not_found`. These results contain no raw database message. A later member
UI should render the supplied stage labels and persisted dates as information,
not use them to make funding, access, or retry decisions.

## Verification boundary

Focused Vitest tests mock the authenticated client and RPC responses. They
verify argument mapping, identity derivation, strict DTO parsing, pagination
binding, owner detail binding, and discovery's empty-versus-unavailable
behavior. These are adapter tests only; they do not execute the 630 migration
or TAP file and do not establish runtime database behavior.
