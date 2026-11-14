/** Company-edition chat retention (docs/분석/27): days to keep Madang's own chat copies; null = keep forever. */
export const SESSION_RETENTION_DAY_OPTIONS = [30, 90, 180, 365] as const

export function normalizeSessionRetentionDays(value: unknown): number | null {
  return SESSION_RETENTION_DAY_OPTIONS.find((days) => days === value) ?? null
}
