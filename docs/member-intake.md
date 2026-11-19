# Member intake

## Booking and consent

The first confirmed booking with a coach starts the intake flow. Calendar bookings count only after the member responds `going`; intro bookings are deduplicated from their linked calendar session. The booking is not cancelled or blocked while intake is incomplete. A member must review the final consent and submit the form before a coach receives answers. A second booking with an already-authorized coach does not require another intake.

A new coach receives no health data until the member reviews and explicitly shares a submission for that coach's confirmed booking. The database verifies the booking pair inside the completion transaction. Admins do not receive health-data access.

## Data access and editing

`member_intakes` stores one current draft or submitted form per member. `member_intake_injuries` stores injury rows separately. `intake_coach_access` records the exact member-approved coach grant, and `member_intake_history` keeps the last submitted snapshot when an edit begins. `member_intake_reminder_claims` holds retry-safe email delivery state. A first-attempt timestamp is recorded before the provider call and preserved across retries. Because Resend keeps idempotency keys for 24 hours, retries stop after 23 hours; an ambiguous delivery beyond that cutoff is not resent, and a reminder already marked sent is immutable.

Members can read their own draft and history. Coaches can read a completed current submission or its prior submitted snapshot only when an exact `intake_coach_access` row grants them access. Draft answers are never stored in a coach-readable table. Table writes are revoked from authenticated users; the member draft and completion RPCs validate answer allowlists, role, consent, booking, and grant.

The app checks the exact coach grant and submitted-history state before rendering a member's live room or issuing private/group media credentials. Direct reads of legacy `session_live` playback rows apply the same member check in RLS. Session and intro emails and the calendar UI use an internal `/calendar/{id}/join` route; it checks access again and redirects only to the current stored HTTPS meeting URL without embedded credentials. Previously distributed third-party meeting URLs and existing direct reads of `calendar_sessions.meeting_url` cannot be revoked by this route or RLS change.

When a member edits a submitted form, the current record changes to `draft` and the previous completed version is copied to history in the same transaction. Existing coaches continue to see only that last submitted snapshot until the member submits again. A new coach cannot read either draft or history before the member grants access.

## Reminders

The authenticated Vercel cron route runs every five minutes and considers confirmed sessions about 24 hours or two hours away (15-minute windows). It skips coaches already granted access. Claim rows prevent parallel sends, expire after five minutes, and allow retries up to five attempts while still within 23 hours of the persisted first attempt. Resend retains an idempotency key for 24 hours; an ambiguous attempt beyond the 23-hour retry cutoff is left unsent again so an expired key cannot create a duplicate. The email contains only member/coach names, session time, and an `/intake` link that returns through the internal session join route after submission; it never includes answers, injury details, or health notes.

## Plan-input estimate

`buildPlanInputs` is a calculation stub for coach review, not a recommendation or prescription. It estimates BMI and Mifflin–St Jeor basal energy, applies the member-selected activity factor, and exposes a 500 kcal/day reduction as a draft input. It returns no calorie estimate if sex or activity level is unavailable. The Mifflin–St Jeor equation was validated against indirect calorimetry in adults ([original study](https://pubmed.ncbi.nlm.nih.gov/2305711/)); an individual estimate still has substantial uncertainty.

Protein input is an explicitly labeled range around `max(210 g, current weight × 0.85)`, using 0.8×–1.0× of that anchor and 0.9× as the displayed midpoint. Weight stages reduce each prior stage by about 8%, stop at the member's valid goal, and are capped at 20 stages. Adult weight cycling is flagged when highest weight minus lowest observed adult weight exceeds 30 lb; current weight is the observed-low fallback when no low is provided.

For no-weight-bearing restrictions on an ankle, foot, or knee, the stub excludes standing and impact work and adds a side-specific load tag such as `loads_right_ankle`. `exerciseClearanceRequired` is set when the member says clearance is `no` or `not_sure`. These values are guardrails for a qualified coach; they do not create or persist a workout plan.
