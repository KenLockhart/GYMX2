# Form Coach assessment pages

The assessment pages provide a coach queue, member inbox, numeric results, and current coach review controls over the authenticated Form Coach RPCs.

## Pages

- `/form-coach/assessments` shows the current coach's assessment queue. Its status filter uses the database statuses `sent`, `in_progress`, `completed`, `cancelled`, and `expired`.
- `/form-coach/assessments/[assessmentId]` shows an authorized coach the assessment details, finished attempt results, numeric score history, and latest review feedback.
- `/form-checks` shows the signed-in member's assessment inbox and history. It remains available through `requireAuthenticatedAccount`, including when the member's platform entitlement or Form Coach feature is no longer active.
- `/form-checks/[assessmentId]` shows only the authenticated member's own assessment detail.

Both lists request at most 20 rows per page. Due timestamps display their stored time in UTC with an explicit zone label, so a deadline near midnight is not shown as an ambiguous date-only value. Sent, review, and attempt-finished timestamps display the UTC calendar date with the zone stated. The member list uses `list_my_form_coach_assessments`; that RPC does not accept a status filter, so the member inbox does not pretend to filter a single returned page as if it were the complete history. Coach status filtering is performed by `list_coach_form_coach_assessments` in the database.

## Read boundaries

`workflow-server.ts` and `review-server.ts` use the authenticated Supabase client for queue and detail reads. The server validates each RPC output against a strict DTO before rendering it. The member detail reader pins the expected member role; the coach review reader requires the current coach role, and its RPC reuses the current coach-link and ownership checks from the shared detail contract. Only a coach detail response that includes an authorized `member_id` can produce a member-profile link. Admin and moderator roles have no alternate assessment view.

The member pages render only fields returned in the narrow workflow DTOs: assessment status and dates, exercise setup, finished numeric scores and form flags, summary state, and latest coach feedback. Coach detail uses a separate typed review projection that adds the current per-item review sequence and bounded capability flags. It reuses the existing privacy-filtered detail RPC and returns no review sequence to members. Neither role receives storage paths or clip URLs, and reference assets are not signed by these pages.

## Coach review

For an eligible item, the coach can record Learned or Needs Work against a specific finished attempt, with up to 1000 characters of optional feedback. A Needs Work review can optionally open a bounded retry window on the existing assessment. The form posts its displayed review sequence and a per-form idempotency UUID; the server verifies the selected item and finished attempt through the authenticated coach projection, then calls the existing `record_form_coach_review` RPC without replacing that sequence. The database remains authoritative for current coach membership, deletion fences, funding, feature availability, retry limits, exact request replay, and compare-and-swap.

After a recorded review or exact replay, the coach detail and member history paths are revalidated. The database queues an internal notification event, but this UI does not claim that a message was delivered. Starting or resuming attempts and assessment setup remain separate interactions. Feature-disabled and otherwise ineligible history stays readable while review controls are withheld. Missing or unauthorized details use the same generic unavailable-to-this-account copy so the page does not reveal another member's assessment.

## Validation scope

Local validation passed 33 rollback-only database assertions, 34 mocked UI and server tests, and an isolated ReactDOM fixture for saved, uncertain, retry, and rejected-action lifecycles. The browser fixture used synthetic actions only; it did not validate a live Next.js request, Supabase Auth session, notification delivery, or external provider execution.
