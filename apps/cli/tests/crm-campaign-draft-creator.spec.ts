import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createCampaignDraft, findCampaignPlan } from '../config/examples/crm/campaign-draft-creator.ts'
import { campaignPlanIdFor } from '../config/examples/crm/campaign-planner.ts'

const audiencePreview = { conditions: [{ kind: 'dimension_value', dimension: 'channel' }], estimatedCount: 42,
  unavailableReasons: [] }
const activation = { group: { id: 'group', name: 'Group', kind: 'group', enabled: true },
  category: { id: 'category', name: 'Category', kind: 'category', enabled: true },
  content: { id: 'content', name: 'Content', kind: 'content', enabled: true, flowNodeId: 'MESSAGE' } }
const plan = { version: 1, planId: campaignPlanIdFor('rec_abc', audiencePreview as never, activation as never), recommendationId: 'rec_abc',
  status: 'preview', readyForCreation: true, readinessReasons: [], audiencePreview, actionTemplate: 'Offer',
  activation, primaryMetrics: ['sales_amount'], guardrailMetrics: ['atv'], limitations: [] }
const audience = { id: 'aud-plan', name: 'Audience', description: 'Test', selectType: 'CONDITION', usageType: 'CAMPAIGN',
  filter: { all: [] }, setting: { dwhType: 'MA' }, extra: { planId: plan.planId } }
const campaign = { id: 'campaign-plan', name: 'Campaign', groupId: 'group', campaignCode: 'code', category: 'category',
  type: 'AUTOMATION', priority: 0, summary: 'Test', setting: { type: 'FLOW' }, extra: { planId: plan.planId } }
const canvas = { nodes: [
  { id: 'entry', type: 'START', config: {} }, { id: 'audience', type: 'AUDIENCE', config: {} },
  { id: 'action', type: 'ACTION', config: { kind: 'ma_delivery', templateId: 'content', capabilityId: 'sms' } },
  { id: 'end', type: 'END', config: {} },
], edges: [
  { id: 'edge-1', source: 'entry', target: 'audience', connectorId: 'sequence' },
  { id: 'edge-2', source: 'audience', target: 'action', connectorId: 'sequence' },
  { id: 'edge-3', source: 'action', target: 'end', connectorId: 'sequence' },
] }

function recordedPlan(value = plan) {
  const session = Session.create(SessionId('current'))
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'plan-call' as never,
    content: [{ type: 'text', text: 'plan' }], isError: false }), meta: { crmCampaignPlan: { version: 1,
    recommendationId: value.recommendationId, data: value } } }, { surfaceOp: 'append' })
  return session
}

function services(overrides: Record<string, unknown> = {}) {
  const calls = { count: 0, audience: 0, campaign: 0, findAudience: 0, findCampaign: 0 }
  const ma = {
    async countAudience() { calls.count++; return 42 },
    async validateCanvas() { return [] },
    async createAudience() { calls.audience++; return { id: 'ma-audience', name: 'Audience' } },
    async findAudienceByBusinessKey() { calls.findAudience++; return undefined },
    async createCampaignDraft() { calls.campaign++; return { id: 'ma-campaign', name: 'Campaign', status: 'DRAFT' } },
    async findCampaignByBusinessKey() { calls.findCampaign++; return undefined },
    ...overrides,
  }
  return { value: { ma, tenantId: 'mkt', maxAudienceSize: 1000, audience, campaign, canvas } as never, calls }
}

describe('CRM campaign draft creator', () => {
  it('resolves only an untampered current-session campaign plan', () => {
    expect(findCampaignPlan(recordedPlan(), plan.planId)).toEqual(plan)
    expect(() => findCampaignPlan(Session.create(SessionId('other')), plan.planId)).toThrow(/current session/i)
    const altered = { ...plan, audiencePreview: { ...plan.audiencePreview, estimatedCount: 99 } }
    expect(() => findCampaignPlan(recordedPlan(altered), plan.planId)).toThrow(/digest mismatch/)
  })

  it('creates once and replays the completed recorded result without more writes', async () => {
    const session = recordedPlan(); const source = services()
    const first = await createCampaignDraft(session, source.value, plan as never, AbortSignal.timeout(500))
    const second = await createCampaignDraft(session, source.value, plan as never, AbortSignal.timeout(500))
    expect(first).toMatchObject({ audienceId: 'ma-audience', campaignId: 'ma-campaign', status: 'inactive', created: true })
    expect(second).toMatchObject({ audienceId: 'ma-audience', campaignId: 'ma-campaign', status: 'inactive', created: false })
    expect(source.calls).toMatchObject({ audience: 1, campaign: 1 })
    expect(session.events.map(event => event.type)).toContain('crm-campaign/draft-created')
  })

  it('reuses a recorded audience after campaign creation fails', async () => {
    let attempt = 0
    const source = services({ async createCampaignDraft() {
      attempt++
      if (attempt === 1) throw new Error('MA HTTP 500')
      return { id: 'ma-campaign', name: 'Campaign', status: 'DRAFT' }
    } })
    const session = recordedPlan()
    await expect(createCampaignDraft(session, source.value, plan as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/Campaign creation failed/)
    await expect(createCampaignDraft(session, source.value, plan as never, AbortSignal.timeout(500)))
      .resolves.toMatchObject({ created: true })
    expect(source.calls.audience).toBe(1)
  })

  it('reconciles an ambiguous audience write by business key before continuing', async () => {
    const source = services({
      async createAudience() { throw new Error('MA request cancelled or timed out') },
      async findAudienceByBusinessKey() { return { id: 'resolved-audience', name: 'Audience' } },
    })
    const result = await createCampaignDraft(recordedPlan(), source.value, plan as never, AbortSignal.timeout(500))
    expect(result.audienceId).toBe('resolved-audience')
  })

  it('stops before writes when the caller has already cancelled', async () => {
    const session = recordedPlan(); const source = services()
    await expect(createCampaignDraft(session, source.value, plan as never, AbortSignal.abort())).rejects.toThrow()
    expect(source.calls).toMatchObject({ count: 0, audience: 0, campaign: 0 })
    expect(session.events.some(event => event.type === 'crm-campaign/draft-started')).toBe(false)
  })

  it('fails closed when an ambiguous write cannot be reconciled', async () => {
    const source = services({
      async createAudience() { throw new Error('MA request cancelled or timed out') },
      async findAudienceByBusinessKey() { throw new Error('lookup unavailable') },
    })
    const session = recordedPlan()
    await expect(createCampaignDraft(session, source.value, plan as never, AbortSignal.timeout(500)))
      .rejects.toThrow(/manual reconciliation/)
    expect(session.events.find(event => event.type === 'crm-campaign/draft-failed')?.data)
      .toMatchObject({ stage: 'audience', code: 'MANUAL_RECONCILIATION' })
  })
})
