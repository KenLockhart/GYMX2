# Platform memberships

Platform memberships are separate from coach subscriptions and have no coach Connect transfer or 10% fee. The two paid plans are **Regular at $8/month** and **Premium at $24.95/month**, in USD. There is no free trial.

## Item access

Armory access is set on each item as **Everyone** or **Premium**. Everyone items are accessible to everyone; Premium items require a current Premium membership. This choice applies across categories. Premium does not unlock a fixed set of categories. Creators can display an item without allowing purchases, and purchase/download safeguards remain independent from membership display access.

Existing purchase ownership checks continue to allow a buyer to access their previously purchased downloads after membership access ends.

## Stripe prices and checkout

The server requires these environment values, each pointing to a distinct active monthly USD Price for the specified amount:

- `STRIPE_PLATFORM_REGULAR_PRICE_ID`: $8.00 per month
- `STRIPE_PLATFORM_PREMIUM_PRICE_ID`: $24.95 per month

Checkout accepts card payments only and creates a subscription without a trial. The server retrieves and verifies the configured Price; it does not accept a client-supplied amount or create Stripe Prices.

An active subscription status alone does not grant new or extended access. The server verifies that the latest invoice is paid and includes a nonnegative current-period line for the subscription’s current Price and item. The line must match the customer, subscription, quantity, and current billing period. An unpaid invoice or a paid invoice for an older Price or period does not grant an upgrade or extend the saved paid-through period. Nonactive subscription statuses are still synchronized. A cancellation scheduled for period end retains access through the already-paid period.

## Billing Portal configurations

Set two Stripe Billing Portal configuration IDs in the server environment:

- `STRIPE_PLATFORM_MEMBER_PORTAL_CONFIGURATION_ID`: for member accounts. Enable payment-method management and cancellation at period end. Allow price-only updates between the two GYMX2 Regular and Premium products/prices, with `always_invoice` proration; do not allow quantity updates.
- `STRIPE_PLATFORM_PREMIUM_PORTAL_CONFIGURATION_ID`: for other eligible account roles. Enable payment-method management and cancellation at period end for GYMX2 Premium; do not allow updates to Regular.

The application chooses a configuration from the authenticated account role and pins it to each GYMX2 portal session. These configuration IDs must be created in the same Stripe account as the membership Prices. The account’s default Billing Portal configuration is left unchanged for other products. A scoped configuration limits which prices a customer can change to; it does not guarantee that the Billing Portal hides the customer’s other subscriptions or invoice history. See Stripe’s [portal configuration API](https://docs.stripe.com/api/customer_portal/configurations/create) and [portal session API](https://docs.stripe.com/api/billing_portal/sessions/create).

## Webhook events

The signed endpoint is `/api/stripe/webhook`; configure its signing secret as `STRIPE_WEBHOOK_SECRET`. The endpoint must receive these events for platform membership lifecycle handling:

- `checkout.session.completed` for subscription-mode checkout
- `checkout.session.expired` to release an unfinished platform checkout
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `invoice.paid`
- `invoice.payment_failed`

For platform subscriptions, the endpoint retrieves fresh Stripe state before synchronizing. Paid and failed invoice events both trigger that fresh check. Platform invoice events are kept separate from the existing coach invoice recorder. The same endpoint also handles other application billing events; preserve its existing event subscriptions when updating the Stripe destination. Stripe documents subscription [webhook event handling](https://docs.stripe.com/billing/subscriptions/webhooks).

## Database and test access

Main verified read-only that the remote and local Supabase migration histories matched through `20261125200000` on 2026-11-25. These signup and payment safeguards require no new database migration.

The paid gate is enforced by the supported Next.js pages, server actions, credential-issuing endpoints, and Premium catalog RLS. Existing owned-download and privacy routes use their authenticated ownership checks without requiring a current plan. This is not a universal paid gate on every legacy direct Supabase RPC or table surface; review those surfaces separately before expanding enforcement.

Manual test entitlements remain a separate, audited `manual_test` source; they are not Stripe subscriptions, invoice records, or charges. The generic template is `supabase/ops/grant_manual_platform_test_entitlement.sql`. Do not run it against a hosted project without a freshly reviewed target and explicit authorization.
