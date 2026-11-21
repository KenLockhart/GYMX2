# Program purchase history screens

`/program-purchases` lists the signed-in account's saved Program orders. The
list requests at most 20 owner-scoped rows per page and uses the paired
`cursorCreatedAt` and `cursorOrderId` query values returned by the history RPC.
The timestamp is carried unchanged so its microseconds remain part of the
keyset cursor. A malformed, partial, duplicate, or extra query parameter is
shown as an invalid link rather than an empty history result.

`/program-purchases/{orderId}` reads the owner's stored detail projection. It
does not load the current Program, offer, membership, or purchase flags, so an
owner can review retained history after membership lapse or Program changes.
The only Program label is the generic `Program`. A validated owner `not_found`
result renders not-found; an unavailable read has a retry state. The checkout
return query (`checkout=success` or `checkout=cancel`) is display-only: the
saved history status remains authoritative and a return URL never proves
payment, access, or cancellation.

The account menu exposes Program purchases for every signed-in role. Existing
Armory Purchases navigation remains unchanged for its current roles.

## Cancellation request

The detail page offers a cancellation request only when its validated history
DTO shows a non-free order with outstanding charges, clear safety status, and
no cancellation already recorded. A partially refunded schedule is eligible
only when the saved projection also has a future due date; a reduced net
settled count after a refund does not by itself establish future collection.
Free, fully settled, fully refunded, cancelled, and non-clear purchases do not
show the control.

The person must acknowledge that this requests stopping future charges, a
payment already in flight may still finish, previously paid stages remain
available subject to normal access rules, and the request does not automatically
refund prior payments. Refund requests follow the existing policy. The action
authenticates again and calls only `request_program_billing_cancellation`
through the user-scoped Supabase client. The RPC enforces ownership. The action
does not check new purchase or checkout flags, current membership, or current
Program eligibility; it does not contact the payment provider or complete the
cancellation itself.

Before sending the mutation, the browser saves only a versioned request UUID
under an account-and-order-scoped `sessionStorage` key. If the reply is
uncertain or a request is recovered after reload, the person must explicitly
refresh the owner history before retrying. A retry reuses the exact saved
request UUID. Unknown stages and temporary safety holds retain that request ID
and disable retry until a later owner refresh returns a clear status. Only an
authoritative `requested` or `completed` cancellation stage retires the saved
ID. If a newer history projection makes the order ineligible, the retry form
stays hidden while the saved ID and refresh control remain; a later clear
projection still requires an explicit owner refresh before that same ID can be
retried. If storage is unavailable or invalid, no new cancellation request is sent.
`cancellation_requested` and `already_requested` are not presented as
completed cancellation; the saved history is refreshed to show progress.

Checkout's new success and cancel return URLs point to
`/program-purchases/{orderId}` with the corresponding display query. The
existing URL builder keeps its `programId` argument for caller compatibility;
the route uses the encoded order ID. Previously persisted checkout-attempt
URLs remain unchanged.
