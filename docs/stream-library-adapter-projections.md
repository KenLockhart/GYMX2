# Stream Library adapter projections

Migration 20261119061500_stream_library_adapter_projections.sql adds two read-only RPCs for a future server-only Stream adapter. They project facts already recorded by the 300 provenance, 310 lifecycle, and 315 application-contract migrations. The migration adds no tables, writes, provider attestations, or browser grants.

## RPC contract

Both functions are SECURITY DEFINER, use an empty search_path, and grant execution only to service_role. They reject non-service callers with SQLSTATE 42501. The underlying registry, verification, operation, transport, observation, binding, and receipt tables remain inaccessible through raw client queries.

### public.get_stream_provider_account_projection(text, text)

Arguments are the fixed credential slot and the provider account ID expected by server configuration. Valid slots are vod_primary and vod_secondary; the account ID must be 32 lowercase hex characters.

Outcomes:

- identity_found: exact slot and expected account match an existing immutable registry row and trusted service attestation. Includes registry ID, provider, slot, account ID, attestation identity, and persisted verification identity/status/expiry.
- slot_unregistered, account_binding_mismatch, invalid_slot, or identity_inconsistent: caller must fail closed.

A valid identity is returned when verification is missing or expired so the server can select the existing account path for a later trusted check. The projection never registers, attests, or refreshes an account and never treats expiry as proof of provider access. Active upload work remains unavailable until the existing service verification RPC records a current successful verification.

### public.get_stream_library_upload_work(uuid, uuid)

Arguments are the operation ID and the initiating actor ID derived by the server from the verified user session. The RPC requires an upload operation whose actor, owner, Library video source, immutable request, intent, context, account edges, and transport match that exact actor and prospective video.

For eligible operations, work contains:

- Immutable operation, intent, source, actor, and owner identities; title, description, file digest, and request digest.
- The registry and current verification state.
- The original transport request ID, request digest, marker, duration (7200 seconds), signed URL requirement, and exact canonical metadata.
- A durable provider UID and evidence digest only if they were recorded by the service.
- TUS capability presence and expiry, never the TUS URL itself.
- The latest overall observation and the latest exact UID GET, each ordered by the 315 evidence clock, any completed finalization receipt identity, current eligibility, and current profile-fence facts.

The projection verifies metadata against the immutable Library request and canonical marker/source/actor object. It checks the current profile fence for active work. For a completed Library upload it selects and validates the exact canonical Library binding by source kind, source ID, owner, registry, UID, parent, and asset. Other guarded Program, Daily, or Task bindings may share that ready asset; they do not make the Library receipt ambiguous. A completed receipt does not require its old profile fence to remain active after a later upload advances that fence.

provider_post_authorized is always false. A fresh successful public.claim_stream_media_create(uuid, uuid, text) compare-and-set is still the only permission to issue one provider create request. An existing claim, create_started, create_unknown, created_unverified, known-UID-without-Location, not-ready, or transient exact-GET state returns recovery work only. Do not repeat POST or rebuild a TUS URL from operation data. A transient exact GET (408, 425, 429, or 5xx), or a valid-identity 200 that is not ready, sets readback_retry_allowed; the adapter must impose a small bounded read-only retry policy. It never permits another POST, binding, or source commit. UID, signed-URL, creator, or marker contradictions remain observation_conflict even if a later create reply or list result is newer. The DTO exposes both the latest overall observation and the latest exact UID GET so later non-GET evidence cannot erase or replace readback status. The separate authenticated public.get_stream_media_upload_tus_location(uuid) remains the only TUS bearer-URL path and applies its own initiating-actor, current-role, account, tombstone, and fence checks.

An expired verification blocks active work with account_unverified; it does not refresh proof. The registry projection can still report the exact existing identity so the adapter can perform the normal explicit account-path verification and record it through the existing trusted RPC. Registered but unverified and valid-slot-but-unregistered outcomes are distinct. Unknown provider outcomes stay in recovery and cannot authorize another POST. Completed receipts remain projectable after verification expires because the receipt and ready source binding are durable; the DTO still reports the expired account proof.

## Adapter boundary

The future provider adapter must use the fixed account host and credentials selected by server configuration, validate HTTP status and response headers, and pass trusted observations to the existing service RPCs. The browser supplies neither provider account IDs nor provider UIDs as authority. Treat Location as a bearer capability only; do not parse a UID from it. The provider UID comes from its documented response header and must be tied to the exact intent marker, creator, and readiness by an exact readback.

The original upload file length is not persisted by these projections. This contract does not promise recovery of an identical POST after a lost response; the durable claim and unknown state require recovery without another POST.

Provider references:

- [Cloudflare Stream resumable uploads](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/)
- [Cloudflare Stream direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)
- [Cloudflare Stream create API](https://developers.cloudflare.com/api/resources/stream/methods/create/)

## TAP coverage

supabase/tests/stream_library_adapter_projections_test.sql uses normal authenticated prepare/commit calls and trusted service registry, verification, transport, observation, binding, and account-cleanup RPCs with synthetic facts. A Program intro is attached through the guarded authenticated source path to prove the completed projection selects its Library binding when the ready asset has another legitimate context binding. It covers role and ACL isolation, registered-unverified and unregistered account identities, current/expired proof, positive Community/second-upload/tombstone preparation, immutable duration/signed/canonical metadata, no URL projection, fresh-claim boundary, create_started/create_unknown without UID, known UID without a TUS Location, not-ready and transient GET recovery, later create replies after exact GET evidence, exact readback/binding, completion after profile-fence advancement and account-proof expiry, cancellation, tombstone, and UID/creator/readiness conflicts.

The test expires persisted verification by direct state-table updates inside its transaction, then rolls the transaction back. These are rollback-only time-passage simulations; they are not a normal account-verification producer path and do not fabricate provider evidence.

Local runtime QA on 2026-11-21 used disposable C1, C2, and C3 clones. On C2, migration 615 applied once and plpgsql_check reported zero errors with two nonblocking unused-variable warnings. Its first 103-assertion TAP run rolled back with assertion 29 failing: the test expected the Community prepare outcome reserved, while the producer returns outcome processing and operation_state reserved. The assertion was corrected to check that canonical response and require nonnull operation, submission, post, and media IDs. The repaired TAP passed once on fresh C3: 103 of 103 contiguous assertions, zero not ok or SQL errors, exit 0, finish, and final rollback. Read-only postchecks found no d615 fixture references and unchanged 536 public/private functions, 219 public/private triggers, protected 600/610 functions and triggers, helpers, components, and source database. An earlier C1 checker command accidentally used the migration path and stopped on the duplicate first CREATE FUNCTION; its read-only audit found no drift. Both the C1 command error and C2 assertion failure remain in the QA evidence index. This local SQL/TAP validation used synthetic fixtures only; it did not call Cloudflare or test a real provider, upload, or application flow.
