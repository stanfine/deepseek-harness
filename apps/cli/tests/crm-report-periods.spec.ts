import { describe, expect, it } from 'vitest'
import { businessDate, resolveReportPeriods } from '../config/examples/crm/report-periods.ts'

describe('CRM weekly report periods', () => {
  it('derives today from the configured business offset across a UTC date boundary', () => {
    expect(businessDate(new Date('2025-05-01T16:30:00Z'), '+08:00')).toBe('2025-05-02')
  })

  it('aligns a requested date to Monday and preserves weekdays for comparisons', () => {
    expect(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-10')).toEqual({
      current: { start: '2025-05-05', end: '2025-05-12', complete: false },
      previous: { start: '2025-04-28', end: '2025-05-05', complete: true },
      priorYear: { start: '2024-05-06', end: '2024-05-13', complete: true },
      fiscalYtd: { start: '2025-04-01', end: '2025-05-12', complete: false },
    })
  })

  it('selects the preceding fiscal year before its configured start month', () => {
    expect(resolveReportPeriods('2025-02-03', '+08:00', 4, '2025-02-20').fiscalYtd)
      .toEqual({ start: '2024-04-01', end: '2025-02-10', complete: true })
  })

  it.each([
    ['2025-02-30', '+08:00', 4, '2025-05-10'],
    ['2025-05-07', 'Asia/Shanghai', 4, '2025-05-10'],
    ['2025-05-07', '+08:00', 13, '2025-05-10'],
    ['2025-05-07', '+08:00', 4, 'not-a-date'],
  ] as const)('rejects invalid period input %#', (date, zone, month, today) => {
    expect(() => resolveReportPeriods(date, zone, month, today)).toThrow()
  })
})
