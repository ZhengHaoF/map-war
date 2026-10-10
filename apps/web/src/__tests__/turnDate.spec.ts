import { describe, expect, it } from 'vitest'
import { nextTurnDate } from '@/utils/turnDate'

describe('engine-owned turn date', () => {
  it('accepts a real 5–10 day advancement', () => {
    expect(nextTurnDate('1931-04-01', '1931-04-06')).toBe('1931-04-06')
    expect(nextTurnDate('1931-04-01', '1931-04-11')).toBe('1931-04-11')
  })
  it.each([undefined, null, '1931-04-01', '1930-12-01', '1945-08-15', '1931-02-30', 'not-a-date'])('falls back to seven days for %s', proposed => {
    expect(nextTurnDate('1931-04-01', proposed)).toBe('1931-04-08')
  })
})
