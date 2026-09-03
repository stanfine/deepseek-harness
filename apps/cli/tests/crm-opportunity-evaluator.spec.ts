import { describe, expect, it } from 'vitest'
import { evaluateOpportunities } from '../config/examples/crm/opportunity-evaluator.ts'

function opportunity(id: string, rule: Record<string, unknown>, weights = { impactWeight: 0.8, riskWeight: 0.25 }) {
  return { id, title: `Title ${id}`, dataset: 'orders', comparison: 'previous_period', rule,
    primaryMetrics: [String(rule.metric)], guardrailMetrics: ['order_count'], ...weights,
    actionTemplate: `Act ${id}`, audienceConditions: [], limitations: ['Aggregate evidence only.'] }
}

function model(definitions: ReturnType<typeof opportunity>[]) {
  return { opportunityCatalog: () => definitions.map(item => ({ ...item, available: true })),
    resolveOpportunity: (id: string) => definitions.find(item => item.id === id)! }
}

function analysis(rows: unknown[], overrides: Record<string, unknown> = {}) {
  return { version: 1, request: { metrics: ['sales_amount', 'order_count'], dimensions: [], filters: [],
    start: '2026-08-01', end: '2026-09-01', intent: 'comparison', comparison: 'previous_period', limit: 20 },
  columns: { dimensions: [], metrics: [
    { id: 'sales_amount', name: 'Sales', format: 'currency', additivity: 'additive', description: 'Sales.', limitations: [] },
    { id: 'order_count', name: 'Orders', format: 'number', additivity: 'additive', description: 'Orders.', limitations: [] },
  ] }, rows, coverage: { current: { start: '2026-08-01', end: '2026-09-01', recordCount: 100, available: true, observedStart: '2026-01-01' },
    comparison: { kind: 'previous_period', start: '2026-07-01', end: '2026-08-01', recordCount: 100, available: true, observedStart: '2026-01-01' } },
  completeness: { complete: true, missingDimensionDocuments: 0, omittedDocuments: 0, limitedRows: 0,
    countErrorUpperBound: 0, approximateMetrics: [], missingMetricValues: 0 }, warnings: [], drilldownDimensions: [], ...overrides }
}

