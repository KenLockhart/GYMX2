# Group live critiques

Group critiques are a separate RealtimeKit meeting for broadcast calendar sessions. Existing
Cloudflare Stream broadcasts and private one-to-one live rooms keep their current paths. The new
feature is unavailable until its RealtimeKit configuration is present, bound to the database by
the cleanup worker, and verified against the preset rules below.

## Current readiness (2026-11-18)

PR72 and PR73 are merged and deployed. Hosted migration history contains 49 applied migrations;
latest is `20261117230000`. Platform migrations `20261117220000` and `20261117230000` are applied;
group migration `20261116010000` is not applied.
Five non-secret RealtimeKit settings are configured: account, app, and the three preset names. The
RealtimeKit API token is still pending setup through the correct Vercel authentication. No group
cleanup heartbeat has been recorded, so the feature remains unavailable until the database migration,
secret, and real cleanup heartbeat are in place.

The latest 26-participant attempt joined all 26 actors, staged all 25 members, and completed publish
for all 26 actors. Strict receive validation matched 0/650 audio pairs and 575/650 video pairs. All
26 clients saw 25 participant tags. The run is not a capacity pass; the cause of the incomplete media
measurements remains unconfirmed because the artifact does not include component diagnostics.
Cleanup deleted all 26 participants, verified the meeting
inactive, and stopped the owned processes. Evidence: `.vercel/group-critique-qa/results/run-9c1e7e19-2b3c-4420-966c-4892e4712eab.json`.

