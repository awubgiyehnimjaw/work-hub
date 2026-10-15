/**
 * A Postgres unique-constraint violation surfaces via Drizzle as a
 * wrapping "Failed query" Error whose `.cause` is the real pg error — the
 * constraint name lives on `cause.constraint` (or, as a fallback, inside
 * `cause.message`), not on the outer error's own `.message`.
 */
export function isUniqueConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeRecord = cause as Record<string, unknown>;
    if (causeRecord.constraint === constraintName) {
      return true;
    }
    if (typeof causeRecord.message === "string" && causeRecord.message.includes(constraintName)) {
      return true;
    }
  }
  return error.message.includes(constraintName);
}
