# YouTube catalog cleanup proposal

Status: prepared for review, not deployed or enabled. No videos have been deleted.

## Problem

The owner requested preserving the five best-performing doomish23 video editions,
permanently deleting the remaining editions, and freshly uploading approved
Christopher videos one at a time. The existing app exposes neither complete
channel inventory nor view statistics, and deliberately prohibits deletion.
Unlisting does not satisfy this request.

## Proposed capability

`youtube_channel_inventory` reads every page of the authenticated owner's uploads
playlist, then retrieves each video's identity, status and lifetime view count.
Private and unlisted editions remain eligible. It sorts by lifetime views, with
video ID ascending as a stable tie breaker. Missing statistics or missing details
abort the ranking. It returns the exact five keeper IDs and the complete inventory.

`youtube_video_delete` is absent unless the operator explicitly configures
`YOUTUBE_CLEANUP_CHANNEL_IDS`. The proposed activation is ONLY:

```
UCEMhx0sbB4cfuIYxaWHXhrw
```

No activation or deployment has been performed. This activation changes the app's
existing deletion restriction and requires owner approval. No other channel,
marketplace permission, or account credential is changed.

Each destructive call must identify one video, its exact title, expected channel,
all five protected IDs, and `deletionIntent: true`. The service verifies account
ownership, channel allowlisting, complete current ranking, keeper membership and
title before calling YouTube DELETE. A fresh owner read must report absence before
the action is recorded as deleted. An accepted deletion with a lagging readback
is explicitly unconfirmed. Reconcile it before retrying. There is no wildcard or
batch-delete operation, and the tool declares `destructiveHint: true`.

Deletion is permanent. Source MP4s remain in the production inventory; YouTube
views, comments and IDs do not transfer to new uploads.

## Execution after approval

1. Deploy the reviewed change and explicitly enable only doomish23. Refresh the
   connected app's tool catalog if the new operations are not exposed.
2. Read the complete current inventory. Save the snapshot, metrics and keeper IDs
   before any deletion. Confirm the saved latest Christopher files for each story.
3. Reconcile pending jobs and schedules. The existing rollout is gated during
   cleanup; do not start uploads or restore public visibility to candidates.
4. Delete each nonkeeper sequentially through the explicit tool and retain every
   response/readback. Refresh inventory if ranking changes or state is uncertain.
5. Verify the final channel inventory consists of the five protected IDs. Retain
   those editions and exclude identical retained editions from the reupload queue.
6. Freshly upload remaining latest approved Christopher editions, one public
   release at least four hours after the previous actual release. Pending jobs
   without a video ID can be reused; previously published/deleted IDs cannot be
   relisted as a substitute. Preserve exact payloads on retries and honor actual
   YouTube limits, thumbnail eligibility, voice budget and the November 2 cutoff.
7. Once the queue is exhausted, resume fresh stories every twelve hours. Do not
   release a catch-up batch. Do not create another automation.

## Verification

Focused automated checks cover pagination, incomplete inventories, cross-channel
refusal, missing counts, large-count ordering, protected keeper IDs, changed
ranking, exact titles, default-disabled deletion, single-target deletion and
fresh absence verification. Existing MCP scope and resumable-upload tests remain
part of validation. No live deletion was tested.

Primary API references:

- https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list
- https://developers.google.com/youtube/data/reference/rest/v3/videos/list
- https://developers.google.com/youtube/data/reference/rest/v3/videos/delete
