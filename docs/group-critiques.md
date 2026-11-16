# Group live critiques

Group critiques are a separate RealtimeKit meeting for broadcast calendar sessions. Existing
Cloudflare Stream broadcasts and private one-to-one live rooms keep their current paths. The new
feature is unavailable until its RealtimeKit configuration is present, bound to the database by
the cleanup worker, and verified against the preset rules below.

## Provider setup

Create one RealtimeKit app in the verified GYMX2 Cloudflare account
`6bd04970867bcfdeae0e5768cb8239c5`. Keep the existing Stream and private-live account variables
unchanged; set the separate RealtimeKit app and API token in these new server
environment variables; none may use a `NEXT_PUBLIC_` prefix:

- Current GYMX2 RealtimeKit app ID: `220a2e60-9bca-434e-ae68-9671d4653b66`.
- Current preset names: `GYMX2-Group-Host`, `GYMX2-Group-Observer`, and
  `GYMX2-Group-Consented`.

- `CLOUDFLARE_REALTIMEKIT_ACCOUNT_ID`: the 32-character Cloudflare account ID.
- `CLOUDFLARE_REALTIMEKIT_APP_ID`: the app UUID.
- `CLOUDFLARE_REALTIMEKIT_API_TOKEN`: a token with the Realtime permissions needed to list/read
  presets, create meetings and participants, refresh and delete participants, and end meetings.
- `CLOUDFLARE_REALTIMEKIT_HOST_PRESET`, `CLOUDFLARE_REALTIMEKIT_OBSERVER_PRESET`, and
  `CLOUDFLARE_REALTIMEKIT_CONSENTED_PRESET`: exact preset names in that app.

Configure all three presets as `WEBINAR` with stage enabled, no recording, no livestreaming, and
screenshare production disabled. Set `max_video_streams` to 31 for both desktop and mobile on all
three presets; the default limit is too low for a 30-member room plus its coach:

| Preset | Stage access | Audio/video production | Required extra permissions |
| --- | --- | --- | --- |
| Host | `ALLOWED` | `ALLOWED` | Can accept production requests, disable participant audio and video, and kick participants |
| Observer | `NOT_ALLOWED` | `NOT_ALLOWED` | None |
| Consented | `CAN_REQUEST` | `CAN_REQUEST` for both audio and video | None |

The application checks the configured names against live preset definitions before opening a room
or issuing a join token. Incorrect or missing presets fail closed. Create and verify these presets
before enabling the environment variables. The database binds to the first Cloudflare account/app
pair used; changing the pair requires a reviewed database cleanup and migration plan.

The meeting is created with recording and livestream start disabled. Participant tokens expire at
the room's persisted join expiry (session end plus 60 minutes). Deleting a RealtimeKit participant
revokes all of that participant's tokens and removes an active connection. Ending a room marks the
RealtimeKit meeting inactive and verifies the inactive status before cleanup completes.

## Product and consent rules

- A coach opens a room and then explicitly offers camera and microphone access to all current
  invitees or one selected invitee. Opening a room does not send offers.
- A room supports up to 30 invited members plus the coach. Pending calendar RSVPs are included;
  a “Going” RSVP is not required. New calendar invites beyond 30 are rejected for broadcast
  sessions while this cap applies.
- While a group room is provisioning, open, or ending, ordinary calendar roster edits are locked.
  RSVP-only changes remain available. Coach/member unlink and account or role deletion follow the
  revocation path, which removes current-generation access and keeps provider cleanup queued until
  confirmed.
- A legacy Stream broadcast row cannot be converted to a group critique by simply ending the room
  or switching the session mode. Its existing Stream input blocks group-room creation; schedule a
  new eligible broadcast session without a legacy live input for a group critique.
- A member must accept one explicit, atomic camera-and-microphone consent before receiving the
  `CAN_REQUEST` preset. Accepting consent never activates a camera or microphone.
- The client joins with audio and video disabled. The member must separately choose Go Live before
  requesting stage access or enabling a device. The coach grants stage requests only for an active,
  accepted participant whose opaque custom participant ID matches the current consent epoch.
- Declining, withdrawing consent, or replacing an identity invalidates the old participant before
  another publisher token is issued. Pending provider deletion blocks that member's rejoin.
- Coach mute state is persisted and reconciled by the host SDK. The room-level flag is the default
  for newly materialized members; bulk mute also updates current members. Per-member state is the
  effective mute state, so a coach can unmute one selected member while the room default remains
  muted. Unmuting never activates a microphone. Browser-enforced mute behavior must be verified
  against the deployed RealtimeKit SDK before enabling this feature for real sessions.
