/** A single cooperative worker in the existing long-lived Render web process.
 * Jobs, leases and retry deadlines live in Postgres; this timer is only a wakeup.
 * Server startup re-arms it after deploys/restarts. No extra paid service needed.
 */
export function createYoutubeWorker(
  drain: () => Promise<unknown>,
  onError: (error: unknown) => void,
  intervalMs = 15_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;
  let wakeAgain = false;
  function arm(delay: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), delay);
    timer.unref?.();
  }
  async function tick() {
    timer = undefined;
    if (running || stopped) return;
    running = true;
    try {
      await drain();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      arm(wakeAgain ? 0 : intervalMs);
      wakeAgain = false;
    }
  }
  return {
    wake() {
      if (stopped) return;
      if (running) wakeAgain = true;
      else arm(0);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
