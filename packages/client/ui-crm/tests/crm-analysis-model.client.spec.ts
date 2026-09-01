import { expect, it } from 'vitest'
import { ANALYSIS_META_MAX_BYTES, readAnalysis } from '../src/client/analysis-model.ts'
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

it('requires the exact normalized comparison window and consistent availability', () => {
  const arbitrary = analysis(); const arbitraryCoverage = arbitrary.crmAnalysis.data.coverage.comparison as Record<string, unknown>
  arbitraryCoverage.start = '2025-06-01'
  const unavailableComplete = analysis()
  const unavailable = unavailableComplete.crmAnalysis.data.coverage.comparison as Record<string, unknown>
  unavailable.available = false; unavailable.reason = 'coverage'; unavailableComplete.crmAnalysis.data.completeness.complete = true
  const unavailableValues = analysis()
  const unavailableValueCoverage = unavailableValues.crmAnalysis.data.coverage.comparison as Record<string, unknown>
  unavailableValueCoverage.available = false; unavailableValueCoverage.reason = 'coverage'; unavailableValues.crmAnalysis.data.completeness.complete = false
  const validUnavailable = structuredClone(unavailableValues); validUnavailable.crmAnalysis.data.rows[0]!.metrics.sales_amount = {
    value: 120, comparisonValue: null, comparisonUnavailableReason: 'coverage',
    changeRatio: null, changeUnavailableReason: 'comparison unavailable',
  }
  const priorYear = analysis(); priorYear.crmAnalysis.request.comparison = 'prior_year'; priorYear.crmAnalysis.data.request = priorYear.crmAnalysis.request
  const priorCoverage = priorYear.crmAnalysis.data.coverage.comparison as Record<string, unknown>
  priorCoverage.kind = 'prior_year'; priorCoverage.start = '2024-07-02'; priorCoverage.end = '2024-08-02'
  expect(readAnalysis(priorYear)).not.toBeNull()
  expect(readAnalysis(validUnavailable)).not.toBeNull()
  expect(readAnalysis(arbitrary)).toBeNull()
  expect(readAnalysis(unavailableComplete)).toBeNull()
  expect(readAnalysis(unavailableValues)).toBeNull()
})

it('rejects impossible metric availability and change states', () => {
  const unavailableChanged = analysis(); unavailableChanged.crmAnalysis.data.rows[0]!.metrics.sales_amount = {
    value: null, unavailableReason: 'missing', comparisonValue: 100, changeRatio: 0.2,
  }
  const zeroChanged = analysis(); zeroChanged.crmAnalysis.data.rows[0]!.metrics.sales_amount = {
    value: 120, comparisonValue: 0, changeRatio: 1,
  }
  const availableMissing = analysis(); availableMissing.crmAnalysis.data.rows[0]!.metrics.sales_amount = {
    value: 120, comparisonValue: 100, changeRatio: null, changeUnavailableReason: 'missing',
  }
  for (const value of [unavailableChanged, zeroChanged, availableMissing]) expect(readAnalysis(value)).toBeNull()
})

function byteSizedAnalysis(target: number) {
  const value = analysis(); value.crmAnalysis.request.limit = 500; value.crmAnalysis.data.request = value.crmAnalysis.request
  const original = value.crmAnalysis.data.rows[0]!
  value.crmAnalysis.data.rows = Array.from({ length: 500 }, () => ({
    dimensions: { channel: '三'.repeat(660) }, metrics: structuredClone(original.metrics),
  }))
  value.crmAnalysis.data.rows[499]!.dimensions.channel = ''
  const bytes = new TextEncoder().encode(JSON.stringify(value.crmAnalysis)).byteLength
  const remaining = target - bytes
  if (remaining < 0 || remaining > 6000) throw new Error('Fixture cannot reach requested byte size')
  value.crmAnalysis.data.rows[499]!.dimensions.channel = '三'.repeat(Math.floor(remaining / 3)) + 'a'.repeat(remaining % 3)
  return value
}

it('bounds full persisted UTF-8 metadata and rows by the normalized limit', () => {
  const tooManyRows = analysis(); tooManyRows.crmAnalysis.request.limit = 1
  tooManyRows.crmAnalysis.data.request = tooManyRows.crmAnalysis.request
  tooManyRows.crmAnalysis.data.rows.push(structuredClone(tooManyRows.crmAnalysis.data.rows[0]!))
  const exact = byteSizedAnalysis(ANALYSIS_META_MAX_BYTES)
  expect(new TextEncoder().encode(JSON.stringify(exact.crmAnalysis))).toHaveLength(ANALYSIS_META_MAX_BYTES)
  expect(readAnalysis(exact)).not.toBeNull()
  const last = exact.crmAnalysis.data.rows[499]!
  last.dimensions.channel = `${String(last.dimensions.channel)}a`
  expect(readAnalysis(exact)).toBeNull()
  expect(readAnalysis(tooManyRows)).toBeNull()
})
