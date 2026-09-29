/** Soft-nav in flight — skip router.refresh() so sync cannot cancel a menu click. */
let depth = 0;

export function beginNav() {
  depth += 1;
}

export function endNav() {
  depth = Math.max(0, depth - 1);
}

export function isNavigating() {
  return depth > 0;
}
