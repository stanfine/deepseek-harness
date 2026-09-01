// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { setPlatformAPI } from 'echarts/core'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CrmReportRow } from '../src/client/CrmReportRow.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '../../locale/src/locales/zh.ts'

beforeAll(() => {
  setPlatformAPI({ measureText: text => ({ width: text.length * 7 }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 340 })
})
afterEach(cleanup)
function props(kind: string, data: object): Parameters<typeof CrmReportRow>[0] {
  return { block: { kind: 'tool-result', callId: 'r', call: { name: `crm_${kind}_report`, argsRaw: '{"date":"2025-05-07"}' },
    content: [{ type: 'text', text: 'raw-report' }], isError: false,
    meta: { crmReport: { version: 1, kind, request: { date: '2025-05-07' }, data } } },
  t: makeTranslate(zh, commonZh), useInput: (select: (s: { draft: string }) => unknown) => select({ draft: '' }),
  inputActions: { setDraft: vi.fn(), submit: vi.fn() },
  } as unknown as Parameters<typeof CrmReportRow>[0]
}

it('renders weekly sales as KPI cards and a comparison chart', () => {
  render(<CrmReportRow {...props('sales', { kind: 'sales', timeZone: '+08:00', coverage: { earliest: '2024-01-01', latest: '2025-05-10', missingTime: 0 },
    rows: [{ period: 'current', start: '2025-05-05', end: '2025-05-12', complete: false, available: true,
      amount: 1200, orders: 4, purchasers: 3, repeatPurchasers: 1, quantity: 6,
      amountPerOrder: { value: 300 }, itemsPerOrder: { value: 1.5 }, amountPerItem: { value: 200 },
      frequency: { value: 1.33 }, amountPerPurchaser: { value: 400 }, exactCustomers: true, missingCustomers: 0 },
    { period: 'previous', start: '2025-04-28', end: '2025-05-05', complete: true, available: false, unavailableReason: 'coverage gap' }], warning: 'source warning' })} />)
  expect(screen.getAllByText('1,200').length).toBeGreaterThan(0)
  expect(screen.getByRole('img', { name: '销售指标对比' })).toBeTruthy()
  expect(screen.getByText('本周尚未结束')).toBeTruthy()
  expect(screen.getByText(/coverage gap/)).toBeTruthy()
})

it('shows a source-coverage refusal instead of inventing lifecycle values', () => {
  render(<CrmReportRow {...props('lifecycle', { kind: 'lifecycle', available: false, requiredStart: '2024-04-01', observedStart: '2024-12-01', requiredEnd: '2025-05-12', observedEnd: '2025-05-07' })} />)
  expect(screen.getByText(/历史覆盖不足，无法计算客户生命周期指标/)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})

it('renders a validated same-origin Excel download', () => {
  render(<CrmReportRow {...props('excel', { kind: 'excel', export: { id: 'A'.repeat(32), filename: 'crm-weekly-2025-05-07.xlsx', bytes: 1234,
    expiresAt: '2025-05-07T01:00:00.000Z' }, downloadUrl: `http://localhost:3000/api/crm.export?id=${'A'.repeat(32)}`,
  sheets: ['Definition', 'Sales Overview', 'Lifecycle', 'Traffic', 'Product Series', 'Product SKU', 'Recommendations'], warning: 'live source' })} />)
  const link = screen.getByRole('link', { name: '下载 Excel' })
  expect(link.getAttribute('href')).toBe(`http://localhost:3000/api/crm.export?id=${'A'.repeat(32)}`)
  expect(link.getAttribute('download')).toBe('crm-weekly-2025-05-07.xlsx')
})
