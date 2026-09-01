import { expect, it } from 'vitest'
import { analysisChartOption, selectAnalysisView } from '../src/client/analysis-chart-options.ts'
import { readAnalysis } from '../src/client/analysis-model.ts'
import { analysis } from './fixtures/crm-analysis.ts'

const labels = { current: '本期', comparison: '对比期' }
function report() { return readAnalysis(analysis())! }

it('uses donut only for additive metrics and mutually exclusive composition dimensions', () => {
  const value = report(); value.request.intent = 'composition'; delete value.request.comparison
  expect(selectAnalysisView(value).type).toBe('donut')
  value.columns.metrics[0]!.additivity = 'non_additive'
  expect(selectAnalysisView(value).type).not.toBe('donut')
})

it('selects KPI summary, temporal line, ranking horizontal bar, and category comparison bar', () => {
  const summary = report(); summary.request.intent = 'summary'; summary.request.dimensions = []; summary.columns.dimensions = []; summary.rows[0]!.dimensions = {}
  expect(selectAnalysisView(summary)).toEqual({ type: 'kpi' })
  const trend = report(); trend.request.intent = 'trend'; trend.request.timeGrain = 'month'; trend.request.dimensions = ['month']; trend.columns.dimensions = [{ id: 'month', name: '月', dataType: 'date', composition: 'high_cardinality' }]; trend.rows[0]!.dimensions = { month: '2025-07-01' }
  expect(selectAnalysisView(trend)).toEqual({ type: 'line', dimension: 'month', metric: 'sales_amount' })
  expect(selectAnalysisView(report())).toEqual({ type: 'horizontal-bar', dimension: 'channel', metric: 'sales_amount' })
  const comparison = report(); comparison.request.intent = 'comparison'
  expect(selectAnalysisView(comparison)).toEqual({ type: 'bar', dimension: 'channel', metric: 'sales_amount' })
})

it('uses a donut only for complete nonnegative composition and otherwise falls back to bars', () => {
  const complete = report(); complete.request.intent = 'composition'; delete complete.request.comparison
  expect(selectAnalysisView(complete)).toEqual({ type: 'donut', dimension: 'channel', metric: 'sales_amount' })
  complete.completeness.complete = false; complete.completeness.omittedDocuments = 2
  expect(selectAnalysisView(complete)).toEqual({ type: 'bar', dimension: 'channel', metric: 'sales_amount' })
  complete.completeness.complete = true; complete.completeness.omittedDocuments = 0; complete.rows[0]!.metrics.sales_amount!.value = -1
  expect(selectAnalysisView(complete).type).toBe('bar')
})

it('shows both periods for comparison trends and composition instead of selecting a donut', () => {
  const trend = report(); trend.request.intent = 'trend'; trend.request.timeGrain = 'month'; trend.request.dimensions = ['month']
  trend.columns.dimensions = [{ id: 'month', name: '月', dataType: 'date', composition: 'high_cardinality' }]; trend.rows[0]!.dimensions = { month: '2025-07-01' }
  const trendOption = analysisChartOption(trend, selectAnalysisView(trend), labels)
  expect(trendOption.series).toMatchObject([
    { type: 'line', name: '本期', data: [120] },
    { type: 'line', name: '对比期', data: [100] },
  ])
  const composition = report(); composition.request.intent = 'composition'
  expect(selectAnalysisView(composition)).toEqual({ type: 'bar', dimension: 'channel', metric: 'sales_amount' })
  expect(analysisChartOption(composition, selectAnalysisView(composition), labels).series).toMatchObject([
    { type: 'bar', name: '本期', data: [120] }, { type: 'bar', name: '对比期', data: [100] },
  ])
})

it('limits donut categories independently of the dense table threshold', () => {
  const value = report(); value.request.intent = 'composition'; delete value.request.comparison
  value.rows = Array.from({ length: 8 }, (_, index) => ({ dimensions: { channel: `channel-${index}` },
    metrics: { sales_amount: { value: index + 1 } } }))
  expect(selectAnalysisView(value).type).toBe('donut')
  value.rows.push({ dimensions: { channel: 'channel-8' }, metrics: { sales_amount: { value: 9 } } })
  expect(selectAnalysisView(value).type).toBe('horizontal-bar')
})

it('uses a compatible two-metric bar-line view and dense table fallback', () => {
  const combined = report(); combined.request.intent = 'comparison'; delete combined.request.comparison
  combined.request.metrics.push('orders'); combined.columns.metrics.push({ id: 'orders', name: '订单', format: 'number', additivity: 'additive', description: '订单数', limitations: [] }); combined.rows[0]!.metrics.orders = { value: 3 }
  expect(selectAnalysisView(combined)).toEqual({ type: 'bar-line', dimension: 'channel', barMetric: 'sales_amount', lineMetric: 'orders' })
  combined.request.metrics.push('purchasers'); combined.columns.metrics.push({ id: 'purchasers', name: '购买人数', format: 'number', additivity: 'non_additive', description: '人数', limitations: [] }); combined.rows[0]!.metrics.purchasers = { value: 2 }
  expect(selectAnalysisView(combined)).toEqual({ type: 'table' })
  const twoDimensions = report(); twoDimensions.request.dimensions.push('store'); twoDimensions.columns.dimensions.push({ id: 'store', name: '门店', dataType: 'keyword', composition: 'mutually_exclusive' }); twoDimensions.rows[0]!.dimensions.store = '上海店'
  expect(selectAnalysisView(twoDimensions)).toEqual({ type: 'table' })
  const dense = report(); dense.rows = Array.from({ length: 51 }, () => dense.rows[0]!)
  expect(selectAnalysisView(dense)).toEqual({ type: 'table' })
})

it('builds closed ECharts options and preserves null as a visible gap', () => {
  const persisted = analysis(); persisted.crmAnalysis.request.intent = 'trend'; persisted.crmAnalysis.request.timeGrain = 'month'
  persisted.crmAnalysis.request.dimensions = ['month']; persisted.crmAnalysis.data.request = persisted.crmAnalysis.request
  persisted.crmAnalysis.data.columns.dimensions = [{ id: 'month', name: '月', dataType: 'date', composition: 'high_cardinality' }]
  persisted.crmAnalysis.data.rows[0]!.dimensions = { month: '2025-07-01' }
  persisted.crmAnalysis.data.rows.push({ dimensions: { month: '2025-08-01' }, metrics: { sales_amount: {
    value: null, unavailableReason: 'missing', comparisonValue: null, comparisonUnavailableReason: 'missing',
    changeRatio: null, changeUnavailableReason: 'missing',
  } } })
  const trend = readAnalysis(persisted)!
  const option = analysisChartOption(trend, selectAnalysisView(trend), labels)
  expect(option).toMatchObject({ animation: false, tooltip: { renderMode: 'richText' }, series: [
    { type: 'line', connectNulls: false, data: [120, null] },
    { type: 'line', connectNulls: false, data: [100, null] },
  ] })
  expect(JSON.stringify(option)).not.toContain('missing')
})

it('renders comparison values as separate bars without calculating replacements', () => {
  const value = report(); value.request.intent = 'comparison'; value.rows[0]!.metrics.sales_amount = {
    value: null, unavailableReason: 'missing', comparisonValue: 100, changeRatio: null, changeUnavailableReason: 'missing',
  }
  const option = analysisChartOption(value, selectAnalysisView(value), labels)
  expect(option.series).toMatchObject([{ type: 'bar', name: '本期', data: [null] }, { type: 'bar', name: '对比期', data: [100] }])
})
