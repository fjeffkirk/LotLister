/** PostgreSQL BIGINT is converted only at the application/JSON boundary. */
export function byteCount(value: number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('Invalid or unsafe media byte count.');
  }
  return result;
}
