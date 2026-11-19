# Public Armory commerce

## Catalog and access

The signed-in member catalog and the public Armory share the same product pages. Guests and members without an active platform plan can browse and buy listed paid items in Ebooks, Gear, Accessories, and Programs. Supplements and Doctor Network remain Premium-only. Preview/display-only rows can be listed but cannot be checked out. Coach membership plans remain separate from platform memberships and Armory orders.

The public catalog is a narrow database view; private coach listings, guest email addresses, file paths, payment identifiers, and fulfillment references are not part of its projection. Private listings continue to use authenticated row-level access.

## Guest downloads and environment setup

Digital guest orders receive a seven-day, signed download link by email. The dedicated server-only `GUEST_ARMORY_DOWNLOAD_SECRET` must contain at least 32 characters and be configured separately for Production and Preview. Rotating it invalidates links already issued. Preview guest checkout is blocked when the configured Stripe key is live; use Stripe test mode for preview testing. Never copy provider secrets into local files or expose them in logs.

Guest order identity, email, payment intent, and immutable file snapshot are kept in the service-only checkout-intent table. Purchases retain only the intent reference and order/fulfillment snapshot. Signed-in buyers continue to use My Purchases, including paid downloads after platform plan cancellation.

## Checkout and refunds

Checkout snapshots are created under an item-row lock. If the item changes after the buyer loaded it, snapshot creation fails before a Stripe session is requested. Signed Stripe webhooks bind the exact session and record the purchase idempotently. Refund markers are recorded before or after order creation safely; a refunded physical order is not added to the shipping queue.

Coach Connect keeps the existing 10% fee on the item price; shipping is passed through to the coach. GYMX2's own sales retain the full item and shipping amount. Payment methods are card-only for this flow.

## Printful references

Physical Gear and Accessories can store a Printful SKU and optional Sync Variant ID. Sized listings require an exact SKU for each option when any variant mapping is configured. The selected identifiers are copied into the order for manual fulfillment. GYMX2 does not verify, sync, or automatically submit Printful orders.

Apply the additive Armory commerce migration only after reviewing its exact target database prerequisites and migration history. Do not apply unrelated pending migrations as a side effect of enabling the public store.