- An ended room remains ending until exact participant deletions and verified meeting deactivation
  have completed. Do not replace this cleanup path with an SDK kick-all call.

## Cleanup and operations

The existing `/api/cron/live-cleanup` endpoint runs private Stream cleanup and group RealtimeKit
cleanup independently. Both use the existing HMAC authentication, but each records its own
heartbeat and claims only its own database queue. A failure in either family still permits the
other family to run, then returns a retryable failure response.

Run the existing signed cleanup schedule at least once every three minutes. The database requires
a fresh group cleanup heartbeat before it will open a room or issue join credentials. The provider
adapter uses fully paginated reconciliation and exact meeting/custom participant tags before any
delete; incomplete or inconsistent pagination leaves the cleanup job pending.

Before rollout, run a real-account verification with one coach and 30 members. Confirm stage
requests, per-participant stage grants, selected/all mute behavior across reconnects, token expiry,
participant removal/rejoin, and meeting deactivation. This implementation deliberately imposes an
application cap of 30 members; provider account capacity and the browser's practical receive
capacity still need runtime verification at that size.

## Provider verification record

2026-11-16: the exact GYMX2 account/app and all three preset definitions verified successfully. A
two-person synthetic coach/member SDK probe published audio and video from both participants and
decoded the other participant's video on each side. A three-person run later joined all three,
confirmed no automatic capture, published synthetic audio/video, and decoded two remote videos on
each client. A preliminary mute check observed advancing RTP counters after mute; because RTP can
continue while carrying silence, this alone was not an audio-mute result.

A later three-person synthetic controls run joined/staged all participants and published synthetic
audio/video with capture disabled at join. With unmuted audio sinks attached, inbound energy advanced
for both member sources by approximately `0.000176` over 1.2 seconds. Host bulk mute set both member
and host peer audio states to disabled; inbound `totalAudioEnergy` stayed unchanged for both over
1.25 seconds, while packet counters continued to increase. Selected allow did not enable the member
microphone by itself; an explicit synthetic mic action then advanced that member's inbound energy,
while the other member remained muted. Individual mute also left energy unchanged over 1.25 seconds;
the remote audio track reported `enabled=false` while its sink remained attached and playing.

The same run confirmed reconnect with local audio/video off and no capture on join. A 30-second
refreshed member token was rejected on join with SDK `ClientError` code `0004`; the original
15-minute token remained usable as a positive control. Deleting a participant caused its old token
to be rejected with `0004`, and an inactive meeting also rejected the old host token with `0004`.
After reconnect, host mute was applied, but the harness attempted mic enable before waiting for the
SDK's public permission state to settle and observed one synthetic capture. This does not establish
post-settlement reconnect mute behavior. The final permission-settled denial check was not run: the
local QA server served `/api/status`, but its static QA routes timed out. No new provider resources
were created by those failed startup attempts.

Two earlier isolated 31-participant runs joined all 31 clients and stage-granted all 30 members but
failed while publishing at 27 and 19 clients. Those attempts used a synthetic track fixture that
advertised device IDs during enumeration but returned tracks without matching IDs in `getSettings()`.
The pinned SDK compares these identities and may stop or reacquire a mismatched track, so those runs
are fixture-affected and do not establish provider capacity limits.

After correcting the fixture, a paced isolated run again joined all 31 clients and stage-granted all
30 members. It published 27 clients before `member-27` reported `actor-publish-incomplete` after
27.9 seconds. Sanitized state showed audio enabled, but the SDK video flag was disabled and no live
video track existed. A historical `video_on` event for `member-27` had zero outbound video producer
stats; successful neighboring `member-26` also had the same video permission event category and
seven outbound video-stat entries. The cause remains unknown. The run did not reach all-to-all RTP
or decoded-video measurements, so 31-person media capacity remains unverified. This result does not
prove an account capacity limit. The first-join-to-browser-close upper bound was 174.7 seconds. All
31 participants were deleted and the meeting was verified inactive.

A separate local zero-provider preflight after the fixture correction exercised 31 synthetic actor
documents and 62 AudioContexts. All original and cloned synthetic tracks matched their advertised
device IDs, group IDs, and labels; live audio/video tracks, AudioContext resumes, and local cleanup
passed. It loaded no RealtimeKit SDK and made no provider requests, so it does not establish provider
capacity.
The Cloudflare project account was used for provider control-plane verification; no real member
profiles or physical camera/microphone media were used. Media in these probes was synthetic.
