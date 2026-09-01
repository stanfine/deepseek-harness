import { expect, it } from 'vitest'
import { readAnalysis } from '../src/client/analysis-model.ts'
import { analysis } from './fixtures/crm-analysis.ts'

it('accepts persisted summary, trend, ranking, composition, and two-metric results', () => {
  const variants = [
    analysis(),
    (() => { const value = analysis(); value.crmAnalysis.request.intent = 'summary'; value.crmAnalysis.request.dimensions = []; value.crmAnalysis.data.request = value.crmAnalysis.request; value.crmAnalysis.data.columns.dimensions = []; value.crmAnalysis.data.rows[0]!.dimensions = {}; return value })(),
    (() => { const value = analysis(); value.crmAnalysis.request.intent = 'trend'; value.crmAnalysis.request.timeGrain = 'month'; value.crmAnalysis.data.request = value.crmAnalysis.request; value.crmAnalysis.data.columns.dimensions[0] = { id: 'month', name: '月', dataType: 'date' }; value.crmAnalysis.request.dimensions = ['month']; value.crmAnalysis.data.rows[0]!.dimensions = { month: '2025-07-01' }; return value })(),
    (() => { const value = analysis(); value.crmAnalysis.request.intent = 'composition'; value.crmAnalysis.data.request = value.crmAnalysis.request; return value })(),
    (() => { const value = analysis(); value.crmAnalysis.request.metrics.push('orders'); value.crmAnalysis.data.request = value.crmAnalysis.request; value.crmAnalysis.data.columns.metrics.push({ id: 'orders', name: '订单', format: 'number', description: '订单数', limitations: [] }); value.crmAnalysis.data.rows[0]!.metrics.orders = { value: 3, comparisonValue: 2, changeRatio: 0.5 }; return value })(),
    (() => { const value = analysis(); value.crmAnalysis.data.rows[0]!.metrics.sales_amount = {
      value: null, unavailableReason: 'unavailable', comparisonValue: null,
      comparisonUnavailableReason: 'unavailable', changeRatio: null, changeUnavailableReason: 'unavailable',
    }; return value })(),
  ]
  for (const value of variants) expect(readAnalysis(value)).not.toBeNull()
})

it('rejects non-finite values, column mismatches, duplicate ids, and unknown row keys', () => {
  const nonFinite = analysis(); nonFinite.crmAnalysis.data.rows[0]!.metrics.sales_amount!.value = Number.POSITIVE_INFINITY
  const mismatch = analysis(); mismatch.crmAnalysis.data.columns.metrics[0]!.id = 'orders'
  const duplicate = analysis(); duplicate.crmAnalysis.data.columns.metrics.push({ ...duplicate.crmAnalysis.data.columns.metrics[0]! })
  const unknown = analysis(); unknown.crmAnalysis.data.rows[0]!.dimensions.store = '上海店'
  for (const value of [nonFinite, mismatch, duplicate, unknown]) expect(readAnalysis(value)).toBeNull()
})

it('rejects unsafe drilldowns, oversized arrays, and malformed completeness', () => {
  const unsafe = analysis(); unsafe.crmAnalysis.data.drilldownDimensions = ['store;script']
  const oversized = analysis(); oversized.crmAnalysis.data.rows = Array.from({ length: 501 }, () => oversized.crmAnalysis.data.rows[0]!)
  const warnings = analysis(); warnings.crmAnalysis.data.warnings = Array.from({ length: 101 }, () => 'warning')
  const malformed = analysis(); malformed.crmAnalysis.data.completeness.complete = true
  malformed.crmAnalysis.data.completeness.omittedDocuments = 1
  for (const value of [unsafe, oversized, warnings, malformed]) expect(readAnalysis(value)).toBeNull()
})

it('rejects metadata whose outer request differs from the source result', () => {
  const value = analysis(); value.crmAnalysis.request.start = '2025-06-01'
  expect(readAnalysis(value)).toBeNull()
})
