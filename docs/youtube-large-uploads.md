# Large YouTube uploads

Video uploads default to a 4 GiB per-file limit. `YOUTUBE_MAX_UPLOAD_BYTES`
can override it with a positive integer number of bytes; existing smaller
overrides still apply. Thumbnails retain their separate 2 MiB limit.

LotLister measures the filesystem mounted at `UPLOAD_DIR` instead of assuming
a 1 GB disk. The storage indicator includes all used or reserved filesystem
space, including files outside the uploads folder. It reports available bytes
as well as total capacity.

Direct upload preparation checks the declared size against current free space.
Transfers check again, reserve their maximum size against other active media
transfers in the single service process, and leave 256 MiB free for other files.
Free space is rechecked during streaming. Concurrent uploads can be refused
conservatively while another upload is in progress. Remote files with a known
Content-Length reserve that size; unknown-length downloads reserve their full
configured limit. Failed streams remove their partial file. None of these
checks delete existing photos or videos to make room.

The `20261023160000_youtube_large_uploads` migration widens media sizes and
upload progress counters from PostgreSQL INTEGER to BIGINT, preserving records.
Application and JSON boundaries convert these counters to safe JavaScript
numbers. Existing deployment startup applies migrations before serving traffic.

The Render blueprint reflects the already provisioned 5 GB disk. No new paid
service, disk enlargement, credential changes or required environment variable
changes are introduced by this fix. An upload may still be rejected if the disk
does not have enough actual free space or an explicit smaller limit is set.
