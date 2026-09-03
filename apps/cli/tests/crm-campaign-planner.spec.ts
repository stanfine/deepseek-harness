import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createCampaignPlan, findRecommendation } from '../config/examples/crm/campaign-planner.ts'
import { evaluateOpportunities } from '../config/examples/crm/opportunity-evaluator.ts'

const definition = { id: 'channel_decline', title: 'Optimize channel', dataset: 'orders', comparison: 'previous_period',
  rule: { kind: 'decline', metric: 'sales_amount', dimension: 'channel', threshold: 0.1 }, primaryMetrics: ['sales_amount'],
  guardrailMetrics: ['atv'], impactWeight: 0.8, riskWeight: 0.2, actionTemplate: 'Review the channel.',
  audienceConditions: [{ kind: 'dimension_value', dimension: 'channel' }], limitations: ['Aggregate evidence only.'] }

const model = { opportunityCatalog: () => [{ ...definition, available: true }], resolveOpportunity: () => definition }
const activation = { audienceTag: { id: 'target', code: 'target', name: 'Target', fullName: 'Target' }, exclusionTags: [
  { id: 'blocked', code: 'blocked', name: 'Blocked', fullName: 'Blocked' },
], group: { id: 'group', name: 'Group', kind: 'group', enabled: true },
category: { id: 'category', name: 'Category', kind: 'category', enabled: true },
content: { id: 'content', name: 'Content', kind: 'content', enabled: true, flowNodeId: 'MESSAGE' } }

function evidence(metrics = { sales_amount: { value: 70, comparisonValue: 100, changeRatio: -0.3 },
  atv: { value: 7, comparisonValue: 10, changeRatio: -0.3 } }) {
  return { version: 1, request: { metrics: ['sales_amount', 'atv'], dimensions: ['channel'], filters: [], start: '2026-08-01',
    end: '2026-09-01', intent: 'comparison', comparison: 'previous_period', limit: 20 }, columns: { dimensions: [
    { id: 'channel', name: 'Channel', dataType: 'keyword', composition: 'mutually_exclusive' },
  ], metrics: [] }, rows: [{ dimensions: { channel: 'store' }, metrics }], coverage: {
    current: { start: '2026-08-01', end: '2026-09-01', recordCount: 100, available: true, observedStart: '2026-01-01' },
    comparison: { kind: 'previous_period', start: '2026-07-01', end: '2026-08-01', recordCount: 100, available: true, observedStart: '2026-01-01' },
  }, completeness: { complete: true, missingDimensionDocuments: 0, omittedDocuments: 0, limitedRows: 0,
    countErrorUpperBound: 0, approximateMetrics: [], missingMetricValues: 0 }, warnings: [], drilldownDimensions: [] }
}

async function recommendation() {
  return (await evaluateOpportunities(model as never, { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' },
    async () => evidence() as never, AbortSignal.timeout(100))).recommendations[0]!
}

async function recordedSession(meta?: unknown) {
  const item = await recommendation()
  const session = Session.create(SessionId('current'))
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'call-1' as never,
    content: [{ type: 'text', text: 'recommendations' }], isError: false }), meta: (meta ?? {
    crmRecommendations: { version: 1, request: { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' },
      data: { version: 1, recommendations: [item] } },
  }) as never }, { surfaceOp: 'append' })
  return { session, item }
}

describe('CRM campaign planner', () => {
  it('resolves a recommendation only from a valid current-session tool result', async () => {
    const { session, item } = await recordedSession()
    expect(findRecommendation(session, item.recommendationId)).toEqual(item)
    expect(() => findRecommendation(Session.create(SessionId('other')), item.recommendationId)).toThrow(/current session/i)
  })

  it('rejects malformed metadata and a recommendation digest mismatch', async () => {
    const { session, item } = await recordedSession({ crmRecommendations: { version: 1, data: { recommendations: [] } } })
    expect(() => findRecommendation(session, item.recommendationId)).toThrow(/current session/i)
    const altered = { ...item, evidence: [{ ...item.evidence[0]!, rows: [
      { ...item.evidence[0]!.rows[0]!, metrics: { ...item.evidence[0]!.rows[0]!.metrics,
        sales_amount: { value: 60, comparisonValue: 100, changeRatio: -0.4 } } },
    ] }] }
    const recorded = await recordedSession({ crmRecommendations: { version: 1,
      request: { start: '2026-08-01', end: '2026-09-01', comparison: 'previous_period' },
      data: { version: 1, recommendations: [altered] } } })
    expect(() => findRecommendation(recorded.session, item.recommendationId)).toThrow(/digest/i)
  })

  it('creates a deterministic preview with an aggregate audience estimate', async () => {
    const item = await recommendation()
    let request: unknown
    const plan = await createCampaignPlan(model as never, item, activation as never, async (value) => {
      request = value
      return { ...evidence(), request: value, rows: [{ dimensions: {}, metrics: { purchaser_count: { value: 42 } } }] } as never
    }, AbortSignal.timeout(100))
    expect(request).toMatchObject({ metrics: ['purchaser_count'], filters: [
      { dimension: 'channel', operator: 'in', values: ['store'] },
    ] })
    expect(plan).toMatchObject({ version: 1, recommendationId: item.recommendationId, status: 'preview', readyForCreation: true,
      audiencePreview: { estimatedCount: 42 }, actionTemplate: 'Review the channel.' })
    expect(plan.planId).toMatch(/^plan_[A-Za-z0-9_-]{43}$/)
  })

  it('marks a plan unavailable when no governed audience condition exists', async () => {
    const item = await recommendation()
    const plan = await createCampaignPlan({ ...model, resolveOpportunity: () => ({ ...definition, audienceConditions: [] }) } as never,
      item, activation as never, () => { throw new Error('must not analyze') }, AbortSignal.timeout(100))
    expect(plan.readyForCreation).toBe(false)
    expect(plan.readinessReasons).toContain('No governed audience condition is configured')
  })
})
