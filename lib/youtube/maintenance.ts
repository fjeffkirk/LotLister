import { z } from 'zod';

const holdSchema = z.array(z.object({
  jobId: z.string().min(1),
  connectionId: z.string().min(1),
  channelId: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict()).max(20);

type HoldTarget = z.infer<typeof holdSchema>[number];
type StoredJob = HoldTarget & { userEmail: string };

/** Deployment operators can hold specifically identified, superseded work when
 * a connected MCP client has not refreshed its tool catalog yet. No SQL or
 * credentials come from the configuration; the normal safe-hold guard applies.
 */
export async function applyOperatorHolds(raw: string | undefined, io: {
  read(jobId: string): Promise<StoredJob | null>;
  hold(accountId: string, jobId: string): Promise<unknown>;
  log(jobId: string): void;
}): Promise<void> {
  if (!raw?.trim()) return;
  const targets = holdSchema.parse(JSON.parse(raw));
  // Validate the entire batch before any mutation, including exact tenant,
  // channel and immutable-request identifiers.
  const jobs = await Promise.all(targets.map(async target => {
    const row = await io.read(target.jobId);
    if (!row || row.jobId !== target.jobId || row.connectionId !== target.connectionId
      || row.channelId !== target.channelId || row.idempotencyKey !== target.idempotencyKey) {
      throw new Error('YouTube operator hold identity mismatch; worker remains paused.');
    }
    return row;
  }));
  for (const row of jobs) {
    await io.hold(row.userEmail, row.jobId);
    io.log(row.jobId);
  }
}
