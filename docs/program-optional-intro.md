# Optional Program intro

Program intro video remains a nullable preview field. Paid authoring may publish a Program without an intro. When a creator supplies an intro, publication still requires its exact ready, owner-matched `program_intro` binding and the existing account, deletion, fence, UID, asset, and event checks.

The additive `20261119062500_program_optional_intro.sql` migration replaces only `public.publish_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid,uuid,integer,smallint)`. It wraps the existing non-NULL intro validation in `IF program_row.intro_video_id IS NOT NULL`; it does not change lesson validation, locks, free-content snapshotting, current pointers, offer terms, receipts, or the service-only ACL. A NULL intro creates no `program_intro` source binding.

An attached intro’s UID normally becomes `shared`. That is valid for previewing the intro; migration 610 still prevents that UID from becoming a paid-lesson origin. Intro removal must not make the shared UID eligible again.

## Verification status

Local SQL verification ran on the disposable `gymx2_program_optional_intro_20261121n1` clone of `gymx2_program_media_origin_20261121p5`. Migration 625 was hash-matched and applied once atomically. The replaced publisher passed `plpgsql_check` with zero errors and one unused-local warning (`selected_video`, line 10); its owner, `SECURITY DEFINER`, empty `search_path`, and execute ACL match the prior function. It has no attached trigger.

The new rollback-scoped `program_optional_intro_test.sql` passed 41/41 assertions. The unchanged 600 authoring TAP passed 111/111 and the unchanged 610 media-origin TAP passed 72/72. Each suite ran standalone, reported its complete sequential plan and `finish`, and ended with an explicit `ROLLBACK`; each had zero SQL errors and exit code 0. Read-only baselines after the suites returned to 3 auth users, 3 profiles, 0 Programs, 5 videos, 0 origin rows, the one immutable origin epoch, all 30 public Program tables empty, all 10 stream-media 315 tables empty, and the five required cleanup components unchanged. The P5 source database was not modified.

The optional-intro TAP uses the normal 315 upload/readback producer for paid lesson media. It covers free enrollment and completion before conversion, coach free-to-paid publication without an intro, a later paid revision without an intro, exact publication replay, immutable free progress, the stored payout destination, and no fabricated intro binding. It also covers an admin-owned free platform Program converted to a text-only paid version without an intro or payout destination. The 610 suite separately verifies the valid shared-intro lifecycle and rejects reuse as a paid-lesson origin.

The unchanged creator-intro TAP was not part of this local run. Its wrong-owner and unready-intro rejection cases therefore remain unverified here. The existing non-NULL intro validation is preserved by the reviewed function-body comparison; a pending-deletion intro rejection was not independently runtime-tested. All fixtures used synthetic local SQL state; no live provider, hosted database, or external Auth request was used. QA logs, exact hashes, and the function-body comparison are recorded under `.vercel/program-optional-intro-qa/`. This change does not alter the current authoring UI or intro-upload/deletion flow.
