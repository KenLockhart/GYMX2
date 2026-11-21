# AI Form Coach app contracts (Phase 3A)

This phase adds narrow, typed reads for the first coach and member app screens. It does not add a
route or UI, change the frozen workflow/billing migrations, upload media, send notifications, or
call an AI/provider API. The new SQL depends on the Form Coach billing and workflow schema from
`20261118160000_feature_pricing_billing.sql` and `20261119040000_form_coach_workflow.sql`.

## Coach assessment queue

`public.list_coach_form_coach_assessments(target_page, target_page_size, target_status)` is an
authenticated, coach-only projection. Page size is 1–50, page is clamped at 1,000,000, and status
must be one of the persisted 400 states: `sent`, `in_progress`, `completed`, `cancelled`, or
`expired`. Rows are ordered by `sent_at DESC, id DESC`. The current coach must own the assessment,
the owner profile must still exist, and the current `coach_members` relationship must match.
Admin and platform-wide payer authority do not appear in this projection.

The queue returns `assessment_id`, `member_id`, `source_kind`, `program_title`, `sent_at`, `due_at`,
the stored `status`, item and finished-attempt counts, and the frozen `allow_member_clip` setting.
The queue does not pretend that the base migration persisted a due-expiry transition: consumers
must display the stored status and deadline honestly. Bounded expiry persistence remains a separate
workflow change.

## Assessment detail

`public.get_form_coach_workflow_detail(target_assessment_id)` is authenticated-only and wraps the
existing `get_form_coach_assessment` projection. It does not widen that function's member/coach
visibility or return admin detail. It adds the frozen `allow_member_clip` setting; coach detail also
includes the linked `member_id` for the coach queue. It does not return a coach message because the
current send RPC has no immutable message field and does not include a message in `send_digest`.

For members, `can_attempt` is only true when the existing database projection permits use, current
terms are accepted, and at least one item has an actual start or resume action. Each item has separate
`can_start_new` and `can_resume` flags. A fresh start is false while that item has any live lease,
an expired running reservation, or no allowance. An expired running reservation can be resumed
even when its allowance count is exhausted, matching the base start RPC's resume-before-limit
ordering, while the due window remains valid or the exact item has a current `needs_work` retry
window. A reservation that survives past due cannot resume without that retry, regardless of its
original start time. A retry on one item never enables a sibling.
The detail read returns no request ID or lease token: a future member action must generate a fresh
request UUID for resume. When resumable, `resume_clip_opt_in` carries the member's own prior choice
so that the start RPC receives the exact consent value required for lease rotation. It is null when
the item cannot resume and is never used to return a lease token. The start RPC remains the authority
if state changed after this read. Coaches can review history but never receive member start/resume
capabilities.

The start capability also requires current member terms consent, member base access, a current
coach-member link, valid feature funding mode, and no deletion fence on the acting member, the
assessment member, coach, or payer. A tombstone or removed link closes new use while preserving the
owner's historical detail. The final start RPC rechecks state and remains authoritative.
Heartbeats recheck current role, member access, coach link, feature, funding, consent, and deletion
fences. They cannot renew an expired lease, and each renewal stops at the current due or exact retry
window deadline. An already-unexpired lease may finish during its remaining bounded grace after due;
once that lease expires, resume requires the exact open retry window.

The detail contract preserves history independently from current use eligibility. An owner can still
read an existing assessment after the base membership expires or Form Coach is disabled; the
projection sets `can_attempt` false in those states. The separately authorized clip-delete and
account export/privacy workflows remain outside this phase.

## Pinned reference reads

`public.service_read_form_coach_reference_asset(target_actor_id, target_assessment_id,
target_item_id)` is executable only by `service_role`. The server obtains the actor from
`requireAuthenticatedAccount()` and passes only that actor ID plus the assessment/item IDs. The
service RPC rechecks the actor's current member/coach role, the exact current member ownership or
assigned coach relationship, member base access and feature/payment conditions for member viewing,
and deletion fences for the actor, assessment parties, payer, and template asset owner. Reference
viewing does not require camera-practice consent; the separate attempt start still does.

