/** CRM campaign presentation validation contracts. */
import { describe, expect, it } from 'vitest'
import { readCampaign } from '../src/client/campaign-model.ts'

const plan = { crmCampaignPlan: { version: 1, data: { version: 1, planId: 'plan_abc', recommendationId: 'rec_abc', status: 'preview', readyForCreation: true,
  readinessReasons: [], audiencePreview: { conditions: [{ kind: 'dimension_value' }], estimatedCount: 42,
    unavailableReasons: [] }, actionTemplate: '发送配置模板', primaryMetrics: ['sales_amount'],
  guardrailMetrics: ['atv'], limitations: ['仅汇总证据'], activation: {
    group: { id: 'group', name: 'Group', kind: 'group', enabled: true },
    category: { id: 'category', name: 'Category', kind: 'category', enabled: true },
    content: { id: 'content', name: 'Content', kind: 'content', enabled: true, flowNodeId: 'MESSAGE' },
  }, canvas: { nodes: [{ id: 'entry', type: 'START', config: {} }, { id: 'audience', type: 'AUDIENCE', config: {} },
    { id: 'action', type: 'ACTION', config: {} }, { id: 'end', type: 'END', config: {} }], edges: [
    { id: 'e1', source: 'entry', target: 'audience', connectorId: 'sequence' },
    { id: 'e2', source: 'audience', target: 'action', connectorId: 'sequence' },
    { id: 'e3', source: 'action', target: 'end', connectorId: 'sequence' },
  ] } } } }

describe('CRM campaign metadata', () => {
  it('accepts governed previews and inactive drafts', () => {
    expect(readCampaign(plan)).toMatchObject({ kind: 'plan', data: { planId: 'plan_abc', readyForCreation: true } })
    expect(readCampaign({ crmCampaign: { version: 1, kind: 'draft', data: { version: 1, planId: 'plan_abc', idempotencyKey: 'draft_abc',
      campaignId: 'campaign-1', audienceId: 'audience-1', status: 'inactive', created: true, warnings: [] } } }))
      .toMatchObject({ kind: 'draft', data: { status: 'inactive' } })
  })

  it('rejects active drafts, customer data, and malformed aggregate results', () => {
    expect(readCampaign({ crmCampaign: { version: 1, kind: 'draft', data: { version: 1, planId: 'plan_abc', idempotencyKey: 'draft_abc',
      campaignId: 'campaign-1', audienceId: 'audience-1', status: 'active', created: true, warnings: [] } } })).toBeNull()
    expect(readCampaign({ crmCampaign: { version: 1, kind: 'results', data: {
      reachPeople: 1, channels: [], customers: [{ phone: 'secret' }],
    } } })).toBeNull()
    expect(readCampaign({ crmCampaign: { version: 1, kind: 'results', data: { reachPeople: -1, channels: [] } } })).toBeNull()
  })

  it('rejects unknown versions and executable preview fields', () => {
    expect(readCampaign({ crmCampaignPlan: { ...plan.crmCampaignPlan, version: 2 } })).toBeNull()
    const unsafe = structuredClone(plan)
    Object.assign(unsafe.crmCampaignPlan.data, { start: true })
    expect(readCampaign(unsafe)).toBeNull()
  })
})
