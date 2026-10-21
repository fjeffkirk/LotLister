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
