import { describe, expect, it } from 'vitest'
import type { Dataset } from '../config/examples/crm/elasticsearch.ts'
import {
  resolveAnalysisPlan,
  type AnalysisRequest,
  type DrilldownRequest,
} from '../config/examples/crm/analysis-planner.ts'
import { resolveSemanticModel, type SemanticConfig } from '../config/examples/crm/semantic-model.ts'

const datasets: Record<string, Dataset> = {
  facts: {
    index: 'crm_facts', timeField: 'private_order_date', amountField: 'private_amount', customerField: 'private_customer',
    amountMeaning: 'Configured fact amount.', dimensions: { province: 'private_province', channel: 'private_channel' },
    measures: { orderCount: 'private_order_count' }, previewFields: [],
  },
  items: {
    index: 'crm_items', timeField: 'private_item_date', amountField: 'private_item_amount',
    amountMeaning: 'Configured item amount.', dimensions: { series: 'private_series' }, measures: {}, previewFields: [],
  },
}

function model(change?: (config: SemanticConfig) => void) {
  const config: SemanticConfig = {
    maxSelectedMetrics: 3, maxDimensions: 2, maxFilters: 3, maxTopN: 10,
    maxFilterValues: 20, maxInputChars: 128, maxRequestBytes: 8192, timeGrains: ['day', 'week', 'month'],
    metrics: [
      { id: 'sales_amount', name: '销售额', dataset: 'facts', kind: 'sum', field: 'amount', format: 'currency', description: 'Sales.', limitations: [] },
      { id: 'order_count', name: '订单数', dataset: 'facts', kind: 'sum', field: 'orderCount', format: 'number', description: 'Orders.', limitations: [] },
      { id: 'document_count', name: '记录数', dataset: 'facts', kind: 'count', format: 'number', description: 'Documents.', limitations: [] },
      { id: 'atv', name: '客单价', dataset: 'facts', kind: 'ratio', dependencies: ['sales_amount', 'order_count'], format: 'currency', description: 'Average.', limitations: [] },
      { id: 'item_sales', name: '商品销售额', dataset: 'items', kind: 'sum', field: 'amount', format: 'currency', description: 'Item sales.', limitations: [] },
    ],
    dimensions: [
      { id: 'day', name: '日期', dataset: 'facts', field: 'time', dataType: 'date', filters: ['equals', 'in'], timeGrains: ['day', 'week', 'month'], description: 'Date.', limitations: [] },
      { id: 'province', name: '省份', dataset: 'facts', field: 'province', dataType: 'keyword', filters: ['equals', 'in'], description: 'Province.', limitations: [] },
      { id: 'channel', name: '渠道', dataset: 'facts', field: 'channel', dataType: 'keyword', filters: ['equals', 'in'], description: 'Channel.', limitations: [] },
      { id: 'series', name: '系列', dataset: 'items', field: 'series', dataType: 'keyword', filters: ['equals', 'in'], description: 'Series.', limitations: [] },
    ],
  }
  change?.(config)
  return resolveSemanticModel(config, datasets)
}

const budgets = { maxRangeDays: 366, maxBuckets: 31 }
const base: AnalysisRequest = {
  metrics: ['atv', 'sales_amount', 'atv'], start: '2025-05-01', end: '2025-05-08', intent: 'summary',
}

