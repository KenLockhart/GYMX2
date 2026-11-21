# Program paid media private origin

Migration `20261119061000_program_media_private_origin.sql` adds a fail-closed origin check for new paid Program video lessons. It leaves the accepted 315 upload producer and 600 authoring/commerce definitions untouched.

## Activation

Installation is one transaction with a five-second table lock timeout. It takes `SHARE ROW EXCLUSIVE` locks across Program order/lesson writers, media source writers, and the canonical upload evidence tables before checking history or installing hooks. The migration aborts if any `program_orders` row or any actual `paid` content-version lesson exists. All hooks and the one-row immutable activation marker commit together. An upload operation whose creation predates the marker cannot qualify, even if it finishes after activation; migration activation does not claim to drain an HTTP request already in progress.

Existing `current` and `free_snapshot` versions remain unchanged and are never backfilled into a positive origin. A historical or absent UID is UNKNOWN and cannot be used by a paid lesson. A future paid lesson requires a fresh Library upload that completes the ordinary 315 prepare, create-claim, transport, exact UID readback, readback binding, ready video/asset, final binding, and completed receipt chain after activation. If any identity, evidence, or history check is ambiguous, the upload may still complete as a Library video, but it receives no paid-origin certificate.

## Stored evidence and state

The private registry stores a digest of provider registry plus UID, state/revision, and an opaque proof digest. It stores no raw UID or registry UUID, member/owner ID, video/source ID, operation ID, or provider URL. The digest remains linkable pseudonymous data; it is not described as anonymous or nonpersonal.

The certificate hashes immutable operation, intent, context, Library request, create claim, transport evidence digest, exact readback, asset readback event, two legitimate own-Library attached binding events, and finalization receipt facts. Those binding events must show the operation context's source revision `N` and the commit revision `N+1`; the proof does not assume a particular starting revision. The current profile fence revision, mutable asset state revision/evidence digest, and mutable binding state revision/evidence digest are not part of the proof. Current readiness and exclusivity are checked separately when validating paid use.

The state can move from `protected_private` to `shared` or `denied`, and from `shared` to `denied`. A missing row is UNKNOWN. Neither a detached consumer nor a recreated video identity revives an existing key. Owner-account cleanup and confirmed asset deletion/quarantine remove positive proof material while keeping a minimal hashed DENIED tombstone. No cleanup component is registered globally.

## Exposure and paid-write guards

Member-visible video writes, any nonpaid source binding, Program intros, legacy Program days, Tasks, Community media (including owner-only media), and Daily Content/Daily Fuel consumers mark their old and new UID tuples shared. An own-Library `video` binding alone is not a share. `current` and `free_snapshot` lessons also taint their UID. If a paid lesson already exists for that UID, a new nonpaid exposure raises inside the source transaction so the complete write rolls back.

The immediate paid-lesson row guard requires `READ COMMITTED`, takes the same nonblocking owner-account and registry+UID advisory trylocks as exposure writers, then freshly validates the protected origin before accepting the row. The locks remain held through commit so an exposure cannot race a successful paid check. Text-only lessons skip these media checks and locks. A deferred final constraint rechecks exact current video identity, asset readiness, the existing 315 paid-exclusivity predicate, and cross-Program reuse after the full 600 publication transaction has applied its Program-only visibility and context binding changes. Same-Program reuse continues only while the original origin proof remains valid and the 600 authoring checks accept the reuse. An orphan lesson binding without a matching actual paid lesson fails the origin check; an absent lesson row never establishes that a binding is paid.

The migration adds hooks and narrow private helpers only. It does not spoof `auth.role()`, trust a caller GUC as authorization, replace a service-only RPC, or expose a browser path for a private UID. Existing 315/600 SQL bodies and their Admin publication boundary are preserved.

## Boundaries and operational follow-up

This feature controls future paid-media eligibility. It does not revoke previously issued playback tokens, drain provider requests, convert historical assets into certified origins, or establish a hard maximum duration for a provider POST. Unknown or conflicting history stays ineligible rather than being resolved from a TTL or lease assumption.

No Vercel ingress beta, deployment setting, Supabase project setting, Storage path, or upload transport is changed here. The backend upload design still has to account for the hosting request-body limit, verify actual bounded bytes before reserving work, and avoid browser-held publish/copy capabilities. Primary platform references reviewed for that separate design are [Vercel Function limitations](https://vercel.com/docs/functions/limitations), [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits), and [Supabase standard Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads). Those documents do not prove a provider POST completion deadline or an ingress-body cap for the proposed Edge route.

## SQL QA status

On a fresh isolated local P3 clone of the accepted A2 source, migration 610 was applied once and committed with exit 0. `plpgsql_check` 2.8 analyzed all 13 PL/pgSQL functions across 19 actual trigger/relation contexts with zero errors and 22 known unused-variable warnings in the shared exposure hook. The focused TAP completed with exit 0: 45 contiguous assertions passed, `finish()` emitted `1..45`, there were no `not ok` rows or SQL errors, and the output ended with `ROLLBACK`.

The TAP uses synthetic local provider facts through the real 315 RPC producer path. It covers a complete 600 paid publication, explicit `IMMEDIATE` checks after that publication and same-Program reuse, and a separate same-Program incomplete-publication negative that forces the 610 deferred final constraint and checks rollback of the version, lesson, binding, binding events, and pointers. Its cross-Program negative is stopped by the frozen 1550 before-insert validator; it does not test 610's deferred cross-Program branch. `mark_uid` taint is exercised through the helper directly because 315 does not let a Library UID be reused as a second Community upload. The account tombstone cleanup hook is reached through its normal service entrypoint, though full owner asset deletion/cleanup integration is not covered.

The post-test baseline found no persisted fixture data: the origin registry has zero rows, the activation epoch has its single marker, and a scan for all 36 fixture UUIDs found zero references. User/profile/Program/video counts, helper hashes, the 5 cleanup components, and fingerprints for 522 existing functions and 200 existing triggers matched the pre-610 baseline. The exact commands, raw stdout/stderr, checks, and SHA-256 index are in `.vercel/program-media-private-origin-qa/local-p3/run-report.md` and `.vercel/program-media-private-origin-qa/local-p3/evidence-index.sha256`.

This is local synthetic-fact QA, not full security or hosted end-to-end proof. Still untested: activation abort when paid lessons or orders already exist; `current`/`free_snapshot`, Program-day, Community owner-only/member-visible, and other exposure paths; exposure-after-paid rollback; orphan lesson-binding rejection; deletion/recreation tombstones; sequential `N→N+1` uploads; full owner deletion/cleanup integration; and concurrent writer races. No provider, Auth, Storage, API, browser, camera, hosted service, or concurrency test was run.