The combined current tree passed `npm run lint`, `npx next typegen`, `npx tsc --noEmit --pretty false`,
`npm test -- --maxWorkers=2` (673 tests across 69 files), and `npm run build` (75 static pages).
PR71 remains unmerged; the current 25-member application cap still needs a successful media-capacity
verification before rollout.

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
screenshare production disabled. Set `max_video_streams` to at least 26 for both desktop and mobile
on all three presets; the existing setting of 31 remains valid. Cloudflare defines this field as the
maximum number of video streams visible per device, a receive-visibility setting
([preset API reference](https://developers.cloudflare.com/api/resources/realtime_kit/subresources/presets/methods/get_preset_by_id/));
it does not guarantee outbound publisher capacity:

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
- A room supports up to 25 invited members plus the coach. Pending calendar RSVPs are included;
  a “Going” RSVP is not required. New calendar invites beyond 25 are rejected for broadcast
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

Before rollout, run a real-account verification with one coach and 25 members. Confirm stage
requests, per-participant stage grants, selected/all mute behavior across reconnects, token expiry,
participant removal/rejoin, and meeting deactivation. This implementation deliberately imposes an
application cap of 25 members plus the coach; provider account capacity and the browser's practical
receive capacity still need runtime verification at 26 total participants.

## Provider verification record

2026-11-16: the exact GYMX2 account/app and all three preset definitions verified successfully. A
two-person synthetic coach/member SDK probe published audio and video from both participants and
decoded the other participant's video on each side. A three-person run later joined all three,
confirmed no automatic capture, published synthetic audio/video, and decoded two remote videos on
each client. A preliminary mute check observed advancing RTP counters after mute; because RTP can
continue while carrying silence, this alone was not an audio-mute result.

The following three-person mute measurements are historical and came from the earlier QA path
that manually called the provider permission update API. That unsupported probe has been removed;
these measurements are not evidence for the production helper path or for provider-enforced
microphone denial.

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

2026-11-17: QA startup now compiles the five public harness pages and the server-only RealtimeKit
adapter into separate ignored build directories. The local-only route check returned HTTP 200 for
all five HTML routes and seven referenced JavaScript assets, with no setup-file read, provider
request, or resource creation. The read-only live-server preflight verified the exact account, app,
and presets, then returned HTTP 200 for the same pages and assets. Runtime static serving reads only
the public client build; the server adapter bundle is outside that root. The previous Vite development
server route timeouts are resolved by serving the prebuilt client files with the loopback Node HTTP
server.

Two bounded three-person controls attempts on 2026-11-17 joined three synthetic participants and
published synthetic audio/video from all three. Both observed advancing inbound energy for both
member sources before host mute (approximately 0.00018–0.00022 over 1.2 seconds with the audio sinks
playing), then stopped at `remote-mute-state-timeout`; both cleaned up all three participants and
verified the meeting inactive. A focused retry recorded that the host's public
`canChangeParticipantPermissions` flag was true and its mute operation returned two updated peers.
After 10 seconds, both members' public audio permission still read `ALLOWED`, although their audio
was disabled and each live track's `enabled` flag was false. No reconnect denial attempt or
explicit-allow positive control was reached. This does not establish settled `NOT_ALLOWED` behavior,
and the harness's manual host provider permission operation does not test the application's persisted
reconnect policy. No 31-person media run was authorized or performed.

A third, focused three-person diagnostic on 2026-11-17 corrected the identity check to pair expected
public user IDs with peers by `customParticipantId`, independent of SDK join order. Both identities
matched their expected tags (2/2), the host still reported permission-change capability, and the
public async error observer recorded no errors. After the bounded 10-second settlement window, both
members still reported `ALLOWED`; audio remained disabled and each synthetic audio track remained
live but disabled. The run stopped at the same `remote-mute-state-timeout`, so the post-settlement
denial attempt and explicit-allow positive control were not reached. Cleanup deleted all three
participants and verified the meeting inactive. The runner's initial process-shutdown wait returned
false; a follow-up OS query found no Edge process tied to that run's isolated profile and no Node
process tied to the QA harness. At that point, no further provider retry or 31-person media run had
been performed.

2026-11-17: the controls harness now imports the production group-critique media helpers and uses an
in-memory server-held policy fixture that persists per-member mute state across synthetic leave and
rejoin. This fixture does not exercise the hosted application DOM or database authorization. The
harness uses the public RealtimeKit `peer.disableAudio()` method and confirms the public peer flags
and local application-policy helper result; it does not change provider media permissions or claim
a provider hard lock.

One bounded three-person run passed its start and media baseline checks: all three synthetic actors
joined with capture off, both members reached the stage, and all three published synthetic audio
and video. The four member-source directed audio receiver pairs advanced inbound energy by roughly
`0.000174`–`0.000282` over 1.2 seconds and their sink times advanced; all six directed video pairs
advanced RTP packets, decoded-frame counters, and attached video sinks with stable receiver
identities. The host applied the persisted group mute, the public host peer audio flags were off,
the member-side production helper disabled each local mic without an extra capture, and video
remained enabled.

The run stopped at its first strict group-mute silence assertion. Over a 1.2026–1.2028 second sample,
inbound `totalAudioEnergy` still rose on all four member-source receiver pairs while packet counters
and sink time advanced. The deltas were `+0.0000056960` and `+0.0000102791` for member 01 at the coach
and member 02 receivers, and `+0.0000170318` and `+0.0000242977` for member 02 at the coach and member
01 receivers. Each receiving peer reported `audioEnabled=false`; its remote track was still live,
reported `enabled=false`, and remained attached to a playing sink. The harness did not record exact
wall-clock time since each disable confirmation, local outbound sender counter progression, or
decoded playback samples, so this evidence cannot distinguish buffered decoder tail from continued
encoded media and does not establish audible output. Selected allow, explicit re-enable, reconnect,
and remute checks were not reached. The strict zero-energy criterion was not weakened.

The run was cleaned up after the failed assertion: all three participants were deleted, the meeting
was verified inactive, and the owned Edge/server processes stopped. The following local-only checks
also passed before the run: the exact account, app, and preset definitions were read-only verified;
the native static server returned HTTP 200 for five harness pages and seven referenced assets; and
direct setup-file access returned HTTP 403. These preflights created no provider resources.

After reviewing the measurement model, the harness was updated to add a per-receiver Web Audio
time-domain analyser for the three-person controls only, plus sample timestamps, host/member disable
request and confirmation times, local sender counters, and two 1.2-second windows after a bounded
two-second settle. Its byte-domain output level requires exact zero for silence and a nonzero
synthetic positive control; inbound RTP energy remains a separate reported counter. The analyser is
disabled on the 31-client harness to avoid adding hundreds of nodes to a capacity measurement.

One later bounded `--mute-only` run on 2026-11-18 exercised this measurement path. The three synthetic
actors joined with capture off, both members staged, and all three published synthetic audio/video.
All six directed audio and six directed video baseline pairs passed. After persisted group mute, all
four member-source audio pairs passed both post-settle windows: exact receiver/report identities
remained stable, public peer audio and remote-track enabled flags were off, packets and attached sink
time continued advancing, and consumer PCM RMS stayed exactly zero. Coach-source audio also remained
positive, and all six video receiver pairs continued decoding. Inbound RTP energy changes were
collected as separate diagnostics and were not used as the playback-silence gate.

The run then passed the selected-allow-without-auto-capture check and stopped at
`selected-audio-enable-timeout` during the explicit microphone positive control. At that time, the
wait predicate required audio enabled, a live enabled track, and a greater `getUserMedia` counter.
The final action response and member state were not saved in a run artifact; the long console result
was truncated by the tool. Therefore this run does not establish whether the enable helper rejected,
whether the SDK re-enabled an existing track without another capture call, or whether the track failed
to become live. Exact per-pair RTP energy deltas and sender-counter snapshots from this run are also
unavailable. Individual mute/re-enable, member 02 reconnect, immediate stale-policy attempt, and
reconnected remute were not reached. No 31-person media run was performed.

The run took about 36 seconds end-to-end. Its manifest records meeting creation at
`2026-11-18T03:56:01.731Z`, the meeting inactive after cleanup, and all three participants
`deleted-confirmed`. The runner reported `owned-processes-stopped=true` and `cleanup=confirmed`.

The local harness now treats an explicit audio enable as accepted when the production helper
authorizes it and public self-audio state reports an enabled live track; the action's capture-call
delta is retained as evidence but need not increase when the SDK reuses an existing track. The
following exact mapped remote PCM/RTP positive control remains required. The preceding selected
allow and reconnect checks still require no capture and devices off before the member's explicit
action. Per-action diagnostics retain before/action/immediate-after state, policy and eligibility
revision, hashed local track identity, capture delta, and mapped remote samples. The runner now writes
the complete sanitized structured result and phase checkpoints to an ignored QA result artifact
before emitting its concise console summary. Local round-trip tests verify that credential, raw
message, peer-ID, and participant-ID fields are excluded while action states and media counters are
retained. This diagnostic change does not revise the result of the prior timeout run.

A later bounded run used the corrected live-track re-enable gate and wrote its full sanitized result
before the console summary. It completed all three actors and all mute, selected explicit-enable,
individual mute/re-enable, and reconnect checks in 50.68 seconds. The group-mute check observed zero
consumer PCM RMS on all four member-source receiver pairs in both 1.2-second windows after the
two-second settle; every pair retained its receiver/report identity while RTP packets and sink time
advanced. Inbound RTP `totalAudioEnergy` was unchanged in these eight windows. Coach-source audio
continued positive during the member mute, and video remained live.

For member 01, selected allow did not capture or enable audio. The explicit action was authorized by
the production helper; the public self track became enabled and remained live with the same hashed
track identity and no additional capture call. Both mapped receivers then had positive PCM RMS and
advancing RTP energy/packets/sink time. The same track-reuse behavior passed after individual mute.
Member 02 rejoined with audio/video off and zero captures. A stale allowed snapshot attempt was
blocked by fresh synthetic policy authorization with zero captures; the host re-applied the persisted
mute, and selected allow again did not enable audio or capture. The later explicit action acquired a
live enabled audio track and both mapped receivers passed the positive PCM/RTP check. Final member-02
remute passed both receivers' consumer-silence check, while member 01 remained enabled and both of
its receivers remained positive. Video also continued advancing after remute.

The original structured artifact reported `partial` because the final `otherMemberStillSends` field
contained its detailed result object where the summary gate expected a boolean. The artifact records
that object as `passed=true` with 2/2 exact receivers; their track/report identities were stable, peer
audio and track-enabled flags were true, PCM RMS was positive, and packets, energy, and sink time
advanced. All other required controls were already recorded as true. The harness now stores the
boolean under `otherMemberStillSends` and the receiver measurements separately under
`otherMemberStillSendsReceivers`; a local regression covers this aggregation shape. The original
artifact remains unchanged at
`.vercel/group-critique-qa/results/run-148d6c6d-a83c-4633-b557-9e429e44e38a.json`. This supports a
qualified three-person runtime result after offline reporter correction, not provider permission
hard-lock behavior or hosted DOM/database authorization.

The run completed cleanup with three participants deleted, the meeting inactive, and all owned
processes stopped. No retry or 31-person run was made. The existing synthetic video source is
160×90 at about 4 fps; this run does not establish production workout quality, fullscreen video
quality, or 31-person capacity. The local single-host capacity run would also be limited by its six
CPU cores.

For the capacity probe, the isolated client stops its capacity operation window at 150 seconds from
the beginning of the coach join operation. At 31 actors this caps the full-room measurement window
at 77.5 participant-minutes. The client uses a 180-second provisioning request timeout, and the
server adds room participants sequentially; cleanup marks the meeting inactive before deleting
participant records. The runner's 240-second outer probe wait bounds browser observation before
shutdown; if it expires, the runner closes the owned browser before posting the separate long-running
cleanup request. A timeout is a failed or incomplete run and cannot pass on partial receiver
coverage.

One approved no-flag capacity run started on 2026-11-18. Its local preflight, setup-file 403,
31/31 actor documents, and exact-account/app/preset checks passed. All 31 synthetic actors joined
and all 30 members reached the stage. Sequential publishing completed for 23 actors. Publisher 24,
`member-23`, timed out during `publish` with video enabled and audio not yet confirmed; its last
recorded public operation phase was synthetic `getUserMedia` complete. At that point the run had
48 synthetic capture calls, zero SDK error callbacks, and no safe public WebRTC or capture error
entries. No receiver subscription or media-metric collection began (`activeRtpClients=0`), so the
930 audio/video receiver pairs were not measured. This is a global capacity-window timeout during
the 24th publisher, not evidence of a provider participant cap or successful 31-person media.

The artifact records the operation start at `1794976251761` ms, publication beginning at 27.094 s,
publisher 24 beginning at 143.168 s, and the deadline failure at 150.401 s. The first joined actor
to browser close interval was 149.402 s. Sequential publishers 1–23 consumed 116.074 s; at that
observed pace, publishing all 31 sequentially would exceed the 150-second operation window before
the receive-coverage phase. The runner stopped at the timeout and did not retry.

Cleanup deleted all 31 owned participants, confirmed the meeting inactive, and stopped the owned
Edge and server processes. The full sanitized result and phase checkpoints are preserved at
`.vercel/group-critique-qa/results/run-8553f3a2-9309-4dea-a154-b1670627e1b4.json`. No 31-person
receiver-coverage result is established. Any future schedule change must preserve unchanged media
quality and wait for separate approval; this run used the existing 160×90 synthetic video fixture.

After these local changes, the static bundle build passed (`clientEntries=5`, server adapter kept in
the server-only build). The local-only route check returned HTTP 200 for all five pages and seven
assets, with no external requests, setup read, or provider resources created. The read-only live
preflight verified the expected account/app/preset definitions and the same routes/assets; setup-file
access returned HTTP 403. These checks were:

```text
node .vercel/group-critique-qa/build-static.mjs
node .vercel/group-critique-qa/check-local-static-routes.mjs
node .vercel/group-critique-qa/check-readonly-preflight.mjs
node .vercel/group-critique-qa/check-status.mjs
node .vercel/group-critique-qa/check-capacity-metrics.mjs
node .vercel/group-critique-qa/check-mute-evidence.mjs
node .vercel/group-critique-qa/check-publish-batches.mjs
node .vercel/group-critique-qa/check-result-evidence.mjs
node .vercel/group-critique-qa/check-synthetic-policy-fixture.mjs
node .vercel/group-critique-qa/check-identity-diagnostics.mjs
```

All listed commands passed. The synthetic capacity fixture verifies 930 mapped, advancing audio
pairs and 930 mapped, advancing video pairs; it is an assertion-logic test, not a 31-client provider
result. Synthetic video remained 160×90 at roughly 4 fps in the three-person run, so these results
do not establish workout-quality video at production scale or fullscreen fidelity. A single-host
capacity result would also remain bounded by the local six-core test environment.

After the incomplete 31-client run, the local-only capacity harness was changed to publish actors in
batches of up to three concurrent requests. It awaits every request already in a batch before
returning its first chronologically observed safe error and does not start a later batch after a
failure. The preset, synthetic 160×90-at-about-4-fps media, and 150-second operation deadline are
unchanged. A local mock regression verifies all 31 actors are called once at concurrency three; its
failure case verifies that a later batch is not started, in-flight work is awaited, and the earlier
failure is retained. The static client build, local route check, result evidence check, and 930-pair
capacity assertion fixture passed after this edit. These local checks do not establish provider
capacity; the subsequent approved provider attempt is recorded below.

One final approved 31-client attempt used the three-at-a-time publisher harness and the same
160×90-at-about-4-fps synthetic media. Preflight and setup-path denial passed; all 31 actor frames
were ready, all 31 clients joined, all 30 members reached the stage, and the first 30 publishers
completed. The final publisher, `member-30`, returned the sanitized `actor-command-failed` result
after 22,272 ms in its publish operation. Its last public phase was synthetic `getUserMedia`
complete; audio/video published flags and self audio/video enabled flags were false, stage status
was `ON_STAGE`, and no safe public media errors or SDK error callbacks were recorded. The capacity
operation failed at about 120.75 seconds from coach join start, before the 150-second deadline. The
result does not identify a more specific provider/media cause.

The harness stopped after that failed batch; receiver subscription and media metric collection did
not start (`activeRtpClients=0`). No directed audio or video receiver pairs were measured, so the
930-pair acceptance criteria were not reached and this does not establish full-room media or a
provider participant cap. The run recorded 61 synthetic capture calls. Cleanup deleted all 31
owned participants, confirmed the meeting inactive, and stopped the owned browser and server
processes. The complete sanitized artifact and phase checkpoints are at
`.vercel/group-critique-qa/results/run-cbe89ef8-02cc-418b-94eb-3a65c77b377a.json`; no further
provider retries are authorized by this attempt.

## Read-only provider diagnosis

Read-only provider evidence showed positive outbound producer activity for a neighboring successful
peer and none for the failed final peer. Both used the same preset and had the same
`media_permission` metadata shape. The verified presets are `WEBINAR`, stage-enabled, and permit 31
visible streams on desktop and mobile; Cloudflare documents `max_video_streams` as a receive-side
visibility setting, not an outbound publishing quota. The public SDK result exposed no underlying
exception. A read-only source comparison of SDK 2.0.4 with the reviewed 2.1.0 package found the same
empty `VideoMediaHandler` catch, so there is no evidence here that 2.1.0 fixes this failure. The
cause remains undetermined; these observations do not establish a provider cap or a browser-resource
cause. A distributed/multi-device 31-client run or a Cloudflare SDK/provider diagnostic is needed
before making a 31-person capacity claim. No such diagnostic or additional provider run was
performed in this verification.
