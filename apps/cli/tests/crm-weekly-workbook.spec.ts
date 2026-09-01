import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { renderWeeklyWorkbook } from '../config/examples/crm/weekly-workbook.ts'
import { resolveReportPeriods } from '../config/examples/crm/report-periods.ts'

describe('CRM weekly workbook', () => {
  it('writes the fixed sheets, guarded comparison formulas, charts, and no customer identifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-crm-workbook-'))
    const output = join(root, 'report.xlsx')
    const periods = resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-07')
    const available = (period: 'current' | 'previous' | 'priorYear' | 'fiscalYtd', amount: number) => ({ period,
      ...periods[period], available: true as const, amount, orders: 2, purchasers: 2, quantity: 4,
      repeatPurchasersReason: 'definition unavailable', amountPerOrder: { value: amount / 2 }, itemsPerOrder: { value: 2 },
      amountPerItem: { value: amount / 4 }, frequency: { value: 1 }, amountPerPurchaser: { value: amount / 2 },
      exactCustomers: true, missingCustomers: 0 })
    await renderWeeklyWorkbook(new URL('./fixtures/artifact-tool.mjs', import.meta.url).href, output, { date: '2025-05-07', periods,
      sales: { kind: 'sales', timeZone: '+08:00', coverage: { earliest: '2024-01-01', latest: '2025-05-07', missingTime: 0 },
        rows: [available('current', 100), available('previous', 80), { period: 'priorYear', ...periods.priorYear, available: false,
          unavailableReason: 'Source coverage does not contain the prior-year window.' }, available('fiscalYtd', 500)], warning: 'live source' },
      lifecycle: { kind: 'lifecycle', available: false, requiredStart: '2024-04-01', observedStart: '2024-06-01', requiredEnd: '2025-05-12', observedEnd: '2025-05-07' },
      productSeries: { kind: 'product', available: false, groupBy: 'series', reason: 'missing series' },
      productSku: { kind: 'product', available: true, groupBy: 'sku', periodAvailability: { current: true, previous: true, priorYear: true },
        groups: [{ key: 'SKU-1', lineDocumentCount: 3, current: { amount: 100, quantity: 4 }, previous: { amount: 80, quantity: 3 }, priorYear: null }],
        omitted: 0, countErrorUpperBound: 0, missingKey: 0, truncated: false, warning: 'line facts' },
      recommendations: [{ observation: '销售增长', evidence: '本周 100，上周 80', hypothesis: '活动影响', action: '复核活动渠道', validationMetric: '销售金额', limitation: '非快照' }],
    })
    const text = await readFile(output, 'utf8')
    const workbook = JSON.parse(text) as Array<{ name: string; chartsList: unknown[]; ranges: Array<{ formulas: string[][] }> }>
    expect(workbook.map(sheet => sheet.name)).toEqual(['Definition', 'Sales Overview', 'Lifecycle', 'Traffic', 'Product Series', 'Product SKU', 'Recommendations'])
    expect(workbook.flatMap(sheet => sheet.ranges).flatMap(range => range.formulas).flat())
      .toContain('=IF(OR(B11="",C11="",C11=0),"",(B11-C11)/C11)')
    expect(workbook.find(sheet => sheet.name === 'Sales Overview')?.chartsList).toHaveLength(1)
    expect(text).toContain('Source coverage does not contain the prior-year window.')
    expect(text).not.toMatch(/customerId|手机号|姓名|地址/)
  })
})
