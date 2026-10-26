# Resumable media transfer into LotLister

A large, single HTTP request can be rejected by the hosting edge even when the
persistent disk and configured file limit are sufficient. The existing signed
media URL now supports sequential chunks; this does not change YouTube uploads,
visibility, quotas, or the overall `YOUTUBE_MAX_UPLOAD_BYTES` limit.

1. Prepare the exact byte size using `youtube_media_upload_prepare` as before.
2. Calculate the lowercase SHA-256 of the complete local file.
3. PUT sequential raw chunks (recommended 32 MiB, maximum 64 MiB) to that URL.
   Include `Content-Type: application/octet-stream`,
   `Content-Range: bytes START-END/TOTAL`, and `X-Upload-SHA256: HASH`.
   END is inclusive. TOTAL must equal the prepared byte size. Do not encode bytes.
4. Each successful response commits an `offset`. After a lost response or a 409,
   GET the same signed URL and resume at its returned offset. Never assume an
   unsuccessful client response means the server did not commit the chunk.
5. Once offset equals TOTAL, POST to the same signed URL with X-Upload-SHA256.
   This streams a whole-file checksum/type check and atomically finalizes the
   file. Only `status: ready` permits `youtube_upload_video`. Retrying this POST
   recovers a failure between file finalization and the database update.

The grant remains expiring, account/asset-bound, and size-bound. GET and POST
require it too. Expiration does not grant permission to overwrite data. An
expired grant currently requires preparing a new asset; no automatic upload or
publication occurs. Do not log signed URLs.

The implementation uses bounded-memory streams, an outstanding-byte reservation,
and a 256 MiB free-disk reserve. Failed chunks roll back to the last durable
offset. After a process restart, uncommitted tail bytes are discarded before the
next chunk. Mismatched checksums, missing committed bytes, conflicting totals,
and unexpected destination files fail closed. Failed transfer artifacts are
preserved for explicit inspection rather than silently deleting user data.

One per-asset process-global lock covers direct PUT, chunk PUT, GET, and finalize,
including database updates. This matches the single-instance Render persistent
disk deployment. A multi-instance/shared-filesystem deployment would require a
distributed lock before enabling this ingestion method.

Validation: chunk completion, retries, bad offsets/totals, interrupted bodies,
process-restart tails, size/space limits, hash/type failures, concurrency,
account-bound authorization, and the existing YouTube suites.
