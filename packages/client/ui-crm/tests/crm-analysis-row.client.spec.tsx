// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setPlatformAPI } from 'echarts/core'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CrmAnalysisRow } from '../src/client/CrmAnalysisRow.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '../../locale/src/locales/zh.ts'
import { analysis } from './fixtures/crm-analysis.ts'

beforeAll(() => {
  setPlatformAPI({ measureText: text => ({ width: text.length * 7 }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 340 })
})
afterEach(cleanup)

function props(meta: unknown, draft = '', inputActions = { setDraft: vi.fn(), submit: vi.fn() }): Parameters<typeof CrmAnalysisRow>[0] {
  return { block: { kind: 'tool-result', callId: 'a', call: { name: 'crm_analyze', argsRaw: '{}' },
    content: [{ type: 'text', text: 'raw-analysis' }], isError: false, meta },
  t: makeTranslate(zh, commonZh), useInput: (select: (state: { draft: string }) => unknown) => select({ draft }),
  inputActions,
  } as unknown as Parameters<typeof CrmAnalysisRow>[0]
}

it('renders a summary as KPI cards with null and partial values kept visible', () => {
  const meta = analysis()
  meta.crmAnalysis.request.dimensions = []
  meta.crmAnalysis.request.intent = 'summary'
  meta.crmAnalysis.data.request = structuredClone(meta.crmAnalysis.request)
  meta.crmAnalysis.data.columns.dimensions = []
  meta.crmAnalysis.data.rows = [{ dimensions: {}, metrics: { sales_amount: {
    value: null, comparisonValue: 100, changeRatio: null, unavailableReason: '本期数据缺失', changeUnavailableReason: '无法计算变化',
  } } }]
  meta.crmAnalysis.data.completeness.complete = false
  meta.crmAnalysis.data.completeness.omittedDocuments = 2
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.getByRole('region', { name: 'CRM 灵活分析' })).toBeTruthy()
  expect(screen.getAllByText('销售额').length).toBeGreaterThan(0)
  expect(screen.getByText('—')).toBeTruthy()
  expect(screen.getByText(/本期数据缺失/)).toBeTruthy()
  expect(screen.getByText(/部分结果/)).toBeTruthy()
})

it('renders a chart, accessible source table, warnings, and comparison context', () => {
  const meta = analysis()
  meta.crmAnalysis.data.warnings = ['渠道存在迟到数据']
  meta.crmAnalysis.data.columns.metrics[0]!.limitations = ['退款按成交日冲减']
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.getByRole('img', { name: '渠道 · 销售额' })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'CRM 分析数据表' })).toBeTruthy()
  expect(screen.getAllByText(/2025-07-01 → 2025-08-01/).length).toBeGreaterThan(0)
  expect(screen.getByText(/对比期.*2025-05-31 → 2025-07-01/)).toBeTruthy()
  const coverage = screen.getByLabelText('数据覆盖').textContent ?? ''
  expect(coverage).toMatch(/本期覆盖.*3.*2025-07-01 → 2025-08-01.*2024-01-01/)
  expect(coverage).toMatch(/对比期覆盖.*2.*2025-05-31 → 2025-07-01.*2024-01-01/)
  expect(screen.getByText('成交金额')).toBeTruthy()
  expect(screen.getByText(/退款按成交日冲减/)).toBeTruthy()
  expect(screen.getByText('渠道存在迟到数据')).toBeTruthy()
})

it('shows unavailable reasons beside grouped current, comparison, and change values', () => {
  const meta = analysis()
  meta.crmAnalysis.request.metrics = ['sales_amount', 'order_count']
  meta.crmAnalysis.data.request = structuredClone(meta.crmAnalysis.request)
  meta.crmAnalysis.data.columns.metrics.push({ id: 'order_count', name: '订单数', format: 'number', description: '成交订单', limitations: [] })
  meta.crmAnalysis.data.rows[0]!.metrics.sales_amount = { value: null, comparisonValue: 0, changeRatio: null,
    unavailableReason: '本期覆盖不足', changeUnavailableReason: '对比值为零' }
  meta.crmAnalysis.data.rows[0]!.metrics.order_count = { value: 3, comparisonValue: null, changeRatio: null,
    comparisonUnavailableReason: '对比覆盖不足', changeUnavailableReason: '无法计算变化' }
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.getByText('本期覆盖不足')).toBeTruthy()
  expect(screen.getByText('对比值为零')).toBeTruthy()
  expect(screen.getByText('对比覆盖不足')).toBeTruthy()
  expect(screen.getByText('无法计算变化')).toBeTruthy()
})