describe('CRM opportunity evaluator', () => {
  it('rejects unknown request keys before analysis', async () => {
    const analyze = () => { throw new Error('must not analyze') }
    await expect(evaluateOpportunities({} as never,
      { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period', script: 'x' } as never,
      analyze, AbortSignal.timeout(100))).rejects.toThrow(/Unknown opportunity request argument/)
  })

  it('returns unavailable configured opportunities without calling analysis', async () => {
    const model = {
      opportunityCatalog: () => [{ id: 'reactivation', available: false, unavailableReason: 'Missing recency' }],
      resolveOpportunity: () => { throw new Error('must not resolve unavailable') },
    }
    const result = await evaluateOpportunities(model as never,
      { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period', opportunityIds: ['reactivation'] },
      () => { throw new Error('must not analyze') }, AbortSignal.timeout(100))
    expect(result).toEqual({ version: 1, request: { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period', opportunityIds: ['reactivation'] },
      recommendations: [], unavailable: [{ opportunityId: 'reactivation', reason: 'Missing recency' }] })
  })

  it('expands a decline rule into fixed aggregate evidence and scores the threshold breach', async () => {
    const definition = opportunity('channel_decline', { kind: 'decline', metric: 'sales_amount', dimension: 'channel', threshold: 0.1 })
    let received: unknown
    const result = await evaluateOpportunities(model([definition]) as never,
      { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' }, async (request) => {
        received = request
        return analysis([{ dimensions: { channel: 'store' }, metrics: {
          sales_amount: { value: 70, comparisonValue: 100, changeRatio: -0.3 },
          order_count: { value: 10, comparisonValue: 12, changeRatio: -1 / 6 },
        } }], { request: { metrics: ['sales_amount', 'order_count'], dimensions: ['channel'], filters: [],
          start: '2026-08-01', end: '2026-09-01', intent: 'comparison', comparison: 'previous_period', limit: 20 } }) as never
      }, AbortSignal.timeout(100))
    expect(received).toEqual({ metrics: ['sales_amount', 'order_count'], dimensions: ['channel'], start: '2026-08-01',
      end: '2026-09-01', intent: 'comparison', comparison: 'previous_period', limit: 20 })
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]).toMatchObject({ opportunityId: 'channel_decline', score: 1.2, priority: 1,
      title: 'Title channel_decline', actionTemplate: 'Act channel_decline' })
    expect(result.recommendations[0]?.recommendationId).toMatch(/^rec_[A-Za-z0-9_-]{43}$/)
    expect(result.recommendations[0]?.evidence[0]?.rows).toHaveLength(1)
  })

  it('evaluates grouped peer rules and returns only the stable top three', async () => {
    const definitions = [
      opportunity('delta', { kind: 'above_average', metric: 'sales_amount', dimension: 'channel', threshold: 0.1 }),
      opportunity('alpha', { kind: 'below_average', metric: 'sales_amount', dimension: 'channel', threshold: 0.1 }),
      opportunity('charlie', { kind: 'growth', metric: 'sales_amount', threshold: 0.1 }, { impactWeight: 0.7, riskWeight: 0 }),
      opportunity('bravo', { kind: 'growth', metric: 'sales_amount', threshold: 0.1 }, { impactWeight: 0.7, riskWeight: 0 }),
    ]
    const result = await evaluateOpportunities(model(definitions) as never,
      { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' }, async (request) => {
        if (request.dimensions?.length) return analysis([
          { dimensions: { channel: 'high' }, metrics: { sales_amount: { value: 150 }, order_count: { value: 10 } } },
          { dimensions: { channel: 'low' }, metrics: { sales_amount: { value: 50 }, order_count: { value: 10 } } },
        ], { request: { metrics: ['sales_amount', 'order_count'], dimensions: ['channel'], filters: [], start: request.start,
          end: request.end, intent: 'comparison', comparison: 'previous_period', limit: 20 } }) as never
        return analysis([{ dimensions: {}, metrics: { sales_amount: { value: 120, comparisonValue: 100, changeRatio: 0.2 },
          order_count: { value: 10, comparisonValue: 10, changeRatio: 0 } } }]) as never
      }, AbortSignal.timeout(100))
    expect(result.recommendations.map(item => item.opportunityId)).toEqual(['alpha', 'delta', 'bravo'])
    expect(result.recommendations.map(item => item.priority)).toEqual([1, 2, 3])
  })

  it.each([
    ['incomplete evidence', { completeness: { complete: false, missingDimensionDocuments: 1, omittedDocuments: 0, limitedRows: 0,
      countErrorUpperBound: 0, approximateMetrics: [], missingMetricValues: 0 } }],
    ['unavailable comparison coverage', { coverage: { current: { start: '2026-08-01', end: '2026-09-01', recordCount: 100,
      available: true, observedStart: '2026-01-01' }, comparison: { kind: 'previous_period', start: '2026-07-01',
      end: '2026-08-01', recordCount: 0, available: false, observedStart: null, reason: 'Unavailable' } } }],
  ])('refuses %s instead of scoring partial evidence', async (_label, overrides) => {
    const definition = opportunity('growth', { kind: 'growth', metric: 'sales_amount', threshold: 0.1 })
    await expect(evaluateOpportunities(model([definition]) as never,
      { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' }, async () => analysis([
        { dimensions: {}, metrics: { sales_amount: { value: 120, comparisonValue: 100, changeRatio: 0.2 }, order_count: { value: 10 } } },
      ], overrides) as never, AbortSignal.timeout(100))).rejects.toThrow(/evidence/i)
  })

  it('rejects missing rule metrics and oversized evidence before publication', async () => {
    const definition = opportunity('growth', { kind: 'growth', metric: 'sales_amount', threshold: 0.1 })
    await expect(evaluateOpportunities(model([definition]) as never,
      { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' }, async () => analysis([
        { dimensions: {}, metrics: { order_count: { value: 10 } } },
      ]) as never, AbortSignal.timeout(100))).rejects.toThrow(/missing rule metric/i)
  })
})