describe('CRM semantic analysis planner', () => {
  it('rejects multiple date dimensions and incompatible trend sort before execution', () => {
    const semantic = model()
    const secondDate = { ...semantic.dimensions.get('day')!, id: 'month' }
    const forged = { ...semantic, dimensions: new Map([...semantic.dimensions, ['month', secondDate]]) }
    expect(() => resolveAnalysisPlan(forged, { ...base, metrics: ['sales_amount'], dimensions: ['day', 'month'], timeGrain: 'day', intent: 'trend' }, budgets)).toThrow(/one date dimension/i)
    expect(() => resolveAnalysisPlan(semantic, { ...base, metrics: ['sales_amount'], dimensions: ['day'], timeGrain: 'day', intent: 'trend', sort: { metric: 'sales_amount', direction: 'desc' } }, budgets)).toThrow(/sort.*intent/i)
  })

  it('budgets every date grouping and rejects date filters with invalid calendar values', () => {
    expect(() => resolveAnalysisPlan(model(), { metrics: ['sales_amount'], dimensions: ['day'], timeGrain: 'day', start: '2025-01-01', end: '2025-02-01', intent: 'comparison' }, { ...budgets, maxBuckets: 10 })).toThrow(/bucket budget/i)
    expect(() => resolveAnalysisPlan(model(), { ...base, metrics: ['sales_amount'], filters: [{ dimension: 'day', operator: 'equals', value: '2025-02-30' }] }, budgets)).toThrow(/calendar filter/i)
  })
  it('resolves a summary with stable metric deduplication and derived source measures', () => {
    const plan = resolveAnalysisPlan(model(), base, budgets)

    expect(plan.dataset).toBe('facts')
    expect(plan.start).toBe('2025-05-01')
    expect(plan.end).toBe('2025-05-08')
    expect(plan.metrics.map(metric => metric.id)).toEqual(['atv', 'sales_amount'])
    expect(plan.sourceMeasures.map(metric => metric.id)).toEqual(['sales_amount', 'order_count'])
    expect(plan.derivedMetrics.map(metric => metric.id)).toEqual(['atv'])
    expect(plan.dimensions).toEqual([])
    expect(plan.filters).toEqual([])
    expect(plan.comparison).toBeUndefined()
    expect(plan.limit).toBe(10)
  })

  it.each([
    ['trend', { ...base, metrics: ['sales_amount'], dimensions: ['day'], timeGrain: 'day', intent: 'trend' }, []],
    ['ranking', { ...base, metrics: ['sales_amount'], dimensions: ['province'], intent: 'ranking', sort: { metric: 'sales_amount', direction: 'desc' }, limit: 5 }, []],
    ['composition', { ...base, metrics: ['sales_amount'], dimensions: ['province'], intent: 'composition' }, []],
  ] as const)('resolves a valid %s request', (_name, request, expectedDerived) => {
    const plan = resolveAnalysisPlan(model(), request, budgets)

    expect(plan.intent).toBe(request.intent)
    expect(plan.derivedMetrics.map(metric => metric.id)).toEqual(expectedDerived)
  })

  it('normalizes two dimensions and allowlisted equality and inclusion filters', () => {
    const plan = resolveAnalysisPlan(model(), {
      ...base, metrics: ['sales_amount'], dimensions: ['province', 'channel'], intent: 'ranking',
      filters: [
        { dimension: 'province', operator: 'equals', value: '浙江' },
        { dimension: 'channel', operator: 'in', values: ['store', 'online', 'store'] },
      ],
    }, budgets)

    expect(plan.dimensions.map(dimension => dimension.id)).toEqual(['province', 'channel'])
    expect(plan.filters.map(filter => ({ dimension: filter.dimension.id, operator: filter.operator, values: filter.values }))).toEqual([
      { dimension: 'province', operator: 'equals', values: ['浙江'] },
      { dimension: 'channel', operator: 'in', values: ['store', 'online'] },
    ])
  })

  it.each([
    ['previous_period', { start: '2025-04-24', end: '2025-05-01' }],
    ['prior_year', { start: '2024-05-02', end: '2024-05-09' }],
  ] as const)('aligns the %s comparison window by calendar days', (comparison, expected) => {
    const plan = resolveAnalysisPlan(model(), { ...base, metrics: ['sales_amount'], comparison }, budgets)

    expect(plan.comparison).toEqual({ kind: comparison, ...expected })
  })

  it('adds drilldown parent values as filters before the new dimension', () => {
    const request: DrilldownRequest = {
      ...base, metrics: ['sales_amount'], dimensions: ['province'], intent: 'ranking', drilldownDimension: 'channel',
      parentFilters: [{ dimension: 'province', values: ['浙江', '上海'] }],
    }
    const plan = resolveAnalysisPlan(model(), request, budgets)

    expect(plan.dimensions.map(dimension => dimension.id)).toEqual(['province', 'channel'])
    expect(plan.filters.map(filter => ({ dimension: filter.dimension.id, operator: filter.operator, values: filter.values }))).toEqual([
      { dimension: 'province', operator: 'in', values: ['浙江', '上海'] },
    ])
  })

  it('rejects drilldown parent values when the parent dimension disallows inclusion filters', () => {
    const request: DrilldownRequest = {
      ...base, metrics: ['sales_amount'], dimensions: ['province'], intent: 'ranking', drilldownDimension: 'channel',
      parentFilters: [{ dimension: 'province', values: ['浙江'] }],
    }

    expect(() => resolveAnalysisPlan(model((config) => { config.dimensions[1] = { ...config.dimensions[1]!, filters: ['equals'] } }), request, budgets))
      .toThrow(/Unsupported filter for dimension province/)
  })

  it('requires a drilldown to constrain at least one selected parent dimension', () => {
    const request: DrilldownRequest = {
      ...base, metrics: ['sales_amount'], dimensions: ['province'], intent: 'ranking', drilldownDimension: 'channel', parentFilters: [],
    }

    expect(() => resolveAnalysisPlan(model(), request, budgets)).toThrow(/Drilldown requires at least one parent filter/)
  })

  it.each([
    ['day', '2025-05-01', '2025-06-01', 31, false],
    ['day', '2025-05-01', '2025-06-02', 31, true],
    ['week', '2025-05-05', '2025-05-12', 1, false],
    ['week', '2025-05-05', '2025-05-13', 1, true],
    ['month', '2025-05-01', '2025-06-01', 1, false],
    ['month', '2025-05-01', '2025-06-02', 1, true],
  ] as const)('enforces the %s trend bucket budget at the boundary', (timeGrain, start, end, maxBuckets, rejected) => {
    const request: AnalysisRequest = { metrics: ['sales_amount'], dimensions: ['day'], start, end, timeGrain, intent: 'trend' }
    const resolve = () => resolveAnalysisPlan(model(), request, { maxRangeDays: 366, maxBuckets })

    if (rejected) expect(resolve).toThrow(/Trend exceeds bucket budget/)
    else expect(resolve).not.toThrow()
  })

  it.each([
    ['unknown metric', { ...base, metrics: ['missing'] }, /Unknown metric/],
    ['unknown dimension', { ...base, dimensions: ['missing'] }, /Unknown dimension/],
    ['unknown filter dimension', { ...base, filters: [{ dimension: 'missing', operator: 'equals', value: '浙江' }] }, /Unknown dimension/],
    ['no metrics', { ...base, metrics: [] }, /Select one to 3 metrics/],
    ['too many metrics', { ...base, metrics: ['sales_amount', 'order_count', 'atv', 'document_count'] }, /Select one to 3 metrics/],
    ['too many dimensions', { ...base, dimensions: ['day', 'province', 'channel'] }, /Too many dimensions/],
    ['too many filters', { ...base, filters: [
      { dimension: 'province', operator: 'equals', value: '浙江' }, { dimension: 'channel', operator: 'equals', value: '线上' },
      { dimension: 'province', operator: 'equals', value: '上海' }, { dimension: 'channel', operator: 'equals', value: '门店' },
    ] }, /Too many filters/],
    ['cross-dataset selection', { ...base, metrics: ['sales_amount', 'item_sales'] }, /Cross-dataset selection/],
    ['unsupported time grain', { ...base, metrics: ['sales_amount'], dimensions: ['province'], timeGrain: 'day' }, /Time grain requires one configured date dimension/],
    ['invalid date', { ...base, start: '2025-02-30' }, /Invalid calendar date/],
    ['excessive date range', { ...base, start: '2024-01-01', end: '2025-05-01' }, /Date window exceeds configured range/],
    ['invalid sort metric', { ...base, sort: { metric: 'order_count', direction: 'desc' } }, /Sort metric must be selected/],
  ] as const)('rejects %s', (_name, request, error) => {
    expect(() => resolveAnalysisPlan(model(), request, budgets)).toThrow(error)
  })

  it('rejects a configured dimension filter operation that the request names', () => {
    const request: AnalysisRequest = { ...base, metrics: ['sales_amount'], filters: [{ dimension: 'channel', operator: 'in', values: ['online'] }] }

    expect(() => resolveAnalysisPlan(model((config) => { config.dimensions[2] = { ...config.dimensions[2]!, filters: ['equals'] } }), request, budgets))
      .toThrow(/Unsupported filter for dimension channel/)
  })

  it('rejects a drilldown dimension that repeats a parent dimension', () => {
    const request: DrilldownRequest = {
      ...base, metrics: ['sales_amount'], dimensions: ['province'], intent: 'ranking', drilldownDimension: 'province',
      parentFilters: [{ dimension: 'province', values: ['浙江'] }],
    }

    expect(() => resolveAnalysisPlan(model(), request, budgets)).toThrow(/Drilldown dimension already selected/)
  })
})
