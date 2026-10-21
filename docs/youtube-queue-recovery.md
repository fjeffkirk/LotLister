# YouTube queue recovery

The web process now starts a cooperative worker through Next.js instrumentation.
It checks the durable Postgres queue every 15 seconds, including after failures,
and resumes after a web-process restart. This uses the existing Render service
and media disk. It is intended for a long-lived `next start` process, not a frozen
serverless function. The existing authenticated cron endpoint remains an optional
external wakeup; there is no additional paid service or anonymous recovery route.

Each drain is bounded and visits a channel at most once. Claims rotate by due time,
retain atomic row locks and skip active leases. Heartbeats maintain leases during
long I/O. API requests have timeouts. A channel upload limit waits one hour and
only blocks that channel's new sessions; project quota waits six hours across the
shared API project. These are conservative retry intervals, not promises about
when YouTube resets a limit. Network retries retain their existing attempt cap.
Accepted videos are polled by their saved YouTube ID, never re-uploaded because a
resumable session expired while YouTube was processing.

## Safe rollout with superseded queued work

1. Reconcile existing jobs, video IDs and live worker logs before deployment.
2. On the existing service, set `YOUTUBE_WORKER_ENABLED=false` for the rollout.
   This disables all new-code drain entry points, including both cron routes.
   It does not interrupt an already running old-code request. Wait for old
   instances to exit and check job state again.
3. Deploy the fix. Confirm the deployed commit and a healthy web process.
4. Use the authenticated, account-scoped `youtube_upload_hold` tool for each
   specifically superseded original. It only accepts never-started queued jobs
   with no worker lease, session, bytes, video ID or ambiguous completion.
   It preserves the immutable request, media and audit history. An unsafe hold
   returns an error without changing the job; investigate rather than forcing it.
5. Verify the original reads `held`. Reconcile the intended replacement and keep
   its existing job, key and payload. Do not create another upload.
6. Remove the maintenance switch or set it to `true`, restart/redeploy the same
   service and verify its existing queue advances. Check fresh video state and
   thumbnail results before any separately authorized publication action.

If the connected client has not refreshed its tool catalog, an existing service
operator can set `YOUTUBE_UPLOAD_HOLDS` to a JSON array of exact
`{jobId,connectionId,channelId,idempotencyKey}` targets while the worker remains
disabled. Startup verifies every identity against saved work, then uses the same
safe-hold operation and logs each verified hold. A mismatched identity or unsafe
job fails closed. No credentials or arbitrary SQL are accepted. Verify the held
status before enabling the worker; remove the optional configuration afterward.
This control is only for explicitly authorized superseded jobs, never blanket
cleanup. It preserves requests, media and history and cannot stop accepted work.

Status reads remain read-only. They now expose nextAttemptAt, attemptCount,
updatedAt and workerLeaseAt. A queued response explicitly says no transfer has
been verified. `held` is not deletion and is not a successful upload. This patch
does not automatically revive terminal failures or change video privacy/schedules.

### Reconnected jobs rejected before session creation

A quota rejection while starting a resumable session can leave a never-started
job labeled `uploading`. If its connection is later removed, the worker correctly
skips it. The safe-hold operation now recognizes this narrow legacy state after
its recorded quota wait expires. The atomic update still requires no worker
lease, session, acknowledged/progress bytes, accepted video timestamp or ID, or
uncertain completion. It also matches the observed quota error and retry deadline
so a concurrent retry cannot be canceled. Active waits and ambiguous work remain
protected. A successful hold retains the original payload, media and history.

After a verified terminal hold, reconcile the complete channel inventory before
creating an authorized replacement on the current connection. Do not use this to
skip an active YouTube limit, duplicate a surviving edition, or publish in a burst.

## Validation

`npm test` includes an embedded Postgres queue regression using the production
claim SQL and original migration. It exercises a channel-limit failure alongside
a successful different-channel transfer, scoped cooldowns, stale/live leases,
fair rotation, tenant-scoped safe holds, and read-only status. Timer tests cover
request-independent continuation, failed ticks and coalesced non-overlapping work.
Existing idempotency, ambiguous completion, HTTP 308 and publication-policy tests
remain required. Embedded Postgres does not replace multi-instance production
observability; verify deployed logs and state before calling a live incident fixed.
