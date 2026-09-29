/** Format live sync progress for toasts / UI. */
export function formatSyncProgress(run: {
  progressPhase?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
}): string | null {
  const phase = run.progressPhase;
  if (!phase || phase === "finishing") return phase === "finishing" ? "Finishing up…" : null;
  const current = run.progressCurrent ?? 0;
  const total = run.progressTotal;
  const label =
    phase === "locations"
      ? "locations"
      : phase === "products"
        ? "products"
        : phase === "inventory"
          ? "inventory items"
          : phase === "orders"
            ? "orders"
            : phase;
  if (total != null && total > 0) {
    return `${current.toLocaleString()} of ${total.toLocaleString()} ${label} synced`;
  }
  // No total yet (count still loading / failed once) — don't invent a partial count line.
  return `Syncing ${label}…`;
}
