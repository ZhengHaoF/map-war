/** Calendar progression is bounded by the engine, not trusted to LLM output. */
export function nextTurnDate(currentDate: string, proposed?: unknown): string {
  const current = Date.parse(`${currentDate}T00:00:00Z`)
  const fallback = new Date(current + 7 * 86400000).toISOString().slice(0, 10)
  if (typeof proposed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(proposed)) return fallback
  const next = Date.parse(`${proposed}T00:00:00Z`)
  if (!Number.isFinite(next) || new Date(next).toISOString().slice(0, 10) !== proposed) return fallback
  const days = (next - current) / 86400000
  return days >= 5 && days <= 10 ? proposed : fallback
}
