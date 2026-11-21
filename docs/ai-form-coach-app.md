# Form Coach assessment pages

The assessment pages provide read-only queue and history views over the authenticated Form Coach RPCs.

## Pages

- `/form-coach/assessments` shows the current coach's assessment queue. Its status filter uses the database statuses `sent`, `in_progress`, `completed`, `cancelled`, and `expired`.
- `/form-coach/assessments/[assessmentId]` shows an authorized coach the assessment details, finished attempt results, numeric score history, and latest review feedback.
- `/form-checks` shows the signed-in member's assessment inbox and history. It remains available through `requireAuthenticatedAccount`, including when the member's platform entitlement or Form Coach feature is no longer active.
- `/form-checks/[assessmentId]` shows only the authenticated member's own assessment detail.

Both lists request at most 20 rows per page. Due timestamps display their stored time in UTC with an explicit zone label, so a deadline near midnight is not shown as an ambiguous date-only value. Sent, review, and attempt-finished timestamps display the UTC calendar date with the zone stated. The member list uses `list_my_form_coach_assessments`; that RPC does not accept a status filter, so the member inbox does not pretend to filter a single returned page as if it were the complete history. Coach status filtering is performed by `list_coach_form_coach_assessments` in the database.

## Read boundaries

`workflow-server.ts` uses the authenticated Supabase client for queue and detail reads. The server validates the RPC output against strict DTO schemas before rendering it. Each detail page pins the expected account role before calling the shared detail reader; the detail RPC also enforces current coach membership or member ownership. Only a coach detail response that includes an authorized `member_id` can produce a member-profile link. Admin and moderator roles have no alternate assessment view.

The pages render only fields returned in the narrow workflow DTOs: assessment status and dates, exercise setup, finished numeric scores and form flags, summary state, and latest coach feedback. They do not render member identifiers, storage paths, clip URLs, or media. Reference assets are not signed by these pages.

The current UI is read-only. It does not offer session setup, attempt start/resume, or coach review submission. Those actions require their own complete interaction and sequence checks. Missing or unauthorized details use the same generic unavailable-to-this-account copy so the page does not reveal another member's assessment.
