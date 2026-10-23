# Local video storage retention

YouTube videos are never automatically deleted by LotLister. Public, private,
unlisted and scheduled videos remain on YouTube. Explicit owner-requested
YouTube deletion is a separate action.

The worker cleans only LotLister's local video source files after seven days.
It preserves media/job metadata, video IDs, idempotency keys and publication
history, and marks the local asset expired. Thumbnail images remain available.

Cleanup waits while any referencing job is pending, held, failed, uncertain,
processing or leased. A completed upload's file is retained for at least seven
days after YouTube accepted it as well as seven days after the asset was created.
An unreferenced ready video file becomes eligible seven days after creation.
Assets must use their canonical account-scoped path. No remote API is involved.

Enqueue and cleanup synchronize on the media row. Cleanup marks an eligible
asset deleting before unlinking it; new requests cannot reserve an expired or
deleting asset. A crash or filesystem failure leaves a retryable deleting marker.
A retry with an existing immutable key still returns its original job after
local cleanup. A genuinely new upload requires a fresh delivery copy from the
owner's durable archive. The archive must not live only on LotLister.

`youtube_upload_status.deletesAt` is now always null for compatibility.
`automaticYoutubeDeletion` is false; `localMediaRetentionDays` is 7. The latter is
a local-file retention policy, not a guaranteed removal timestamp or a YouTube
expiry. Existing historical deleted records are not resurrected.

## Explicit cleanup of a failed source

An owner may request immediate removal of one failed or rejected upload's local
video copy after saving a durable backup. `youtube_media_delete_failed` requires
exact job, connection, channel, idempotency key, media ID, byte size, backup
reference and deletion intent. The channel must already be enabled through
`YOUTUBE_MEDIA_CLEANUP_CHANNEL_IDS`. It refuses leases, uncertain completion, shared
sources, noncanonical paths, images, and unexpected file sizes. Asset and job
locks serialize cleanup with enqueue; a deleting marker permits crash recovery.
The original job, thumbnail, and any YouTube video are preserved. The local-media
allowlist is separate from `YOUTUBE_CLEANUP_CHANNEL_IDS`, which controls YouTube
video deletion; enabling one does not enable the other.

For a client whose MCP catalog has not refreshed, an operator may set
`YOUTUBE_FAILED_MEDIA_CLEANUP` to a JSON array of these exact authorized targets.
Startup uses the same cleanup operation and logs each result. No wildcard, SQL,
or credentials are accepted. Clear the configuration to `[]` after verification.
Without this explicit configuration, existing retention behavior is unchanged.
