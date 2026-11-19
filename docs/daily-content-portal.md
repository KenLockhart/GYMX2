# Daily Content portal

Daily Content lets coaches and admins reuse approved videos, quotes, and affirmations in dated member-facing slots. It replaces the dashboard's sample quote and affirmation with authored, authorized content while keeping legacy member video assignments intact.

## Current behavior

- Coaches manage their own items at `/library/daily-content`; admins manage their admin-owned fallback collection at `/admin/daily-content`. Both use the existing Library upload path. Admin content cannot republish a coach-owned video.
- `daily_content_items` stores a reusable item and status; `daily_content_revisions` preserves each saved version; `daily_content_slots` publishes a specific revision for an Eastern calendar day. The manager pages videos and items, reports when nested history reaches its safety limit, and rejects edits or publication through authenticated server actions and database RPCs.
- For each content kind, the member resolver chooses today's slot from the member's most recently linked coach, then an admin-owned fallback. A legacy `member_daily_fuel_assignments` video remains the strongest Video of the Day grant and wins over both Daily Content sources. Missing content shows a localized empty state.
- The member server loader validates the Eastern day and resolver row before signing the exact ready `members` or `private` video. It rechecks the resolver after signing. Cloudflare UIDs and playback URLs are never sent to an unauthorized client, and general Library RLS is unchanged.
- A member can save today's resolved video. Saved playback requires the member's bookmark plus either a nonfuture legacy assignment or the exact Daily Content grant recorded at save time. A slot alone does not create Saved access. Unbookmarking removes the new grant; legacy Saved access remains supported.
- Affirmation acknowledgment is tied to the exact published revision and Eastern day. Publishing a changed revision starts unacknowledged while prior acknowledgments remain in history. Invalid, stale, or future acknowledgment requests fail.
- The Library delete action reserves the video row before calling the provider. While reserved, Daily Content cannot publish or reuse the video. Provider 404 is treated as already deleted; other provider failures leave the reservation for a safe retry. The database trigger rejects direct authenticated video deletion, while the account-deletion cascade remains supported.

## Data and deletion rules

Migration `20261119010000_daily_content_portal.sql` adds five RLS-protected tables: reusable items, immutable revisions, dated slots, per-member video grants, and revision acknowledgments. Anonymous access and direct authenticated writes are revoked. Narrow security-definer RPCs check the caller's current role, ownership, coach-member link, Eastern day, video readiness/visibility, and exact member authorization.

Video revisions reference `videos` with `ON DELETE SET NULL`. Physical deletion is refused while a video is linked to an active Daily Content item or referenced by a current/future slot, a saved grant/bookmark, a current legacy assignment, or a task. An archived or past unsaved revision can remain as history with `video_id = NULL` after privacy deletion; the member resolver cannot play that tombstone. Archiving by itself does not guarantee the provider asset is deletable. Failed or uncertain provider deletion retains the pending reservation. The owner-profile cascade can remove owned content during account deletion without granting browsers a direct-delete bypass.

Coach selection is deterministic because `coach_members` has no primary-coach field: the most recently linked current coach wins (`created_at DESC, coach_id ASC`). If there is no current coach, the member gets the admin fallback. Admin fallback items can reference only the publishing admin’s own uploads.

## Verification

- Full Vitest run: `npm test -- --maxWorkers=2` — **115 files, 931 tests passed**. Afterwards, UI/Saved test-fixture type corrections were checked with their focused suites; no behavior code changed for those corrections.
- Next route types: `npx next typegen` — passed. Full TypeScript check: `npx tsc --noEmit --pretty false` — passed.
- Lint: `npm run lint` — passed with no warnings.
- Production build: `npx next build --webpack` with deliberately unusable loopback Supabase values (`http://127.0.0.1:59999`, `synthetic-public-key`, `synthetic-server-secret`) — passed compilation, TypeScript, and static generation (**82 pages**). No real Supabase credentials were loaded.
- SQL rehearsal used only disposable local database `gymx2_daily_content_portal_test_20261119c`, cloned from the approved clean baseline `gymx2_member_access_rollout_test_20261119a`. The final migration was applied once in an atomic transaction; the TAP test passed **88/88** and rolled back all fixtures. Postcheck remained at ledger 56 / latest `20261118151000`, with zero users, profiles, programs, items, revisions, slots, grants, or acknowledgments. No hosted database, provider, or source/default database was changed.
- Final raw SHA-256: migration `53B63A2D8F9A799D08336594824D430AAFE827F6B598595DF45EFDDB13B2AD41`; TAP `F755233F83C2307495BD1EA7E14FC2250331687BA7F3C3317AF740ADC668C2BB`.
- Separate rollback-only lifecycle TAP passed **26/26** on approved local clone B (`supabase/tests/daily_content_lifecycle_test.sql`, SHA-256 `AB1691A49535E857C45DF796ABF1D690AEAD79F0CBD915028F816731E1EA99A0`). It covered scheduled-day rollover, deterministic coach choice, and saved-grant behavior after unlink/slot replacement. The clone returned to its pretest fixture counts and migration ledger.
- The controlled two-connection deletion/publication race passed all four cases once. Sanitized evidence is in the ignored local artifact `.vercel/daily-content-race-qa/results/run-65d20eda1c.json` (SHA-256 `2C99C59F077074F893D10B72DE52AF5E0D57A973B3C79771C8140EF1B7BE1AEE`). Each run observed a distinct PID and a `transactionid` lock wait; elapsed times were 5.643s, 5.634s, 5.421s, and 5.222s. Cases 1 and 3 rejected with `23503`; cases 2 and 4 rejected with `55000`. Postcheck on B retained its six test profiles, four videos, three items, three slots, and one saved grant/bookmark; there were no owned sessions, and its migration ledger/helper were unchanged. Clone C's clean source baseline also remained unchanged.
- A temporary local preview route was removed after attempted visual QA, along with its stale ignored dev route-validator artifact; port 3217 is stopped. Native visuals remain unverified: the selected Edge window stayed minimized, the UI tool detected user input, and the isolated in-app browser was unavailable. No screenshot or visual pass is claimed. No live Cloudflare upload, provider playback, or real member session was tested.

The lifecycle and race evidence comes from approved local disposable-clone tests, not hosted data or production-provider traffic.
