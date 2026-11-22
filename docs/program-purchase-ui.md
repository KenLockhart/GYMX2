# Program purchase panel

The member Program detail page includes an inline purchase panel. It is limited to the signed-in member and the Program on that page. Coach and admin views keep their existing roles and controls. The panel does not change lesson access; the existing Program progress read remains the authority for which lessons a member can open.

## Availability and account binding

- Existing owned purchase status and recovery are read even when new purchases are disabled.
- `PROGRAM_PURCHASE_ENABLED` gates new quotes and confirmations. Paid confirmation also requires `PROGRAM_CHECKOUT_ENABLED`; a zero-total promotion grant still follows the purchase flag and the current server quote.
- Checkout start and explicit retry require `PROGRAM_CHECKOUT_ENABLED`. The checkout server remains responsible for current Regular membership and order eligibility.
- Mutating Server Actions compare the current authenticated user with the buyer identity supplied by the server-rendered member page before calling the purchase or checkout adapter. That identity is only a mismatch fence; the adapters continue to derive buyer authority from the authenticated session.

## Member flow

Members can review a server quote, apply a promotion, choose a supported installment count, and give explicit consent for paid terms. Promotion lookup first asks for the free-grant quote; it falls back to a one-payment quote only when the server specifically reports an invalid installment count. Transport or promotion errors do not trigger a different quote. Editing the promotion while a quote is pending invalidates that response and releases only its own request lock, so a new quote can be requested. A late response cannot replace a newer quote or clear its loading state.

Before confirmation, the panel checks for an existing owned Program order. It stores only the exact confirmation command in buyer-and-Program-scoped session storage before sending it. An uncertain reply is recovered by request identity and then by the existing Program order. A retry reuses the same request and payload; a stale quote requires the member to review the refreshed price and dates again. Paid checkout-off and feature-off states keep saved intent visible but block its mutation.

The displayed installment schedule is the server-provided fixed total and date keys. The first payment is at checkout. Future charges are shown as calendar dates without local-time conversion. The panel describes the seven-day retry window and the current cancellation/refund terms. It does not accept a checkout return query as payment proof or claim access from a checkout result. A known checkout URL is rendered as an explicit link only after strict Stripe-host validation. An uncertain checkout retry keeps its exact request identity until an authoritative, validated checkout link is returned for that order; a later expired attempt can then use a new retry identity.

For a zero-total grant, the panel confirms the server-issued grant and refreshes the Program page. It still relies on the existing progress read to show any newly available lessons. No billing or off-session consent is requested for a zero-total grant.

## Scope and verification

This panel does not add cancellation controls, a purchase-history route, an automated checkout redirect, webhook or scheduled billing work, or provider calls from the browser. The feature flags remain deployment-controlled and must stay off until the remaining purchase-history, return-route, and production integration work is accepted.
