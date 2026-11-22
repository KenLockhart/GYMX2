# Program Checkout redirect URL compatibility

The Checkout redirect validator accepts the provider URL as an opaque value.
It still requires HTTPS, the exact `checkout.stripe.com` hostname, no
credentials, no non-default port, and a maximum length of 2,048 characters.
It permits a fragment and returns the original provider URL unchanged; the
application does not parse, strip, decode, or reconstruct that fragment.

Stripe's [Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-url)
example includes a `url` with a `#fid...` fragment. The server contract test
uses a synthetic URL in that documented shape. It does not create or retrieve
a live Stripe Session.

The application-generated success and cancel return URLs remain separately
restricted to the configured HTTPS site origin and the order's Program route.
