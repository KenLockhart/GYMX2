# Program purchase history read contract

Migration `20261119063000_program_purchase_history_read.sql` adds an authenticated,
owner-scoped history list and detail read. It does not replace or revoke the
existing `get_my_program_billing_history()` contract; that legacy RPC remains
available with its current unbounded response shape.

## RPC surface

- `public.get_my_program_purchase_history(integer, timestamptz, uuid, uuid)`
  accepts a required page size from 1 through 50, a paired `(created_at,
  order_id)` cursor, and an optional Program ID filter. It returns only orders
  whose immutable `program_orders.buyer_id` equals `auth.uid()`. The order is
  descending by `(created_at, id)`; the next cursor is the last emitted row.
- `public.get_my_program_purchase_history_detail(uuid)` returns the same item
  projection for the caller's own order. A foreign or absent order returns the
  same `not_found` status.
- Both public RPCs require `auth.role() = 'authenticated'`. Execute is granted
  to `authenticated`; `public`, `anon`, and `service_role` are revoked. The
  private projection helper has no app-role execute grant. No table grants are
  added.

The RPCs deliberately do not re-check current membership, publication, offer,
or feature-flag eligibility. Those checks govern new purchases and access, not
discovery of a buyer's own prior order. The projection uses the generic label
`Program`, so it never reads a possibly unpublished current title.

## Projection source and precedence

| Output | Source / rule |
| --- | --- |
| `order_id`, `program_id`, `created_at`, `currency`, price and plan fields | Immutable `program_orders` snapshot. Shape, installment count, 1-based amount-array bounds, and total are rechecked; malformed economics set `safety_stage = unknown`. |
| `cleared_installments` | Recomputes the frozen 550 contiguous-prefix rule against every `program_order_installments.net_settled_cents`. It is not a count or maximum installment number. |
| `has_recorded_refund` | Any positive `provider_refunded_cents` or `refund_marker_cents` on the canonical installment rows. |
| Billing terms and checkout structure | `program_billing_orders` accepted total/count/consent/date snapshot plus a contiguous current attempt sequence in `program_billing_checkout_attempts`. A positive order without terms is retained as `safety_stage = unknown`. |
| `next_due_date`, `retry_deadline` | The current invoice's stored `due_date` and `retry_deadline`; before an invoice exists, the stored `next_anchor_date` supplies the due date. They are suppressed when billing is settled (`paid`), any cancellation request exists, cancellation is completed, or safety is not clear. A post-settlement refund does not restore an old schedule hint. No deadline is calculated in this projection. |
| Checkout and payment pending states | Durable operation intents/unknowns, current attempt state, invoice state, and paid provider observations without matching fully gross-settled ledger rows. |
| Cancellation stage | Exact buyer cancellation request ID/reason and paired billing/order state: `requested`, `completed`, `none`, `not_applicable` for a validated free grant, or `unknown`. Deletion hold suppresses this detail as `unknown`. |
| Safety stage | Precedence is deletion hold, financial conflict, manual review, structural/terms/attempt/state inconsistency, then clear. An unsupported combination is never promoted to a positive payment stage. |

Payment stages are the closed labels `free_grant`, `checkout_required`,
`checkout_pending`, `checkout_open`, `checkout_retryable`, `payment_pending`,
`partially_settled`, `settled`, `refunded`, `partially_refunded`, `not_started`,
and `unknown`. A verified refund that moves canonical state from paid back to
active/awaiting checkout is recognized only when a refund marker/provider
refund fact exists. A fully refunded positive order is labeled `refunded` only
when gross settlement and refund amounts cover the immutable order total, net
settled total is zero, and at least one refund is backed by gross settlement;
any smaller backed refund is `partially_refunded`. A refund marker without a
matching gross settlement remains `unknown`.

Deletion hold outranks conflict, which outranks manual review, which outranks
unknown structure. Non-clear safety suppresses positive payment labels and
clears due/retry hints. Retry is shown only when the current persisted attempt
is `expired_unpaid`, its create outcome is `created`, no installment is
net-settled, and cancellation is `none`. No lease, age, provider URL, provider
identifier, or current feature flag creates a retry hint.

The DTO is built field by field; it does not serialize database rows. It does
not include Stripe IDs, checkout URLs, provider snapshots, raw billing states,
internal reasons, offer IDs, or Program titles.

## Source review and QA boundary

The TAP file uses ordinary local producer RPCs for order reservation, fresh
billing terms, checkout/customer bindings, canonical settlement and refund,
and cancellation. One isolated two-installment fixture seeds a single
historically accepted `program_billing_orders` terms row directly as PostgreSQL
test setup; this is the same legacy fixture exception used by the frozen 500
billing test. Every provider-lifecycle mutation after that row uses the
authorized billing RPCs, including settling both installments before
partially refunding the first. Synthetic evidence exercises projection logic;
it is not evidence from a real provider. This historical schedule fixture does
not test fresh terms/calendar creation or a three-installment lifecycle. A
separate one-time producer path proves requested and completed cancellation,
then a full verified refund, without conflating cancellation and refund stages.
In the historical two-installment path, the source fixture confirms its stored
next anchor and invoice retry deadline remain non-null after the partial refund,
then requests and completes cancellation through the normal buyer and server
RPCs with the exact paid Checkout, PaymentIntents, and invoice inventory. The
history assertions prove those previously stored hints are hidden during both
requested and completed cancellation.

The source test covers owner isolation, role grants, invalid bounds, same-time
UUID cursor ordering with an intervening insert, Program filtering, generic
labels/current-offer independence, lapsed membership history, free grants,
legacy positive orders without terms, unknown Checkout creation, paid provider
observation without a settled ledger, persisted expired-unpaid retry, settled
and partially refunded installment progress, and cancellation stages. Feature
flags are app configuration and are not a database input to this read RPC;
feature-off UI behavior is outside this SQL contract. The pre-existing
`get_my_program_billing_history()` RPC remains unbounded and unchanged.

**Execution status:** bounded local PostgreSQL QA completed on fresh clone
`gymx2_program_purchase_history_20261121h2` of the accepted B1 source. The
corrected 630 migration was applied atomically once. `plpgsql_check` reported
three new functions with zero errors or warnings; the TAP ran once with 82
passing assertions and a final `ROLLBACK`. The read-only postrun inventory and
source B1 postverify both exited successfully and ended with `ROLLBACK`; the
source baseline fingerprints remained unchanged.

The initial H1 apply failed on a missing parenthesis and its raw output is
preserved. After the one-character correction, the migration was applied on
H2. H2's first read-only wrapper attempts also failed: one had an include-path
error and another counted the three new 630 functions as 620 functions. Those
raw outputs are preserved; only the ignored QA wrapper/inventory was corrected
before the successful read-only audit. The H2 migration and TAP each ran once; neither was retried or rerun. This
evidence is limited to the isolated local databases; it does not verify
hosted deployment, provider behavior, authenticated HTTP, or UI flows. The QA command and raw-output index is
[qa-index-h2.json](../.vercel/program-purchase-history-qa/local-h2/qa-index-h2.json).