it('uses the table fallback for a two-dimensional result', () => {
  const meta = analysis()
  meta.crmAnalysis.request.dimensions = ['channel', 'store']
  meta.crmAnalysis.data.request = structuredClone(meta.crmAnalysis.request)
  meta.crmAnalysis.data.columns.dimensions.push({ id: 'store', name: '门店', dataType: 'keyword' })
  meta.crmAnalysis.data.rows[0]!.dimensions.store = '上海旗舰店'
  meta.crmAnalysis.data.drilldownDimensions = []
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByRole('table', { name: 'CRM 分析数据表' })).toBeTruthy()
  expect(screen.getByText('上海旗舰店')).toBeTruthy()
})

it('falls back to the raw result when persisted metadata is rejected', () => {
  const meta = analysis()
  meta.crmAnalysis.data.rows[0]!.metrics.sales_amount!.value = Number.POSITIVE_INFINITY
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.getByText('分析结果无法展示，保留原始结果。')).toBeTruthy()
  expect(screen.getByText('查看原始结果')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('keeps a valid empty result readable', () => {
  const meta = analysis()
  meta.crmAnalysis.data.rows = []
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.getByText('该范围没有返回分析数据。')).toBeTruthy()
})

it('does not advertise drilldown for a dimensionless KPI summary', () => {
  const meta = analysis()
  meta.crmAnalysis.request.dimensions = []
  meta.crmAnalysis.request.intent = 'summary'
  meta.crmAnalysis.data.request = structuredClone(meta.crmAnalysis.request)
  meta.crmAnalysis.data.columns.dimensions = []
  meta.crmAnalysis.data.rows[0]!.dimensions = {}
  render(<CrmAnalysisRow {...props(meta)} />)
  expect(screen.queryByText(/可下钻维度/)).toBeNull()
  expect(screen.queryByRole('button', { name: /下钻/ })).toBeNull()
})

it('prepares a logical drilldown draft without submitting or exposing source details', () => {
  const meta = analysis()
  meta.crmAnalysis.request.metrics = ['sales_amount', 'order_count']
  meta.crmAnalysis.request.filters = [{ dimension: 'region', operator: 'equals', values: ['华东'] }]
  meta.crmAnalysis.data.request = structuredClone(meta.crmAnalysis.request)
  meta.crmAnalysis.data.columns.metrics.push({ id: 'order_count', name: '订单数', format: 'number', description: '成交订单', limitations: [] })
  meta.crmAnalysis.data.rows[0]!.metrics.order_count = { value: 3, comparisonValue: 2, changeRatio: 0.5 }
  const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
  const value = props(meta, '', inputActions)
  render(<CrmAnalysisRow {...value} />)
  fireEvent.click(screen.getByRole('button', { name: '下钻 线上' }))
  expect(inputActions.setDraft).toHaveBeenCalledOnce()
  expect(inputActions.submit).not.toHaveBeenCalled()
  const draft = String(inputActions.setDraft.mock.calls[0]![0])
  expect(draft).toContain('2025-07-01')
  expect(draft).toContain('2025-08-01')
  expect(draft).toContain('sales_amount')
  expect(draft).toContain('order_count')
  expect(draft).toContain('region')
  expect(draft).toContain('华东')
  expect(draft).toContain('channel')
  expect(draft).toContain('线上')
  expect(draft).toContain('store')
  expect(draft).not.toMatch(/index|field|script|dsl|mkt_/i)
})

it('does not replace an existing draft', () => {
  const value = props(analysis(), '已有内容')
  render(<CrmAnalysisRow {...value} />)
  expect(screen.getByRole('button', { name: '下钻 线上' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('输入框已有内容，请先处理草稿后再下钻。')).toBeTruthy()
})