The function derives `assessment -> item -> published template version pinned by that item ->
private_verified reference claim`. It accepts no path, asset ID, bucket, TTL, version, or URL from the
caller. An archived template does not invalidate a published version already pinned to an
assessment. Members cannot get a new reference URL after expiry unless the exact item has an active
authorized retry window. During that retry, its `closes_at` is the effective deadline even when the
original assessment due date is earlier; the original due date does not shorten an active retry link.
An assigned coach may read historical pinned reference media while the current coach/member link
and relevant non-deletion-fenced identities remain valid.

`createFormCoachReferenceReadUrl(assessmentId, itemId)` is the only exported signer entry. It
validates both UUIDs, gets the current account internally, calls the service-only RPC, validates the
strict descriptor and exact path shape, then signs only the fixed `form-coach-reference` bucket at
no more than 600 seconds. This read-only resource does not consume an assessed attempt, require an
unused allowance, or depend on whether the member currently has a running lease. It does not require
camera-practice consent; the separate future local-practice/start flow must obtain current terms
consent before requesting camera access or starting an assessed attempt. Member access still checks
the current member role/base tier, coach role and link, valid receipt or live member-payer mode,
feature status, and deletion fences. A closed assessment or an expired due date requires an active
retry window for that exact item. The exact retry `closes_at` is the effective deadline, regardless
of whether it is earlier or later than the assessment due date. Current assigned coaches may read historical pinned media while their relationship and
relevant identities remain valid.

The RPC returns the database-computed remaining seconds for members, and 600 seconds for coaches
with no assessment deadline. The server starts a monotonic timer before the authorization RPC,
subtracts the full elapsed time, and reserves five seconds for signing latency for both roles before
requesting the URL. A zero-latency coach link therefore requests at most 595 seconds, with RPC time
reducing that further. After the Storage call, the server checks against the raw conservative budget
again; slow signing that consumed the safety reserve is discarded and the URL is not returned. All
links remain capped at 600 seconds. The server does not authorize from the application wall clock.
The private bucket/path descriptor never goes
to the browser; only the short-lived URL is returned to a server-side caller. A signed URL cannot be
revoked instantly after creation, so deletion/role/link changes may leave an already returned URL
valid until its short expiry.

The `private_verified` claim is treated as the database's current trust assertion. This contract
does not implement or prove the actual server-side byte, MIME, duration, or source attestation; no
Storage HTTP request is made by the tests. Upload verification remains a separate release gate.

## Server and client boundaries

`workflow-contracts.ts` strictly parses the persisted DTOs and rejects arbitrary reference paths,
encoded traversal, absolute URLs, extra URL fields, and mismatched owner/version path segments.
`workflow-server.ts` uses the authenticated Supabase client for the coach queue and detail RPCs. It
uses the service client only for the typed signer lookup and exact Storage signing operation. It
never reads any new Form Coach table through `.from()` and does not export a general-purpose asset
signer.

The caller still needs to provide full-document entry/exit for the runtime CSP. The member flow must
complete legal terms/consent and its camera/setup checklist before `start_form_coach_attempt`; the
database can verify terms and consent but cannot prove client camera readiness. Practice remains
uncharged and non-persistent; only assessment attempts persist bounded numeric results. Frames,
video, landmarks, intake, and raw notes do not enter these DTOs or any LLM request.

## Deferred contracts

- A versioned manual-send RPC is still needed before the app can collect an optional immutable coach
  message included in the send digest. Do not add it with a post-send row update.
- The template editor still needs a safe asset projection for current draft versions; the signer
  contract here only resolves an assessment item's pinned published reference.
- Persisted due-expiry processing, bounded summary/notification outbox claims and retry/backoff,
  notification enum integration, actual member clip upload verification, and deletion/export
  wiring require separately owned changes.
- Programs remain coach-owned only. Platform-owned Program Form Checks and an admin/platform payer
  flow are not enabled by this slice.

## Verification status

TypeScript and mock tests can verify contract parsing, argument derivation, expiry clamping, and
that invalid descriptors never reach Storage signing. pgTAP uses synthetic Auth identities, grants,
receipts, and source-proof fixtures inside a rollback transaction; those fixtures are not live
entitlements or media evidence. Do not run the new database test until the release owner supplies
the approved disposable database name, dependency/baseline, and migration hash packet. No hosted
migration, Storage HTTP call, or provider operation is part of this phase.
