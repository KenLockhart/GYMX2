# Live sessions

## Current implementation

Group sessions continue to use the existing broadcast input. One-on-one sessions use a separate
Cloudflare Stream live input for each authorized direction. A private session is offered only for
the session's exact invited member, and the member must explicitly accept and choose whether to
allow their camera. A normal calendar invitation never grants camera permission. Only the coach can
receive the member's return-video playback credential.

After provider cleanup is fully confirmed, the owning coach can return the calendar session to
broadcast mode. The database rejects that reset while any private grant or provider cleanup is
still active; the recovery action does not attempt provider deletion itself.

Private playback uses a short-lived RS256 JWT signed with a Cloudflare Stream signing key. Provider
UIDs and ingest addresses remain server-side; participant responses contain only the authorized
sender's WHIP ingest address or the opposite participant's signed WHEP playback address. Revocation
queues both provider inputs for deletion. The grant is not reported revoked until provider deletion
is confirmed.

## Verified service bindings

These identifiers are non-secret routing references verified for this project. They are not
credentials:

| Service | Verified binding |
| --- | --- |
| GitHub | `KenLockhart/GYMX2` |
| Vercel | Team `ken-lockhart` (`team_JiKLFAawghXAZ2oI7Iq7Xkto`), project `gymx-2` (`prj_JTijvnM16rUyZA7i5a2UUHXAi9T1`) |
| Supabase | Project ref `vftmkwwqioysetghbruk` |
| Cloudflare Stream | Account `6bd04970867bcfdeae0e5768cb8239c5`, zone `gymx2.com`; Stream is enabled |

The legacy local `CLOUDFLARE_ACCOUNT_ID` is not the verified live account. Do not reuse its token or
account settings for private live. Existing VOD configuration remains on the legacy
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`, and `CLOUDFLARE_STREAM_CUSTOMER_CODE` values.

## Verification status (2026-11-15)

The private-live database migration has been applied to the verified hosted Supabase project. A
provider-only test against Cloudflare account `6bd04970867bcfdeae0e5768cb8239c5` created one tagged
live input with recording disabled and signed playback required. Its WHIP publish address used a
separate secret from the input UID; its WHEP playback address used the input UID. A synthetic
video-and-audio stream published over WHIP and played through short-lived signed WHEP; the unsigned
WHEP request was rejected with HTTP 401. The test input was deleted, its exact-UID lookup returned
HTTP 404, and the complete live-input list reported a numeric total of zero matching its zero rows.

This verifies the provider URL and transport behavior only. It does not verify the application
session flow, per-environment Vercel configuration, cleanup scheduler or heartbeat, or a production
deployment.

## Required configuration per environment

Private live stays fail-closed until all of the following are configured in the correct Vercel
project/environment:

- `CLOUDFLARE_LIVE_ACCOUNT_ID`, `CLOUDFLARE_LIVE_STREAM_TOKEN`, and
  `CLOUDFLARE_LIVE_CUSTOMER_CODE`, all for the verified Cloudflare account above.
- `CLOUDFLARE_STREAM_SIGNING_KEY_ID` and `CLOUDFLARE_STREAM_SIGNING_KEY_JWK`, using a Cloudflare
  Stream RS256 signing key. The JWK must contain the private key and must stay server-side. It can be
  supplied as JSON or base64-encoded JSON.
- `LIVE_CLEANUP_SECRET`, a long random secret shared only with the server and the Vault scheduler
  below.

Set the three dedicated live variables as a complete set. Partial values disable the dedicated
configuration, and private live does not fall back to the VOD credentials. Never put these values
in a `NEXT_PUBLIC_` variable or return them in an action result.

The first private-live operation binds the runtime to the configured 32-character Cloudflare
account ID in the private runtime row. The binding is immutable and checked before private actions
and cleanup. Changing `CLOUDFLARE_LIVE_ACCOUNT_ID` to another account will fail closed; it does not
rotate the binding or authorize cleanup against the new account. Restore the bound account or plan a
separately reviewed recovery after provider cleanup is complete. Do not change the account while
any private grant or cleanup job is unresolved.

## Cloudflare WebRTC URL verification

On 2026-11-15, the actual create response for verified Cloudflare account
`6bd04970867bcfdeae0e5768cb8239c5` confirmed the following contract: WHIP uses a separate publish
secret, while WHEP uses the input UID. Both addresses used the expected Cloudflare customer host.
The synthetic video-and-audio test confirmed publishing and signed playback; an unsigned WHEP
request returned HTTP 401. The test input was removed and the complete provider list confirmed that
no live input remained. The [Stream WebRTC guide](https://developers.cloudflare.com/stream/webrtc/)
and [Live Input create API](https://developers.cloudflare.com/api/resources/stream/subresources/live_inputs/methods/create/)
document these separate publish and playback addresses.

## Required cleanup scheduler

Private live requires a successful cleanup heartbeat within the last three minutes. The application
does not install or manage the scheduler automatically. Before enabling private live in an
environment, configure a minutely Supabase `pg_cron` + `pg_net` request to the fixed endpoint
`GET https://gymx2.com/api/cron/live-cleanup`.

Store the same `LIVE_CLEANUP_SECRET` in Supabase Vault under the exact name
`gymx2_live_cleanup_secret`; do not put a raw bearer secret into a queued `pg_net` header. The
request must calculate HMAC-SHA256 over the exact UTF-8 string
`<decimal-epoch-seconds>.GET./api/cron/live-cleanup` and send the decimal timestamp in
`x-gymx2-cleanup-timestamp` and the lowercase hexadecimal digest in
`x-gymx2-cleanup-signature`. Requests more than five minutes from server time are rejected.

The endpoint checks the signature before database or provider work. It claims a bounded cleanup
batch, deletes only inputs found with the matching deterministic provider metadata tag, confirms
each deletion, and records the heartbeat only after the entire batch succeeds (including an empty
batch). A failed provider deletion or database step returns a generic error and does not refresh
the previous successful heartbeat. Private live remains available only until that heartbeat is more
than three minutes old, after which the database rejects private-mode and media actions.

Use this order for each deployment environment:

1. Confirm the reviewed database migration is applied to the target Supabase project.
2. Set the dedicated live and signing-key variables in the matching Vercel project/environment.
3. Deploy the application containing the cleanup endpoint and confirm the deployment is ready.
4. Configure the Vault secret and minutely `pg_cron` + `pg_net` request. Do not install the
   scheduler from an automatic migration.
5. Verify the signed endpoint returns HTTP 200 on a completed empty or fully cleaned batch; the
   route records the heartbeat only after that success.
6. Exercise the application session flow, short-lived playback, revocation, and provider deletion
   with synthetic test data before enabling real sessions. The provider-only transport verification
   above does not replace this application-level check.
