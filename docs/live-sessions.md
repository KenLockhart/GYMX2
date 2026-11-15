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
| Cloudflare Stream | Account `6bd04970867bcfdeae0e5768cb8239c5`, zone `gymx2.com`; Stream is enabled and has no live inputs yet |

The legacy local `CLOUDFLARE_ACCOUNT_ID` is not the verified live account. Do not reuse its token or
account settings for private live. Existing VOD configuration remains on the legacy
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`, and `CLOUDFLARE_STREAM_CUSTOMER_CODE` values.

## Required deployment configuration

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

The [Stream WebRTC guide](https://developers.cloudflare.com/stream/webrtc/) describes playback as
`/<INPUT_UID>/webRTC/play` and publishing as `/<SECRET>/webRTC/publish`. The [Live Input create API
example](https://developers.cloudflare.com/api/resources/stream/subresources/live_inputs/methods/create/)
currently shows a separate 64-character opaque path segment for `uid` and the same opaque segment in
both `webRTC.url` and `webRTCPlayback.url`. The implementation validates WHIP as a trusted HTTPS
customer host plus an opaque publish-secret path, distinct from the input UID. WHEP remains
fail-closed unless the returned playback path uses the documented input UID. No real provider input
has been created to resolve this documentation discrepancy; verify the actual account response and
signed WHEP behavior with a synthetic input before enabling private live.

## Required cleanup scheduler

Private live requires a successful cleanup heartbeat within the last three minutes. The application
does not install or manage the scheduler automatically. Before enabling private live, an operator
must manually approve and configure a minutely Supabase `pg_cron` + `pg_net` request to the fixed
endpoint `GET https://gymx2.com/api/cron/live-cleanup`.

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

Use this order when an operator approves go-live:

1. Apply the reviewed database migration and set the dedicated live and signing-key variables in
   the correct Vercel project/environment.
2. Deploy the application containing the cleanup endpoint and confirm the deployment is ready.
3. Manually configure the Vault secret and minutely `pg_cron` + `pg_net` request. Do not install the
   scheduler from an automatic migration.
4. Verify the signed endpoint returns HTTP 200 on a completed empty or fully cleaned batch; the
   route records the heartbeat only after that success.
5. In an approved non-production test account, exercise private provision, short-lived playback,
   revocation, and provider deletion with synthetic test inputs before enabling real sessions.

The migration, Stream signing key, Vercel live-only variables, `LIVE_CLEANUP_SECRET`, Vault secret,
scheduled job, heartbeat verification, and synthetic provider test remain deployment setup; none
was performed by this source change. Do not test this path against real provider inputs until those
bindings and the manual scheduler are reviewed and approved.
