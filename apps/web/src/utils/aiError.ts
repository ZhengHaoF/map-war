/** Provider/production proxy may use a string or nested error object. */
export function aiErrorMessage(body: unknown, status: number): string {
  if (status >= 500) return `模型服务暂未响应（HTTP ${status}），请稍后重试`
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  for (const field of [value.detail, value.error, value.message]) {
    if (typeof field === 'string' && field.trim()) return field
    if (field && typeof field === 'object') {
      const message = (field as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim()) return message
    }
  }
  return `模型请求失败（HTTP ${status}）`
}
